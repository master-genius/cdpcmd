'use strict'

const fs = require('fs')
const npargv = require('npargv')

let arg = npargv({
  '-l': {
    name: 'list',
    type: 'boolean',
    default: false
  },

  '--user': {
    name: 'user',
    type: 'string',
    default: ''
  },

  //用于查询
  '--has': {
    type: 'boolean',
    default: false,
    name: 'has'
  },

  '--limit-user': {
    type: 'string',
    default: '',
    name: 'limitUser'
  },

  '--json': {
    type: 'boolean',
    default: false,
    name: 'json'
  },

  '--encode-json': {
    type: 'boolean',
    default: false,
    name: 'encodeJson'
  }
})

let args = arg.args

let applist = arg.list.slice(1)

if (process.argv.length < 3) {
  console.error('less arguments')
  process.exit(1)
}

let loadfile = process.argv[2]

try {
  fs.accessSync(loadfile)
} catch (err) {
  // loadfile 不存在表示该用户下没有运行中的 cdpcd 服务，静默退出
  if (err.code === 'ENOENT') {
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
}

let _stcolor = {
  RUNNING: '\x1b[2;36m',
  'RUNNING(D)': '\x1b[2;32m',
  PAUSE : '\x1b[2;33m',
  EXIT : '\x1b[2;37m'
}

function stateColor(st) {
  let color_text = _stcolor[st] || ''

  if (!color_text) return st

  return `${color_text}${st}\x1b[0m`
}

function matchAppName(name, applist, user='') {
  for (let a of applist) {
    let ind = a.indexOf(':')
    if (ind > 0) {
      // a 格式为 "user:appname"，先校验 user 前缀
      if (user && a.substring(0, ind) !== user) {
        continue
      }

      // 精确匹配 app 名（修复：原 indexOf 子串匹配会误伤同名前缀的应用）
      if (name === a.substring(ind + 1)) {
        return true
      }

      continue
    }

    // 精确匹配 app 名
    if (name === a) return true
  }

  return false
}

//默认单位是KB
function fmtLimit(val, key) {
  let num_1M = 1024
  switch (key) {
    case 'maxrss':
    case 'rssOffset':
      if (val <= num_1M) return `${parseFloat(val).toFixed(2)}K`
      return `${parseFloat(val / 1024).toFixed(2)}M`
  }

  return val
}

// 字符串的可见宽度：剥离 ANSI 转义码后的长度。
// 服务名/状态/数字均为 ASCII，长度即显示宽度。
function visibleWidth(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length
}

/**
 * 渲染 console.table 风格的边框表。
 * 列宽按可见宽度自适应；单元格左对齐；状态列可含 ANSI 颜色码，不影响列宽。
 * @param {string[]} headers 表头
 * @param {Array<string[]>} rows 每行的单元格数组
 * @returns {string} 完整表格文本
 */
function renderTable(headers, rows) {
  let cols = headers.length
  let widths = headers.map(h => visibleWidth(h))

  for (let row of rows) {
    for (let i = 0; i < cols; i++) {
      let w = visibleWidth(row[i] === undefined ? '' : row[i])
      if (w > widths[i]) widths[i] = w
    }
  }

  // 单元格：内容左对齐补到列宽，两侧各留一个空格
  let cell = (text, i) => {
    text = (text === undefined || text === null) ? '' : String(text)
    let pad = widths[i] - visibleWidth(text)
    return ' ' + text + ' '.repeat(pad > 0 ? pad : 0) + ' '
  }

  let border = (left, mid, right) =>
    left + widths.map(w => '─'.repeat(w + 2)).join(mid) + right

  let rowLine = (cells) => {
    let out = []
    for (let i = 0; i < cols; i++) out.push(cell(cells[i], i))
    return '│' + out.join('│') + '│'
  }

  let lines = [border('┌', '┬', '┐'), rowLine(headers), border('├', '┼', '┤')]
  for (let row of rows) lines.push(rowLine(row))
  lines.push(border('└', '┴', '┘'))

  return lines.join('\n')
}

// -l 模式：渲染单个应用的详情块
function renderDetail(ch) {
  let lines = [ch.name]

  let kv = (k, v) => {
    lines.push('  ' + k.padEnd(8, ' ') + ((v === undefined || v === '') ? '--' : v))
  }

  kv('cmd', ch.command)
  kv('args', Array.isArray(ch.args) ? ch.args.join(' ') : '')

  if (ch.net) {
    kv('net', `receive ${ch.net.recvBytes}  transmit ${ch.net.transmitBytes}`)
  }

  if (ch.limit) {
    let keys = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']
    let parts = []
    keys.forEach(x => {
      if (ch.limit[x] !== undefined && ch.limit[x] > 0) {
        parts.push(`${x} ${fmtLimit(ch.limit[x], x)}`)
      }
    })
    if (parts.length > 0) kv('limit', parts.join('  '))
  }

  kv('cause', ch.cause || '--')

  return lines.join('\n')
}

async function getLoadData(loadfile, loop=10) {
  try {
    let loadData = fs.readFileSync(loadfile, {encoding: 'utf8'})
    return JSON.parse(loadData)
  } catch (err) {
    if (loop > 0) {
      await new Promise((rv, rj) => {
        setTimeout(() => {rv()}, parseInt(Math.random() * 5) + loop)
      })

      return await getLoadData(loadfile, loop-1)
    }
    // 重试耗尽：文件被并发删除或损坏，静默退出而非崩溃
    process.exit(0)
  }
}

;(async () => {
  try {
    let ld = await getLoadData(loadfile)

    if (args.has) {
      let euid = process.geteuid()
      let haslist = []
      for (let ch of ld.childs) {
        if (applist.length > 0 && !matchAppName(ch.name, applist, args.user)) {
          continue
        }

        if (args.limitUser && args.limitUser !== args.user && args.limitUser !== 'root') {
          continue
        }

        if (args.user) {
          haslist.push(`${args.user} ${ch.name} ${ch.pid||'-'}`)
          //console.log(`${args.user} ${ch.name} ${ch.pid||'-'}`)
        } else {
          haslist.push(`root ${ch.name} ${ch.pid||'-'}`)
          //console.log(`root ${ch.name} ${ch.pid}`)
        }
      }

      if (haslist.length > 0) {
        if (args.encodeJson) {
          console.log( encodeURIComponent(JSON.stringify(haslist)) )
        }
        else if (args.json) {
          console.log(JSON.stringify(haslist))
        } else {
          console.log(haslist.join('|'))
        }
      }

      process.exit(0)
    }

    // 过滤出要展示的子进程
    let childs = (ld.childs || []).filter(ch => {
      return !(applist.length > 0 && !matchAppName(ch.name, applist, args.user))
    })

    if (childs.length === 0) {
      process.exit(0)
    }

    if (args.user) {
      let user_title = (`------ User ------ [${args.user}]`).padEnd(60, ' ')
      console.log(`\x1b[7m${user_title}\x1b[0m`)
    }

    // 汇总表：console.table 风格的边框表
    let headers = ['Name', 'State', 'PID', 'CPU', 'MEM']

    let rows = childs.map(ch => {
      let state = (ch.state || '') + (ch.disabled ? '(D)' : '')
      return [
        ch.name,
        stateColor(state),
        ch.pid ? String(ch.pid) : '-',
        (typeof ch.cpu === 'number') ? `${ch.cpu}%` : '-',
        (typeof ch.mem === 'number') ? `${ch.mem}M` : '-'
      ]
    })

    console.log(renderTable(headers, rows))

    // -l：每个应用的详情块，放在汇总表下方
    if (args.list) {
      for (let ch of childs) {
        console.log('')
        console.log(renderDetail(ch))
      }
    }

    console.log('')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

})()
