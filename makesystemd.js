'use strict'

/**
[Unit]
Description=cdpc daemon service

[Service]
ExecStart=/usr/local/bin/node /usr/local/cdpc/cdpcd.js
Restart=on-failure
RestartSec=1

[Install]
WantedBy=multi-user.target
Alias=cdpcd.service

*/

const fs = require('fs')

function fmtSystemd (options) {
  let text = ''

  if (!options || options.toString() !== '[object Object]') options = {}

  if (!options.command) {
    try {
      fs.accessSync('/usr/local/bin/node')
      options.command = '/usr/local/bin/node'
    } catch (err) {
      options.command = '/usr/bin/node'
    }
  }

  if (!options.file) options.file = '/usr/local/cdpc/cdpcd.js'
  
  text += `[Unit]\nDescription=cdpc daemon service.\n\n`

  text += `[Service]\nExecStart=${options.command} ${options.file} ${options.args || ''}\n`
  
  if (!options.restart) options.restart = 'always'

  text += `Restart=${options.restart}\n`

  if (options.restartSec) text += `RestartSec=${options.restartSec}\n`

  text += '\n[Install]\n'

  text += `WantedBy=multi-user.target\n`

  //if (!options.alias) options.alias = 'cdpcd.service'

  //text += `Alias=${options.alias}\n`

  return text
}

console.log(fmtSystemd())
