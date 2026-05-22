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

  // [包B] ExecStop 脚本：停机时有序清理逃逸到独立 cgroup 的用户 cdpcd
  if (!options.stopFile) options.stopFile = '/usr/local/cdpc/shutdown.js'

  text += `[Unit]\nDescription=cdpc daemon service.\n\n`

  text += `[Service]\nExecStart=${options.command} ${options.file} ${options.args || ''}\n`

  // [包B] 停机/重启时先跑 shutdown.js，显式终止用户级 cdpcd，避免孤儿与"管理冲突"
  text += `ExecStop=${options.command} ${options.stopFile}\n`

  // KillMode=mixed：先只给主进程发信号，由 ExecStop 负责有序清理；
  // TimeoutStopSec 限制等待，避免 root cdpcd 忽略 SIGTERM 时长时间挂起
  text += `KillMode=mixed\n`
  text += `TimeoutStopSec=20\n`

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
