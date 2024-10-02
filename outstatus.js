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

/* function fmtLoadText(ld) {
  let text = ''

  for (let ch of ld.childs) {
    if (applist.length > 0 && applist.indexOf(ch.name) < 0) {
      continue
    }

    text += ` Name: ${ch.name}\n`
    text += ` Args: ${ch.args.join(' ')}\n`
    text += ` Stat: ${stateColor(ch.state)}\n`
    text += ` Cause: ${ch.cause}\n`
    text += ` ·PID: ${ch.pid}  CPU: ${ch.cpu}%  MEM: ${ch.mem}M\n`
    
    if (ch.net) {
      text += ` ·NET[receive: ${ch.net.recvBytes}, transmit: ${ch.net.transmitBytes}]\n`
    }

    text += '\n'
  }

  return text
} */

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
    if (applist.length > 0 && applist.indexOf(ch.name) < 0) {
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

try {
  let data = fs.readFileSync(loadfile)
  let ld = JSON.parse(data)
  let tables = fmtLoadTable(ld)
  if (tables.length === 1) {
    process.exit(0)
  }

  if (args.user && applist.length <= 0) {
    console.log(`------ User[${args.user}] ------`)
  }

  for (let l of tables) {
    console.log(l.join(''))
  }
} catch (err) {
  console.error(err)
  process.exit(1)
}
