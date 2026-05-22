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

/*
Name      State       PID     CPU  MEM
app1      RUNNING     1234    12%  12M  
: ARGS
: Cause
: NET [receive: 123, transmit: 456]
*/

// [N3] name 列宽自适应：默认 23，按实际最长 name 动态调整（上限 52）
let nameColWidth = 23

function fmtLine(ld) {
  let textobj = {}
  for (let k in ld) {
    switch (k) {
      case 'name':
        let dname = ld[k]
        if (dname.length > nameColWidth - 1) {
          dname = dname.substring(0, nameColWidth - 4) + '...'
        }

        textobj.name = dname.padEnd(nameColWidth, ' ')
        break

      case 'state':
        let statetext = ld[k] + (ld.disabled ? '(D)' : '')
        let statcolor = stateColor(statetext)
        textobj.state = statcolor + ('').padEnd(13 - statetext.length, ' ')
        break

      case 'pid':
        let pidstr = ld[k].toString()
        textobj.pid = pidstr.padEnd(12, ' ')
        break

      case 'cpu':
        let cpustr = ld[k] === 'CPU'  ? ld[k] : `${ld[k]}%`
        textobj.cpu = cpustr.padEnd(9, ' ')
        break

      case 'mem':
        textobj.mem = ld[k] === 'MEM' ? ld[k] : `${ld[k]}M`
        break
    }
  }

  return textobj
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

function fmtLoadTable(ld) {
  // [N3] 计算实际最长 name，自适应列宽（短名维持 23，长名最多 52）
  let maxName = 4 // 'Name' 表头长度
  for (let ch of ld.childs) {
    if (applist.length > 0 && !matchAppName(ch.name, applist, args.user)) continue
    if (ch.name && ch.name.length > maxName) maxName = ch.name.length
  }
  nameColWidth = Math.min(Math.max(maxName + 2, 23), 52)

  let tableHead = {
    //最长28个字符
    name: 'Name',
    // RUNNING PAUSE EXIT PREPARE
    state: 'State',
    //最长13个字符
    pid: 'PID',
    // 最长7个字符
    cpu: 'CPU',
    mem: 'MEM',
  }

  let tables = []

  let headobj = fmtLine(tableHead)
  tables.push([
    headobj.name,
    headobj.state,
    headobj.pid,
    headobj.cpu,
    headobj.mem
  ])

  for (let ch of ld.childs) {
    if (applist.length > 0 && !matchAppName(ch.name, applist, args.user)) {
      continue
    }

    let chobj = fmtLine(ch)

    tables.push([
      chobj.name,
      chobj.state,
      chobj.pid,
      chobj.cpu,
      chobj.mem
    ])

    if (args.list) {
      tables.push([
        '  @cmd ',
        ch.command
      ])

      tables.push([
        '  @args ',
        ch.args.join(' ')
      ])

      if (ch.net) {
        tables.push([
          '  @net ',
          `receive: ${ch.net.recvBytes}, `,
          `transmit: ${ch.net.transmitBytes}`
        ])
      }

      if (ch.limit) {
        let keys = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']
        let limits = ['  @limit:']

        keys.forEach(x => {
          if (ch.limit[x] !== undefined && ch.limit[x] > 0) {
            limits.push(`    ${x}: ${fmtLimit(ch.limit[x], x)}`)
          }
        })

        limits.length > 1 && tables.push([limits.join('\n')])
      }

      tables.push([
        '  @cause ',
        ch.cause || '--'
      ])

      tables.push([''])
    }
  }

  return tables
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

    let tables = fmtLoadTable(ld)
    if (tables.length === 1) {
      process.exit(0)
    }

    if (args.user) {
      let user_title = (`------ User ------ [${args.user}]`).padEnd(60, ' ')
      console.log(`\x1b[7m${user_title}\x1b[0m`)
    }

    for (let l of tables) {
      console.log(l.join(''))
    }
    console.log('')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

})();