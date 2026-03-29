'use strict'

const GoHttp = require('./gohttp.js')
const GoHttp2 = require('./gohttp2.js')

let http2Connect = (url, options) => {
  return new GoHttp2(url, options)
}

module.exports = {
  GoHttp, GoHttp2,
  hcli: new GoHttp(),
  http2Connect,
  h2cli: {
    connect: http2Connect
  }
}
