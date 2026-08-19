'use strict'

const sock = require('./sockclient')
const { truncateByVisible, padLeft } = require('./status-render')

// 状态颜色（与原 outstatus.js 保持一致）
const STATE_COLOR = {
  RUNNING: '\x1b[2;36m',
  'RUNNING(D)': '\x1b[2;32m',
  PAUSE: '\x1b[2;33m',
  EXIT: '\x1b[2;37m'
}

function colorState(st) {
  let c = STATE_COLOR[st]
  if (!c) return st
  return `${c}${st}\x1b[0m`
}

function stateText(ch) {
  return (ch.state || '') + (ch.disabled ? '(D)' : '')
}

// applist 形如 ['user:name', 'name']；精确匹配，不做子串包含。
function matchAppName(name, applist, user='') {
  for (let a of applist) {
    let ind = a.indexOf(':')
    if (ind > 0) {
      if (user && a.substring(0, ind) !== user) continue
      if (name === a.substring(ind + 1)) return true
      continue
    }
    if (name === a) return true
  }
  return false
}

/**
 * 状态数据源：sock 的 status op。
 *
 * 取代原 readLoad(loadfile)。原实现要对负载文件做 10 次抖动重试，因为
 * cdpcd 周期 fs.writeFile 而读侧会读到半文件——sock 应答按行原子，
 * 该重试补丁随之删除。
 *
 * @returns {{ok: boolean, data?: object, kind?: string, message?: string}}
 *   data 结构与原负载文件一致（{pid, sys, childs}），下游渲染逻辑无需改动。
 */
async function readStatus(sockFile) {
  let r = await sock.query(sockFile, 'status')

  if (!r.ok) return {ok: false, kind: r.kind, message: r.message}

  return {ok: true, data: r.data}
}

function filterChilds(loadData, applist=[], user='') {
  let childs = (loadData && loadData.childs) || []
  if (applist.length === 0) return childs.slice()
  return childs.filter(ch => matchAppName(ch.name, applist, user))
}

// limit 字段单位归一（KB 为基础）
function fmtLimit(val, key) {
  let num_1M = 1024
  switch (key) {
    case 'maxrss':
    case 'rssOffset':
      if (val <= num_1M) return `${parseFloat(val).toFixed(2)}K`
      return `${parseFloat(val / 1024).toFixed(2)}M`
  }
  return val
}

// cpu/mem 已经在 loadinfo dump 阶段被格式化为字符串（EXIT 时为数字 0），
// 这里只判空。
function fmtVal(v, unit) {
  return (v === undefined || v === null || v === '') ? '-' : `${v}${unit}`
}

// CPU 统一两位小数 + %，例：'50.50%'
// 阈值着色：>80 红，>50 品红/紫，其余原色
function fmtCpu(v) {
  if (v === undefined || v === null || v === '') return '-'
  let n = typeof v === 'number' ? v : parseFloat(v)
  if (!isFinite(n)) return '-'
  let text = n.toFixed(2) + '%'
  if (n > 80) return `\x1b[31m${text}\x1b[0m`   // 红
  if (n > 50) return `\x1b[35m${text}\x1b[0m`   // 品红/紫
  return text
}

// MEM 输入为 MB；< 1000 显示 'XXX.XXM'，>= 1000 转 GB 显示 'X.XXG'
function fmtMem(v) {
  if (v === undefined || v === null || v === '') return '-'
  let n = typeof v === 'number' ? v : parseFloat(v)
  if (!isFinite(n)) return '-'
  if (n >= 1000) return (n / 1024).toFixed(2) + 'G'
  return n.toFixed(2) + 'M'
}

