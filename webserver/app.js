'use strict'

process.chdir(__dirname)

const titbit = require('titbit')
const tbloader = require('titbit-loader')
const parseArgv = require('npargv')
const {tofile} = require('titbit-toolkit')
const argsOptions = require('./args')

const fs = require('fs')

let { args } = parseArgv(argsOptions)

let opts = {
  cert: '',
  key: '',
  https: false,
  http2: false,
}

let cert_path = `${__dirname}/config/cert`

try {
  fs.accessSync(`${cert_path}/cdpc-web-server.key`)
  opts.key = `${cert_path}/cdpc-web-server.key`

  fs.accessSync(`${cert_path}/cdpc-web-server.pem`)
  opts.cert = `${cert_path}/cdpc-web-server.pem`

} catch (err) {

}

try {
  fs.accessSync(`${cert_path}/cdpc-web-server.crt`)
  opts.cert = `${cert_path}/cdpc-web-server.crt`
} catch (err) {
  opts.cert = ''
}

if (!opts.cert || !opts.key) {
  opts.key = opts.cert = ''
  opts.http2 = opts.https = false
} else {
  opts.http2 = opts.https = true
}

const app = new titbit({
  debug: args.debug,
  useLimit: true,
  maxConn: 500,
  maxIPRequest: 20,
  http2: opts.http2,
  https: opts.https,
  cert: opts.cert,
  key: opts.key
})

app.addService('appDir', __dirname)

app.addService('appConfigDir', __dirname + '/../config')

app.addService('configDir', __dirname + '/config')

app.addService('certDir', cert_path)

app.addService('certFile', `cdpc-web-server.pem`)
app.addService('keyFile', `cdpc-web-server.key`)

try {
  fs.accessSync('./config/apitk')
  app.addService('token', fs.readFileSync('./config/apitk', {encoding: 'utf8'}) )
} catch (err) {
  console.error('未发现token文件，请检查是否安装正确。')
  process.exit(1)
}

let tb = new tbloader()

tb.init(app)

app.addService('restart', () => {
  if (process.send && typeof process.send === 'function') {
    process.send({
      name: 'cdpc-web-server',
      op: 'restart'
    })
  }
})

app.use(new tofile)

app.run(10101, args.host)
