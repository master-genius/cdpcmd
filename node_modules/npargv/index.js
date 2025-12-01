'use strict'

/**
 * {
 *    '-a' : {
 *      name: 'a',
 *      type: 'number|string|int|float|bool',
 *      min: 0,
 *      max: 100,
 *      match: RegExp,
 *      default : any
 *    },
 *    
 *    '$2': {
 * 
 *    },
 *    {
 *      '--port=' : {
 *        name : 'port',
 *        type : 'int',
 *        min: 2000,
 *        max: 5000,
 *        default: 3456
 *      }
 *    }
 * }
 * 
 */

function setVal (a, ainfo, obj, next) {

  if (ainfo.type && ['int', 'float', 'number'].indexOf(ainfo.type) >= 0) {
      if (isNaN(next)) {
        return {
          ok: false,
          message: `${a} 类型错误，要求参数必须是数字类型：${next}`
        }
      }

      if (ainfo.type === 'int' || ainfo.type === 'number') {
        next = parseInt(next)
      } else {
        next = parseFloat(next)
      }
  }

  if (ainfo.min !== undefined) {
    if (next < ainfo.min) {
      return {
        ok: false,
        message: `${a} 数值不能低于 ${ainfo.min}`
      }
    }
  }

  if (ainfo.max !== undefined) {
    if (next > ainfo.max) {
      return {
        ok: false,
        message: `${a} 数值不能大于 ${ainfo.max}`
      }
    }
  }

  if (ainfo.match && ainfo.match instanceof RegExp) {
    if (!ainfo.match.test(next)) {
      return {
        ok: false,
        message: `${a} 数值无法匹配 ${next}`
      }
    }
  }

  let val = next

  if (ainfo.callback && typeof ainfo.callback === 'function') {
    val = ainfo.callback(next)
    if (val === undefined) val = next
  }

  obj[ ainfo.name || a ] = val

  return {
    ok: true,
    message: ''
  }

}

function checkAndSet (a, ainfo, obj, next) {

  if (typeof ainfo === 'boolean') {
    obj[a] = true
    return {
      ok: true,
      message: '',
      op: 'none'
    }
  }

  if (ainfo.type === 'bool' || ainfo.type === 'boolean') {
    obj[ ainfo.name || a ] = true

    return {
      ok: true,
      message: '',
      op: 'none'
    }
  }

  if (next === null) {
    return {
      ok: false,
      message: `${a} 必须携带参数。`
    }
  }

  let r = setVal(a, ainfo, obj, next)

  if (!r.ok && ainfo.default !== undefined) {
    r.ok = true
  }

  if (r.ok) {
    r.op = 'next'

    if (a[a.length - 1] === '=') {
      r.op = 'none'
    }
  }

  return r
}

function setAutoDefault (opts, k) {
  switch (opts[k].type) {
    case 'number':
    case 'int':
    case 'float':
      opts[k].default = 0
      if (opts[k].min)
        opts[k].default = opts[k].min;
      break

    case 'string':
      opts[k].default = ''
      break

    case 'bool':
    case 'boolean':
      opts[k].default = false
      break
  }
}

/*
 * opts['@autoDefault'] = true 表示自动设定默认值
 *
 * */

