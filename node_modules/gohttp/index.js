'use strict'

const goh = require('./gohttp.js')
const h2c = require('./hiio.js')
const http2proxy = require('./http2proxy.js')

module.exports = {
  HttpClient: goh,
  HttpClientII: h2c,
  http2proxy,
  HttpIIProxy: http2proxy,
  httpcli : new goh(),
  http2cli : new h2c(),
}
