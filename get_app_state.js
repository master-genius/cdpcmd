'use strict'

let ROOT_CDPC_WATCH = '/tmp/cdpcd_watch'
let UAUTH_DIR = '/usr/local/cdpc/uauth'

const fs = require('fs')

let fsp = fs.promises
let euid = process.geteuid()

let parseName = require('./parseNameApp.js')

const npargv = require('npargv')

let arg = npargv({},{
  commands: [
    'start', 'stop', 'restart', 'pause', 'resume', 'remove', 'disable', 'enable'
  ],
})

let args = arg.args

let namelist = arg.list
async function outState(statefile, user, appname, callback, total=280) {
  for (let i = 0; i < total; i++) {
    let state = fs.readFileSync(statefile, {encoding: 'utf8'})
    if (callback(state)) {
      console.log(user, appname, state)
      break
    }

    await new Promise((rv, rj) => {
      setTimeout(() => {rv()}, 35)
    })
  }
}

async function get_state(statefile, appname, user) {
  let regex = ''

  switch (arg.command) {
    case 'start':
    case 'resume':
      regex = new RegExp('^running')
      break
  
    case 'pause':
      regex = new RegExp('^pause')
      break
  
    case 'stop':
      regex = new RegExp('^exit')
      break

    case 'disable':
      regex = /\(disabled\)/i
      break

    case 'enable':
      regex = /^(?!.*disabled).*$/i
      break

    case 'restart':
      regex = [
        new RegExp('^exit'),
        new RegExp('^running')
      ]

      break

    case 'remove':
      for (let i = 0; i < 200; i++) {
        try {
          await fsp.access(statefile)
        } catch (err) {
          console.log(`${user} ${appname} removed`)
          process.exit(0)
        }

        await new Promise((rv, rj) => {
          setTimeout(() => {rv()}, 35)
        })
      }

      process.exit(0)
  }

  if (Array.isArray(regex)) {
    for (let r of regex) {
      await outState(statefile, user, appname, (state) => {
        return r.test(state)
      })
    }
  } else {
    await outState(statefile, user, appname, (state) => {
      return regex.test(state)
    })
  }
}

function parseAndOutInfo(appname) {
  let nm = parseName(appname)

  let statefile = ''
  
  if (nm[0] === '' || nm[0] === 'root') {
    statefile = `${ROOT_CDPC_WATCH}/state/${nm[1]}`
  } else {
    let home_path = euid === 0 
                    ? fs.readFileSync(`${UAUTH_DIR}/${nm[0]}`, {encoding: 'utf8'})
                    : process.env.HOME
  
    statefile = `${home_path}/.cdpc/watch/state/${nm[1]}`
  }

  get_state(statefile, nm[1], nm[0])
}

for (let name of namelist) {
  parseAndOutInfo(name)
}
