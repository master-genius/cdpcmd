'use strict'

const fs = require('fs')

if (process.argv.length < 3) {
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

function stateColor (st) {
  let color_text = _stcolor[st] || ''

  if (!color_text) return st

  return `${color_text}${st}\x1b[0m`
}

function fmtLoadText (ld) {
  let text = ''

  for (let ch of ld.childs) {
    text += ` Name: ${ch.name}\n`
    text += ` Args: ${ch.args.join(' ')}\n`
    text += ` Stat: ${stateColor(ch.state)}\n`
    text += ` ·PID: ${ch.pid}  CPU: ${ch.cpu}%  MEM: ${ch.mem}M\n\n`
  }

  return text
}

try {
  let data = fs.readFileSync(loadfile)
  let ld = JSON.parse(data)
  console.log( fmtLoadText(ld) )
} catch (err) {
  console.error(err)
  process.exit(1)
}