// runtime 顶部 sticky 行：整机 CPU / MEM 概览（来自 cdpc loadinfo 的 sys 块）。
// 输入 ld 是某个 loadfile 的解析结果；多用户场景下任取一个非空 sys 即可，
// 因为 sys 读取 /proc/meminfo & /proc/stat 是 host-wide 信息，对所有 cdpcd 实例一致。
function fmtSysLoad(ld) {
  let sys = ld && ld.sys
  if (!sys) return ''

  // CPU：值固定右对齐到 7 字符宽（'100.00%' 上限），避免数字位数变化导致后面 MEM 抖动。
  let cpuN = typeof sys.cpu === 'number' ? sys.cpu : parseFloat(sys.cpu)
  let cores = (Array.isArray(sys.cpus) && sys.cpus.length) || 0
  let cpuText, cpuColored
  if (!isFinite(cpuN)) {
    cpuText = '-'
    cpuColored = cpuText
  } else {
    cpuText = cpuN.toFixed(2) + '%'
    if (cpuN > 80) cpuColored = `\x1b[31m${cpuText}\x1b[0m`
    else if (cpuN > 50) cpuColored = `\x1b[35m${cpuText}\x1b[0m`
    else cpuColored = cpuText
  }
  // 留白加在着色之外、值之前（右对齐到 7）
  cpuColored = ' '.repeat(Math.max(0, 7 - cpuText.length)) + cpuColored
  let coresPart = cores > 0 ? ` [${cores}]` : ''

  // MEM
  let mem = sys.mem
  let memTotal = mem && mem.MemTotal && mem.MemTotal.value
  let memAvail = mem && mem.MemAvailable && mem.MemAvailable.value
  let memColored = '-'
  if (isFinite(memTotal) && isFinite(memAvail) && memTotal > 0) {
    let memUsed = memTotal - memAvail
    let pct = (memUsed / memTotal) * 100
    let usedStr = fmtMem(memUsed / 1024)   // KB → MB
    let totalStr = fmtMem(memTotal / 1024)
    let str = `${usedStr} / ${totalStr} (${pct.toFixed(1)}%)`
    if (pct > 90) memColored = `\x1b[31m${str}\x1b[0m`
    else if (pct > 75) memColored = `\x1b[35m${str}\x1b[0m`
    else memColored = str
  }

  return ` \x1b[1mCPU\x1b[0m  ${cpuColored}${coresPart}  |  \x1b[1mMEM\x1b[0m   ${memColored}\n`
}

// 汇总表的一行（cells row）
/**
 * CPU / MEM 两列**永远是服务自身进程**的占用（与数据字段语义一致）。
 * TREE 列是"自身 + 全部后代"的合计——凡是 fork 出常驻子进程的服务
 * （包装脚本、master/worker、cluster 主进程等），自身接近 0，
 * 只有这一列能反映真实占用。单进程服务没有区别，显示 '-'。
 */
function treeCell(ch) {
  let n = ch.procCount || 0

  if (n <= 1) return '-'

  return `${fmtCpu(ch.cpuTotal)}/${fmtMem(ch.memTotal)} ×${n}`
}

function summaryCells(ch) {
  return [
    ch.name,
    colorState(stateText(ch)),
    ch.pid ? String(ch.pid) : '-',
    fmtCpu(ch.cpu),
    fmtMem(ch.mem),
    treeCell(ch)
  ]
}

