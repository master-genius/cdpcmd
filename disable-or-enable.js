'use strict'

const fs = require('fs')
const npargv = require('npargv')

let ROOT_CDPC_CONFIG_DISABLED = '/usr/local/cdpc/config/disabled'
let UAUTH_DIR = '/usr/local/cdpc/uauth'

let euid = process.geteuid()

let arg = npargv({
  '@command': [
    'disable', 'enable'
  ]
})

let namelist = arg.list
let args = arg.args

let parseName = require('./parseNameApp.js')

let cmdlist = []

for (let name of namelist) {
  let nm = parseName(name)

  if (nm[0] === '' || nm[0] === 'root') {
    cmdlist.push({
      op: arg.command,
      file: `${ROOT_CDPC_CONFIG_DISABLED}/${nm[1]}`,
      text: name,
      mode: 0o644
    })
  } else {
    try {
      let home_path = euid === 0 
                        ? fs.readFileSync(`${UAUTH_DIR}/${nm[0]}`, {encoding: 'utf8'})
                        : process.env.HOME

      let file = `${home_path}/.cdpc/config/disbaled/${nm[1]}`
      
      cmdlist.push({
        op: arg.command,
        file: file,
        text: name,
        mode: euid === 0 ? 0o666 : 0o644
      })
    } catch (err) {
      console.error(err)
    }
  }
}

for (let c of cmdlist) {
  switch (c.op) {
    case 'disable':
      try {
        fs.writeFileSync(c.file, c.text||'', {
          encoding: 'utf8',
          mode: c.mode
        })
      } catch (err) {}

      break

    case 'enable':
      try {
        fs.accessSync(c.file)
        fs.unlinkSync(c.file)
      } catch (err) {
        //console.error(err)
      }
      break
  }
}