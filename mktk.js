'use strict'

const crypto = require('crypto')

let rstr = `${Date.now()}${Math.random()}`

let h = crypto.createHash('sha1')

h.update(rstr)

console.log( h.digest('hex') )
