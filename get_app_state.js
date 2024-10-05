'use strict'

let ROOT_CDPC_WATCH = '/tmp/cdpcd_watch'
let UAUTH_DIR = '/usr/local/cdpc/uauth'

const fs = require('fs')

let fsp = fs.promises
let euid = process.geteuid()

let parseName = require('./parseNameApp.js')

const npargv = require('npargv')

let arg = npargv({
  '@command': [
    'start', 'stop', 'restart', 'pause', 'resume', 'remove'
  ],

  '--app': {
    name: 'app',
    type: 'string',
    default: ''
  },
})


let args = arg.args

let nm = parseName(args.app)

let statefile = ''

if (nm[0] === '' || nm[0] === 'root') {
  statefile = `${ROOT_CDPC_WATCH}/state/${nm[1]}`
} else {
  let home_path = euid === 0 
                  ? fs.readFileSync(`${UAUTH_DIR}/${nm[0]}`, {encoding: 'utf8'})
                  : process.env.HOME

  statefile = `${home_path}/.local/cdpc/watch/state/${nm[1]}`
}

async function outState(statefile, callback, total=280) {
  for (let i = 0; i < total; i++) {
    let state = fs.readFileSync(statefile, {encoding: 'utf8'})
    if (callback(state)) {
      console.log(nm[0], nm[1], state)
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
  
    case 'restart':
      regex = [
        new RegExp('^exit'),
        new RegExp('^running')
      ]

      break

    case 'remove':
      for (let i = 0; i < 123; i++) {
        try {
          await fsp.access(statefile)
        } catch (err) {
          return console.log(`${appname} removed`)
        }

        await new Promise((rv, rj) => {
          setTimeout(() => {rv()}, 50)
        })
      }
      process.exit(0)
  }

  if (Array.isArray(regex)) {
    for (let r of regex) {
      await outState(statefile, (state) => {
        return r.test(state)
      })
    }
  } else {
    await outState(statefile, (state) => {
      return regex.test(state)
    })
  }
}

get_state(statefile, nm[1], nm[0])