// 详情下挂的 span row 内容（多行）
function detailLines(ch) {
  let lines = []
  let kv = (k, v) => {
    lines.push((lines.length === 0 ? '╰─ ' : '   ') + k.padEnd(7, ' ') + ((v === undefined || v === '') ? '--' : v))
  }

  kv('cmd', ch.command)
  kv('args', Array.isArray(ch.args) ? ch.args.join(' ') : '')

  /**
   * exec：实际执行的命令。cmd/args 是用户配置的原值，
   * cluster 服务真正跑的是 launcher，不显示出来用户无法确认集群模式是否生效。
   * 概览表格不加列（避免噪音），只在详情里给一行。
   */
  if (ch.real_command || (Array.isArray(ch.real_args) && ch.real_args.length > 0)) {
    let execCmd = ch.real_command || ch.command
    let execArgs = Array.isArray(ch.real_args) ? ch.real_args : (ch.args || [])
    let text = `${execCmd} ${execArgs.join(' ')}`

    if (ch.cluster) text += `   [cluster ×${ch.workers || '?'}]`

    kv('exec', truncateByVisible(text, summaryInnerTextWidth() - 12))
  }

  if (ch.net) {
    kv('net', `receive ${ch.net.recvBytes}  transmit ${ch.net.transmitBytes}`)
  }

  // 进程树：定位问题的关键——服务自身往往看不出负载，消耗都在子进程里
  if (Array.isArray(ch.procs) && ch.procs.length > 1) {
    kv('tree', `${ch.procCount} procs   CPU ${fmtCpu(ch.cpuTotal)}   MEM ${fmtMem(ch.memTotal)}`
      + `   (self ${fmtCpu(ch.cpu)} / ${fmtMem(ch.mem)})`)

    let list = ch.procs.slice(0, PROC_LIST_LIMIT)

    let maxw = summaryInnerTextWidth()

    list.forEach((p, i) => {
      let last = (i === list.length - 1) && ch.procs.length <= PROC_LIST_LIMIT
      let text = '   ' + (last ? '└─ ' : '├─ ')
        + padLeft(String(p.pid), 7) + '  '
        + padLeft(fmtCpu(p.cpu), 7) + '  '
        + padLeft(fmtMem(p.mem), 8) + '  '
        + (p.cmd || p.comm || '')

      lines.push(truncateByVisible(text, maxw))
    })

    /**
     * 折叠行必须把两级截断都算进去：
     *   1. 本地只展示前 PROC_LIST_LIMIT 条；
     *   2. daemon 侧的 procs 本身也有上限（procsOmitted 是被它截掉的数量）。
     * 只按本地看到的条数算，会把"其他 N 个"报少，让人误以为进程就这么几个。
     */
    let rest = ch.procs.slice(PROC_LIST_LIMIT)
    let restCount = rest.length + (ch.procsOmitted || 0)

    if (restCount > 0) {
      let restCpu = rest.reduce((a, x) => a + (parseFloat(x.cpu) || 0), 0)
        + (parseFloat(ch.omittedCpu) || 0)
      let restMem = rest.reduce((a, x) => a + (parseFloat(x.mem) || 0), 0)
        + (parseFloat(ch.omittedMem) || 0)

      lines.push('   └─ ' + `其他 ${restCount} 个进程  `
        + `${fmtCpu(restCpu)}  ${fmtMem(restMem)}`)
    }
  }

  if (ch.limit) {
    let keys = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']
    let parts = []
    keys.forEach(x => {
      if (ch.limit[x] !== undefined && ch.limit[x] > 0) {
        parts.push(`${x} ${fmtLimit(ch.limit[x], x)}`)
      }
    })
    if (parts.length > 0) kv('limit', parts.join('  '))
  }

  if (ch.cause) kv('cause', ch.cause)

  return lines
}

// 详情里最多列出的进程数，超出折叠为"其他 N 个进程"
const PROC_LIST_LIMIT = 5

/**
 * 表格内文本宽度（由列宽下限唯一确定）：每列占 width+2，列间 1 个连接符，
 * 两侧各留一个空格。进程树那几行按它截断成单行——命令很长时折行会丢掉
 * 树形缩进，列表就不好扫了。
 */
function summaryInnerTextWidth() {
  let cols = SUMMARY_MIN_WIDTHS.length
  let inner = SUMMARY_MIN_WIDTHS.reduce((a, w) => a + w + 2, 0) + Math.max(0, cols - 1)
  return inner - 2
}

const SUMMARY_HEADERS = ['Name', 'State', 'PID', 'CPU', 'MEM', 'TREE']

// 列宽下限：所有列都按已知最长形态预留固定宽度，多用户表跨实例完全对齐。
//   Name  16  —  应用名常规上限
//   State 10  —  最长状态 'RUNNING(D)'
//   PID   7   —  容纳 7 位 PID
//   CPU   6   —  '50.50%' 形态
//   MEM   7   —  '123.34M' 或转 G 后的 'XXX.XXG' 形态
//   TREE  20  —  '170.71%/98.97M ×3' 形态（进程树合计 + 树内进程数）
const SUMMARY_MIN_WIDTHS = [16, 10, 7, 6, 7, 20]

// 把单一 user 的 childs 列表组装成 rows + title。
// detail=true 时每个 cells 行后跟一个 span 详情行。
function buildRows(childs, { detail=false } = {}) {
  let rows = []
  for (let ch of childs) {
    rows.push({ type: 'cells', cells: summaryCells(ch) })
    if (detail) {
      rows.push({ type: 'span', lines: detailLines(ch) })
    }
  }
  return rows
}

module.exports = {
  readStatus,
  matchAppName,
  filterChilds,
  summaryCells,
  detailLines,
  buildRows,
  colorState,
  stateText,
  fmtLimit,
  fmtVal,
  fmtCpu,
  fmtMem,
  fmtSysLoad,
  SUMMARY_HEADERS,
  SUMMARY_MIN_WIDTHS
}
