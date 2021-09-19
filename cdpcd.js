'use strict'

process.chdir(__dirname)

const config_file = 'config/childs.js'

//const fs = require('fs')
const cdpc = require('cdpc')

//const fsp = fs.promises

const cm = new cdpc({
  notExit: true,
  loadInfoFile: '/tmp/cdpcd-load.log',
  showColor: true,
  loadInfoType: 'json',
  config: config_file
})

cm.strong()

cm.runChilds([
    {
        name: 'cdpc-web-server',
        file: 'webserver/app.js',
        restart: 'always',
        restartDelay: 500,
        monitor: true,
        lockReload: true
    }
])

cm.loadConfig()
