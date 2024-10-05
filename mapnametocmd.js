'use strict'

const fs = require('fs')
const npargv = require('npargv')

let ROOT_CDPC_WATCH = '/tmp/cdpcd_watch'
let UAUTH_DIR = '/usr/local/cdpc/uauth'

let euid = process.geteuid()

let arg = npargv({
  '-op': {
    name: 'op',
    type: 'string',
    default: ''
  },
})

let namelist = arg.list
let args = arg.args

let parseName = require('./parseNameApp.js')

let cmdlist = []

for (let name of namelist) {
  let nm = parseName(name)
  if (nm[0] === '' || nm[0] === 'root') {
    cmdlist.push(`${ROOT_CDPC_WATCH}/${args.op}/${nm[1]}`)
    //cmdlist.push(`node /usr/local/cdpc/noticeApp.js ${ROOT_CDPC_WATCH}/${args.op}/${nm[1]}`)
  } else {
    try {
      let home_path = euid === 0 
                        ? fs.readFileSync(`${UAUTH_DIR}/${nm[0]}`, {encoding: 'utf8'})
                        : process.env.HOME

      //let app_file = `${home_path}/.local/cdpc/watch/${args.op}/${nm[1]}`
      let cmdtext = `${home_path}/.local/cdpc/watch/${args.op}/${nm[1]}`
      
      //let cmdtext = `node /usr/local/cdpc/noticeApp.js ${app_file}${euid === 0 ? ` && chown ${nm[0]} ${app_file}` : '' }`
      cmdlist.push(cmdtext)
    } catch (err) {
      console.error(err)
    }
  }
}

if (cmdlist.length === 0) {
  process.exit(0)
} else if (cmdlist.length === 1) {
  console.log(cmdlist[0])
} else {
  console.log(cmdlist.join('\n'))
}
