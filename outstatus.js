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

function fmtLoadText (ld) {
  let text = ''

  for (let ch of ld.childs) {
    text += `Name: ${ch.name}\n`
    text += `Args: ${ch.args.join(' ')}\n`
    text += `Stat: ${ch.state}\n`
    text += `CPU: ${ch.cpu}%  MEM: ${ch.mem}M\n\n`
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
