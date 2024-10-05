'use strict'

const fs = require('fs')
const npargv = require('npargv')

const arg = npargv({
  '--user': {
    name: 'user',
    default: '',
    type: 'string'
  }
})

let file = arg.list[0]

if (!file) {
  console.error('less arguments: app file')
  process.exit(1)
}

try {
  fs.writeFileSync(file, (new Date()).toLocaleString().replaceAll('/', '-'), {
    encoding: 'utf8',
    mode: 0o644
  })

  process.exit(0)
} catch (err) {
  console.error(err)
}
