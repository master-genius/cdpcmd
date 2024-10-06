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
  console.error(err)
  process.exit(1)
}

let _stcolor = {
  RUNNING: '\x1b[2;36m',
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

function fmtLine(ld) {
  let textobj = {}
  for (let k in ld) {
    switch (k) {
      case 'name':
        textobj.name = ld[k].padEnd(29, ' ')
        break

      case 'state':
        let statcolor = stateColor(ld[k])
        textobj.state = statcolor + ('').padEnd(13 - ld[k].length, ' ')
        break

      case 'pid':
        let pidstr = ld[k].toString()
        textobj.pid = pidstr.padEnd(13, ' ')
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
      if (user && a.indexOf(user) !== 0) {
        continue
      }

      if (name.indexOf(a.substring(ind+1)) >= 0) {
        return true
      } else {
        continue
      }
    }

    if (name.indexOf(a) >= 0) return true
  }

  return false
}

function fmtLoadTable(ld) {
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

      tables.push([
        '  @cause ',
        ch.cause || '--'
      ])

      tables.push([''])
    }
  }

  return tables
}

let loadData = ''
let ld = []

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
    console.error(err.message)
    process.exit(1)
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
      console.log(`------ User[${args.user}] ------`)
    }

    for (let l of tables) {
      console.log(l.join(''))
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

})();