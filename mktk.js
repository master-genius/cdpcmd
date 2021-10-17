'use strict'

process.chdir(__dirname)

const apitk = require('./lib/apitk')
const fs = require('fs')

let tokenstr = ''

try {
  fs.accessSync('./tmp/tokenstr')
  tokenstr = fs.readFileSync('./tmp/tokenstr', {encoding: 'utf8'})
} catch (err) {}

console.log( apitk(tokenstr) )
