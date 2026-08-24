'use strict'

const sock = require('./sockclient')
const { truncateByVisible, padLeft, visibleWidth } = require('./status-render')

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

/**
 * limit 字段的单位归一。
 *
 * maxrss / rssOffset 的单位是 **KB** —— 比较对象是 cdpc 从 /proc 的 rss
 * 页数换算出来的 rssKB。注意别跟 cgroup 的 memory 混：那个是**字节**，
 * 由内核强制执行；这里是 cdpc 自己轮询判定后重启或停止。
 *
 * maxRestart 是次数，无单位。
 */
function fmtLimit(val, key) {
  let num_1M = 1024
  switch (key) {
    case 'maxrss':
    case 'rssOffset':
      if (val <= num_1M) return `${parseFloat(val).toFixed(2)}K`
      return `${parseFloat(val / 1024).toFixed(2)}M`

    case 'maxRestart':
      return `${val} 次`
  }
  return val
}

/**
 * 详情里展示的 limit 键。
 *
 * maxtime / frequency / maxdaylimit 三个在 cdpc 里只被规范化、**没有任何地方
 * 读取**（index.js 里除了 checkConfig 的取值兜底和默认值以外查不到引用），
 * 所以概览详情不再显示它们 —— 把无效限额混在有效限额里展示，比不显示更糟。
 * 完整配置转储仍然可以在 `cdpc inspect` 看到，那里会标注未生效。
 */
const EFFECTIVE_LIMIT_KEYS = ['maxrss', 'rssOffset', 'maxRestart']

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

/**
 * 展开详情时的表格宽度。
 *
 * 概览（不展开）保持默认下限不动——那套宽度是按"多用户多表跨实例对齐"
 * 定的，加宽会破坏对齐，而概览本来也不需要显示完整命令。
 * 一旦展开详情（-l / runtime 的 l），命令、exec、进程树才是主角，
 * 这时把整行放宽到**终端宽度的 85%**，并且只延长最后一列：
 * 前几列宽度不变，多用户的表之间前几列依旧天然对齐。
 * 收起详情就回到默认下限，宽度自然恢复。
 */
const DETAIL_WIDTH_RATIO = 0.85

// 由列宽数组算出表格内宽：每列占 width+2，列间 1 个连接符
function widthsInner(widths) {
  return widths.reduce((a, w) => a + w + 2, 0) + Math.max(0, widths.length - 1)
}

/**
 * 内容驱动的列宽：renderTable 自己也会把放不下内容的列撑开，
 * 这里必须先做同样的计算，否则算出来的"85%"根本不是最终宽度——
 * 服务名最长可到 50（cdpc 的 _checkAppName 上限），一个 40 字符的名字
 * 就能在算好的宽度之上再顶出 24 列，右边框直接被 TUI 裁掉。
 */
function contentWidths(childs) {
  let widths = SUMMARY_HEADERS.map(h => visibleWidth(h))

  for (let ch of (childs || [])) {
    let cells = summaryCells(ch)
    for (let i = 0; i < widths.length; i++) {
      let w = visibleWidth(cells[i] === undefined ? '' : cells[i])
      if (w > widths[i]) widths[i] = w
    }
  }

  return widths
}

function summaryWidths(detail, termCols, childs) {
  let base = SUMMARY_MIN_WIDTHS.slice()

  // 先并入内容宽度，得到 renderTable 最终会用的那套列宽
  let content = contentWidths(childs)
  for (let i = 0; i < base.length; i++) {
    if (content[i] > base[i]) base[i] = content[i]
  }

  if (!detail) return base

  let cols = parseInt(termCols, 10)
  // 非 TTY（重定向到文件 / 管道）拿不到宽度：维持默认，输出保持可预测
  if (!isFinite(cols) || cols <= 0) return base

  // 整行含两侧 │，所以目标内宽要减 2
  let maxInner = Math.floor(cols * DETAIL_WIDTH_RATIO) - 2
  let cur = widthsInner(base)

  // 终端本来就窄于当前宽度时只维持现状，不做收窄：
  // 收窄会把各列挤到读不出来，反而不如让终端自己折行。
  if (maxInner <= cur) return base

  base[base.length - 1] += maxInner - cur

  return base
}

/**
 * 表格内可写文本的宽度（两侧各留一个空格）。
 */
function summaryInnerTextWidth(widths) {
  return widthsInner(Array.isArray(widths) ? widths : SUMMARY_MIN_WIDTHS) - 2
}

// 在可见宽度 width 处硬切一刀，返回 [前段, 后段]
function hardSplit(s, width) {
  let head = truncateByVisible(s, width)
  return [head, s.slice(head.length)]
}

// 优先在空格处断行；整段没有空格（长路径、长 URL）才按宽度硬断
function splitPreferSpace(s, width) {
  let [head, rest] = hardSplit(s, width)

  if (rest === '') return [head, '']

  let idx = head.lastIndexOf(' ')
  if (idx > 0) return [s.slice(0, idx), s.slice(idx + 1).replace(/^ +/, '')]

  return [head, rest]
}

/**
 * 命令折行：第一行接在 prefix 之后，第二行缩进到**命令起始列**对齐。
 *
 * 最多两行；两行还装不下就保留两行、截断第二行——超出部分的完整命令
 * 去 `cdpc inspect` 看。
 *
 * @param {string} prefix     第一行的前缀（可含 ANSI）
 * @param {string} text       要折行的正文
 * @param {number} innerWidth 表格内文本宽度
 * @param {string} contPrefix 续行前缀，宽度须等于 prefix 的可见宽度
 */
