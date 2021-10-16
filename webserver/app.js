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

let server_name = 'cdpcd-web-server'

try {
  fs.accessSync(`${cert_path}/${server_name}.key`)
  opts.key = `${cert_path}/${server_name}.key`

  fs.accessSync(`${cert_path}/${server_name}.pem`)
  opts.cert = `${cert_path}/${server_name}.pem`

} catch (err) {

}

try {
  fs.accessSync(`${cert_path}/${server_name}.crt`)
  opts.cert = `${cert_path}/${server_name}.crt`
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

app.addService('certFile', `${server_name}.pem`)
app.addService('keyFile', `${server_name}.key`)

app.addService('apitkFile', `${app.service.configDir}/apitk`)

app.addService('hostFile', `${app.service.configDir}/host`)

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
      name: server_name,
      op: 'restart'
    })
  }
})

app.use(new tofile)

try {
  fs.accessSync(app.service.hostFile)
  let host = fs.readFileSync(app.service.hostFile, {encoding: 'utf8'})
  argsOptions['--host'].match(host) && (args.host = host)
} catch (err) {

}

app.run(10101, args.host)
