'use strict'

process.chdir(__dirname)

const titbit = require('titbit')
const tbloader = require('titbit-loader')
const parseArgv = require('npargv')
const argsOptions = require('./args')

let { args } = parseArgv(argsOptions)


const app = new titbit({
  debug: args.debug,
  useLimit: true,
  maxConn: 100,
  maxIPRequest: 10
})

let tb = new tbloader()

tb.init(app)

app.run(2358, args.host)