function wrapCommand(prefix, text, innerWidth, contPrefix) {
  let s = String(text === undefined || text === null ? '' : text)
  let avail = innerWidth - visibleWidth(prefix)

  if (avail <= 0) return [truncateByVisible(prefix + s, innerWidth)]
  if (visibleWidth(s) <= avail) return [prefix + s]

  let [first, rest] = splitPreferSpace(s, avail)
  let contAvail = innerWidth - visibleWidth(contPrefix)

  // 续行一个字符都放不下（前缀已经吃满内宽）：只能退回单行截断
  if (contAvail <= 0) return [truncateByVisible(prefix + s, innerWidth)]

  /**
   * tree 那行的值带 ANSI（fmtCpu/fmtMem 会按阈值着色）。真折行时第一行末尾
   * 可能停在未闭合的 SGR 上，颜色会渗到续行乃至整帧，所以补一个 reset。
   */
  let head = prefix + first
  if (head.indexOf('\x1b') >= 0) head += '\x1b[0m'

  // 两行仍装不下时截断第二行（而不是退回单行）：能多显示一行是一行
  return [head, contPrefix + truncateByVisible(rest, contAvail)]
}

// 详情下挂的 span row 内容（多行）
function detailLines(ch, opts={}) {
  let innerWidth = opts.innerTextWidth || summaryInnerTextWidth()

  // kv 前缀固定宽度：'╰─ '/'   '(3) + key.padEnd(7)，续行缩进到值的起始列
  const KEY_W = 7
  const KV_PREFIX_W = 3 + KEY_W
  const KV_CONT = ' '.repeat(KV_PREFIX_W)

  let lines = []
  let kv = (k, v) => {
    let prefix = (lines.length === 0 ? '╰─ ' : '   ') + k.padEnd(KEY_W, ' ')
    let text = (v === undefined || v === '') ? '--' : v
    for (let ln of wrapCommand(prefix, text, innerWidth, KV_CONT)) lines.push(ln)
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

    kv('exec', text)
  }

  if (ch.net) {
    kv('net', `receive ${ch.net.recvBytes}  transmit ${ch.net.transmitBytes}`)
  }

  // 进程树：定位问题的关键——服务自身往往看不出负载，消耗都在子进程里
  if (Array.isArray(ch.procs) && ch.procs.length > 1) {
    kv('tree', `${ch.procCount} procs   CPU ${fmtCpu(ch.cpuTotal)}   MEM ${fmtMem(ch.memTotal)}`
      + `   (self ${fmtCpu(ch.cpu)} / ${fmtMem(ch.mem)})`)

    let list = ch.procs.slice(0, PROC_LIST_LIMIT)

    list.forEach((p, i) => {
      let last = (i === list.length - 1) && ch.procs.length <= PROC_LIST_LIMIT

      // 前缀宽度固定 34 列：'   '(3) + 连接符(3) + pid(7) + 2 + cpu(7) + 2 + mem(8) + 2
      let prefix = '   ' + (last ? '└─ ' : '├─ ')
        + padLeft(String(p.pid), 7) + '  '
        + padLeft(fmtCpu(p.cpu), 7) + '  '
        + padLeft(fmtMem(p.mem), 8) + '  '

      /**
       * 续行缩进到命令起始列。非末项保留竖线，表示这一支下面还有兄弟节点；
       * 末项树形已经收口，留空即可，否则会误示还有后续条目。
       */
      let cont = '   ' + (last ? ' ' : '│')
        + ' '.repeat(Math.max(0, visibleWidth(prefix) - 4))

      for (let ln of wrapCommand(prefix, p.cmd || p.comm || '', innerWidth, cont)) {
        lines.push(ln)
      }
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
    let keys = EFFECTIVE_LIMIT_KEYS
    let parts = []
    keys.forEach(x => {
      if (ch.limit[x] !== undefined && ch.limit[x] > 0) {
        parts.push(`${x} ${fmtLimit(ch.limit[x], x)}`)
      }
    })
    if (parts.length > 0) kv('limit', parts.join('  '))
  }

  /**
   * 退出码与信号：被 cgroup OOM kill 或被外部 kill -9 打死时，服务在详情里
   * 只有一个 EXIT，没有任何线索。signal 一直记在 cdpc 侧，之前没暴露出来。
   */
  if (ch.state === 'EXIT' && (ch.signal || (ch.code !== null && ch.code !== undefined))) {
    let parts = []
    if (ch.code !== null && ch.code !== undefined) parts.push(`code ${ch.code}`)
    if (ch.signal) parts.push(`signal ${ch.signal}`)
    kv('exit', parts.join('   '))
  }

  if (ch.cause) kv('cause', ch.cause)

  return lines
}

// 详情里最多列出的进程数，超出折叠为"其他 N 个进程"
const PROC_LIST_LIMIT = 5

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
function buildRows(childs, { detail=false, widths=null } = {}) {
  let innerTextWidth = summaryInnerTextWidth(widths)
  let rows = []
  for (let ch of childs) {
    rows.push({ type: 'cells', cells: summaryCells(ch) })
    if (detail) {
      rows.push({ type: 'span', lines: detailLines(ch, { innerTextWidth }) })
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
  SUMMARY_MIN_WIDTHS,
  summaryWidths,
  summaryInnerTextWidth,
  wrapCommand
}
