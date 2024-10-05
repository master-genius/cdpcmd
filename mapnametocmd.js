'use strict'

const npargv = require('npargv')

let arg = npargv({
  '--user': {
    name: 'user',
    type: 'string',
    default: ''
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
  }
})

let namelist = arg.list

for (let name of namelist) {
  let ind = name.indexOf('@')
  if (ind > 0) {
    
  }
}