'use strict'

/**
 * cdpc inspect：输出某个服务的完整运行时配置。
 * 用法: inspect.js <sockFile> <appname>
 *
 * 数据来源是 cdpcd 的 sock inspect op，返回库层 _fmtChildInfo() 的白名单浅
 * 序列化结果（与 status 同一份字段表），是服务的真实运行时快照——
 * 比 config show（磁盘原始 .js）更可信。
 */

const sock = require('./lib/sockclient')

let sockFile = process.argv[2]
let appname = process.argv[3]

if (!sockFile || !appname) {
  console.error('用法: inspect.js <sockFile> <appname>')
  process.exit(1)
}

let ch = null

;(async () => {
  let r = await sock.query(sockFile, 'inspect', {name: appname})

  if (!r.ok) {
    if (r.kind === 'reply-error') {
      let msg = {
        'not-found': `未找到服务：${appname}`,
        'invalid-name': `服务名不合法：${appname}`
      }[r.message] || r.message
      console.error(msg)
    } else {
      console.error(r.message)
    }
    process.exit(1)
  }

  ch = r.data
  render()
})()

function render() {

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
// cpu / mem 永远是服务自身进程的占用
line('cpu', fmtVal(ch.cpu, '%'))
line('mem', fmtVal(ch.mem, 'M'))

// 进程树：自身 + 全部后代。包装脚本、master/worker 这类服务自身看不出负载
if (ch.procCount > 1) {
  line('cpu(tree)', fmtVal(ch.cpuTotal, '%'))
  line('mem(tree)', fmtVal(ch.memTotal, 'M'))
  line('procs', ch.procCount)
}
if (ch.net) {
  line('net.recv', ch.net.recvBytes)
  line('net.transmit', ch.net.transmitBytes)
}
if (Array.isArray(ch.procs) && ch.procs.length > 1) {
  section('进程树')
  for (let p of ch.procs) {
    console.log('  ' + String(p.pid).padStart(8, ' ')
      + '  ' + String(p.cpu + '%').padStart(8, ' ')
      + '  ' + String(p.mem + 'M').padStart(10, ' ')
      + '  ' + (p.cmd || p.comm || ''))
  }
}

if (ch.limit && typeof ch.limit === 'object') {
  let lk = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']
  for (let k of lk) {
    if (ch.limit[k] !== undefined && ch.limit[k] > 0) {
      line('limit.' + k, ch.limit[k])
    }
  }
}
}
