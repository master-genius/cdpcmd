'use strict'

const crypto = require('crypto')

module.exports = function (tokenstr = '') {
  
  let rstr = `${Math.random()}${Date.now()}${Math.random()}${Math.random()}${tokenstr}`

  let h = crypto.createHash('sha256')
  
  h.update(rstr)

  return h.digest('hex')
}
