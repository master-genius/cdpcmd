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