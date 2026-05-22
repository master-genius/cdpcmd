'use strict'

/**
 * cdpc inspect：读取负载信息文件，输出某个服务的完整运行时配置。
 * 用法: inspect.js <loadfile> <appname>
 *
 * 数据来源是 cdpc 周期写出的 loadInfoFile（JSON），其中 childs[] 每项
 * 是服务的真实运行时快照——比 config show（磁盘原始 .js）更可信。
 */

const fs = require('fs')

let loadfile = process.argv[2]
let appname = process.argv[3]

if (!loadfile || !appname) {
  console.error('用法: inspect.js <loadfile> <appname>')
  process.exit(1)
}

let data
try {
  data = JSON.parse(fs.readFileSync(loadfile, {encoding: 'utf8'}))
} catch (err) {
  console.error('无法读取负载信息文件：' + err.message)
  process.exit(1)
}

let ch = (data.childs || []).find(c => c.name === appname)

if (!ch) {
  console.error(`未找到服务：${appname}`)
  process.exit(1)
}

function line(k, v) {
  if (v === undefined || v === null || v === '') v = '-'
  console.log('  ' + String(k).padEnd(16, ' ') + ': ' + v)
}

function section(title) {
  console.log(`\x1b[2;36m── ${title} ──\x1b[0m`)
}

console.log(`\x1b[7m 服务详情: ${ch.name} \x1b[0m`)

section('基本')
line('name', ch.name)
line('state', ch.state)
line('pid', ch.pid > 0 ? ch.pid : '-')
line('detail', ch.detail)
line('command', ch.command)
line('args', Array.isArray(ch.args) ? ch.args.join(' ') : '-')
line('configPath', ch.configPath)
line('cgroup', ch.cgroup)

section('重启策略')
line('restart', ch.restart)
line('restartCount', ch.restartCount)
line('restartLimit', ch.restartLimit)
line('restartDelay', ch.restartDelay)
line('autoRemove', ch.autoRemove)

section('运行控制')
line('only', ch.only)
line('force', ch.force)
line('disabled', ch.disabled)
line('monitor', ch.monitor)
line('monitorNetData', ch.monitorNetData)
line('after', Array.isArray(ch.after) ? ch.after.join(', ') : '-')
line('cause', ch.cause)

// cpu/mem 是 loadinfo 里格式化后的值（字符串，EXIT 状态为数字 0），有值就原样显示。
function fmtVal(v, unit) {
  return (v === undefined || v === null || v === '') ? '-' : `${v}${unit}`
}

section('资源')
line('cpu', fmtVal(ch.cpu, '%'))
line('mem', fmtVal(ch.mem, 'M'))
if (ch.net) {
  line('net.recv', ch.net.recvBytes)
  line('net.transmit', ch.net.transmitBytes)
}
if (ch.limit && typeof ch.limit === 'object') {
  let lk = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']
  for (let k of lk) {
    if (ch.limit[k] !== undefined && ch.limit[k] > 0) {
      line('limit.' + k, ch.limit[k])
    }
  }
}