function parseArgv (options = null, obj = null) {
  if (!options) options = {}

  if (obj === null) obj = {}

  let opts = {}

  for (let k in options) {
    opts[k] = options[k]
  }

  let autoDefault = false

  if (opts['@autoDefault'] === undefined) opts['@autoDefault'] = true;

  if (opts['@autoDefault'] !== undefined) {
    autoDefault = !!opts['@autoDefault']
    delete opts['@autoDefault']
  }

  let commands = []
  if (opts['@command'] !== undefined) {
    if (typeof opts['@command'] === 'string') {
      opts['@command'].split(' ').filter(p => p.length > 0).forEach(a => {
        commands.push(a.trim())
      })
    } else if (Array.isArray(opts['@command'])) {
      commands = opts['@command'];
    }
    delete opts['@command'];
  }

  let defaultCommand = ''
  if (opts['@defaultCommand'] !== undefined && commands.indexOf(opts['@defaultCommand']) >= 0) {
    defaultCommand = opts['@defaultCommand'];
    delete opts['@defaultCommand'];
  }

  let userCommand = null
  let commandFromInput = false
  if (commands.length > 0) {
    if (process.argv.length < 3) {
      if (defaultCommand) userCommand = defaultCommand;
      else {
        return {
          ok: false,
          message: '请使用子命令：' + commands.join('|'),
          args: obj
        }
      }
    } else if  (commands.indexOf(process.argv[2]) < 0) {
      if (defaultCommand) userCommand = defaultCommand;
      else {
        return {
          ok: false,
          message: '不支持的子命令',
          args: obj
        }
      }
    } else {
      commandFromInput = true
      userCommand = process.argv[2]
    }
  }

  let tmp_val

  for (let k in opts) {
    if (typeof opts[k] === 'string' && opts[k].trim().length > 0) {
      opts[k] = {
        name: opts[k].trim(),
        type: 'boolean',
        default: false
      }
    }

    if (typeof opts[k] !== 'object' || opts[k].toString() !== '[object Object]') {

      opts[k] = {
        type : 'boolean',
        name : k,
        default: false
      }

    } else if (opts[k].type === undefined) {

      if (k.indexOf('=') > 0) {
        opts[k].type = 'string'
      } else if (opts[k].match || opts[k].callback) {
        opts[k].type = 'string'
      } else {
          if (opts[k].min !== undefined || opts[k].max !== undefined) {
            opts[k].type = 'int'
          } else if (opts[k].default !== undefined) {
            tmp_val = typeof opts[k].default
            if (tmp_val === 'number' || tmp_val === 'boolean' || tmp_val === 'string') {
              opts[k].type = tmp_val
            } else {
              opts[k].type = 'string'
            }
          } else {
            opts[k].type = 'bool'
          }
      }

    }

    autoDefault && opts[k].default === undefined && setAutoDefault(opts, k)

    if (opts[k].type === 'bool' || opts[k].type === 'boolean') {
      obj[ opts[k].name || k ] = false
    } else if (opts[k].default !== undefined) {
      obj[ opts[k].name || k ] = opts[k].default
    }

  }

  for (let k in opts) {
    if (opts[k].alias && typeof opts[k].alias === 'string' && opts[k].alias !== k) {
      opts[opts[k].alias] = opts[k]
    }
  }

  let a
  let next
  let next_end = process.argv.length - 1
  let r = ''
  let i = 2
  let offset = 1
  if (commands.length > 0 && commandFromInput) {
    i++
    offset = 2
  }

  let ind = 0
  let pos_key = ''
  let aList = []

  while (i < process.argv.length) {

    //先检测是否存在对位置的引用
    pos_key = '$' + `${i-offset}`
    if (opts[pos_key]) {
      r = checkAndSet(pos_key, opts[pos_key], obj, process.argv[i])
      if (!r.ok) {
        r.args = obj
        return r
      }
      i++
      continue
    }

    a = process.argv[i]
    
    next = i < next_end ? process.argv[i+1] : null

    ind = a.indexOf('=')

    if (ind > 0) {
      a = a.substring(0, ind+1)
      next = process.argv[i].substring(ind+1)
    }

    if (opts[a]) {
      r = checkAndSet(a, opts[a], obj, next)
      if (!r.ok) {
        r.args = obj
        return r
      }

      if (r.op === 'next') {
        i += 2
        continue
      }

    } else {
      if (a[0] !== '-') {
        a[0] !== '\\' ? aList.push(a) : aList.push(a.substring(1))
      }
    }

    i++
  }

  return {
    ok: true,
    message: '',
    args: obj,
    list: aList,
    command: userCommand
  }
}

module.exports = parseArgv

