'use strict'

/**
 * 用于init模式下，启动服务，直接使用setsid是不可以从shell中退出的。需要一个中间过程。
 */

const { spawn } = require('node:child_process')

let ch = spawn('/usr/local/bin/node', ['/usr/local/cdpc/cdpcd.js'], {
  cwd: '/usr/local/cdpc'
})

ch.unref()

//process.exit(0)
