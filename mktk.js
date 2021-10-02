'use strict'

process.chdir(__dirname)

const crypto = require('crypto')
const fs = require('fs')

let tokenstr = ''

try {
  fs.accessSync('./tmp/tokenstr')
  tokenstr = fs.readFileSync('./tmp/tokenstr', {encoding: 'utf8'})
} catch (err) {}

let rstr = `${Math.random()}${Date.now()}${Math.random()}${Math.random()}${tokenstr}`

let h = crypto.createHash('sha256')

h.update(rstr)

console.log( h.digest('hex') )
