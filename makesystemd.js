'use strict'

/**
[Unit]
Description=cdpc daemon service

[Service]
ExecStart=/usr/local/bin/node /usr/local/cdpc/cdpcd.js
Delegate=yes
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

  // Delegate=yes：让 systemd 把 cgroup 子树管理权委托给 cdpcd，
  // 使 cdpcd 可以在自己的 cgroup 下创建子组（limit 组），
  // 所有进程留在 cdpcd.service 子树内，systemctl stop/restart 时一把全杀，无逃逸。
  text += `Delegate=yes\n`

  // KillMode=mixed：停机时 SIGTERM 只发给主进程（root cdpcd，它响应后优雅退出），
  // cgroup 子树其余成员（用户 cdpcd、业务进程）由 systemd 直接 SIGKILL 收尾。
  // 用户 cdpcd 刻意忽略 SIGTERM，故不能用默认 control-group（会朝整树发 SIGTERM、
  // 用户 cdpcd 不理而干等超时）。TimeoutStopSec 兜底，防主进程卡住时无限等待。
  text += `KillMode=mixed\n`
  text += `TimeoutStopSec=20\n`

  if (!options.restart) options.restart = 'always'

  text += `Restart=${options.restart}\n`

  if (options.restartSec) text += `RestartSec=${options.restartSec}\n`

  text += '\n[Install]\n'

  text += `WantedBy=multi-user.target\n`

  return text
}

console.log(fmtSystemd())
