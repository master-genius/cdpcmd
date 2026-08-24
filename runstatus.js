'use strict'

/**
 * cdpc status --runtime 的 TUI 入口。
 *
 * 输入：
 *   CDPC_RUNTIME_TARGETS 环境变量，行分隔；每行 "<user>\t<sockFile>"
 *     - user 可为空字符串（不显示 title）
 *
 * 命令行参数：
 *   -l               初始即展开详情
 *   --period N       刷新周期秒数（默认 1，最小 0.2，最大 60）
 *   [name ...]       app 过滤（位置参数，可用 user:name 形式）
 *
 * 行为：
 *   - 非 TTY：回退为一次性快照打印（与 outstatus 多次调用等价）
 *   - TTY：进入备用屏；周期查询 sock（每目标一条长连接 + 断线指数退避重连，
 *     不每秒新建连接），全帧重绘；按键控制滚动 / 详情 / 退出
 */

const npargv = require('npargv')

const model = require('./lib/status-model')
const { renderTable, truncateByVisible } = require('./lib/status-render')
const tty = require('./lib/status-tty')
const {SockClient, classify, describe} = require('./lib/sockclient')

let arg = npargv({
  '-l': { type: 'boolean', default: false, name: 'list' },
  '--period': { type: 'string', default: '1', name: 'period' },
  // 兼容传入但本入口不直接使用的项（避免被当成位置参数）
  '--runtime': { type: 'boolean', default: false, name: 'runtime' },
  '--user': { type: 'string', default: '', name: 'user' },
  '--has': { type: 'boolean', default: false, name: 'has' },
  '--json': { type: 'boolean', default: false, name: 'json' },
  '--encode-json': { type: 'boolean', default: false, name: 'encodeJson' },
  '--limit-user': { type: 'string', default: '', name: 'limitUser' }
})

let args = arg.args
let applist = arg.list.slice(1)

let periodMs = (() => {
  let n = parseFloat(args.period)
  if (!isFinite(n) || n <= 0) n = 1
  if (n < 0.2) n = 0.2
  if (n > 60) n = 60
  return Math.round(n * 1000)
})()

// 解析 targets
function parseTargets() {
  let raw = process.env.CDPC_RUNTIME_TARGETS || ''
  let result = []
  for (let line of raw.split('\n')) {
    line = line.trim()
    if (!line) continue
    let ind = line.indexOf('\t')
    if (ind < 0) {
      // 兼容空格分隔
      ind = line.indexOf(' ')
      if (ind < 0) continue
    }
    let user = line.substring(0, ind).trim()
    let sock = line.substring(ind + 1).trim()
    if (sock) result.push({ user, sock })
  }
  return result
}

let targets = parseTargets()
if (targets.length === 0) {
  console.error('runstatus: no targets (set CDPC_RUNTIME_TARGETS)')
  process.exit(1)
}

// ------------------------------------------------------------
// 一次性扫描：返回扁平化的渲染行序列 + 第一个非空 sys（host-wide 信息，跨 cdpcd 实例一致）
// ------------------------------------------------------------
// 每个目标维持一条长连接（daemon re-listen 时自动重连），避免每个刷新周期新建连接
const conns = new Map()

function connFor(t) {
  if (conns.has(t.sock)) return conns.get(t.sock)

  let cli = new SockClient(t.sock, {autoReconnect: true})
  let entry = {cli, err: null, ready: null}

  // 首次连接的结果要能被首帧等到，否则第一帧永远显示"未连接"
  entry.ready = cli.connect().then(() => true).catch(err => {
    entry.err = err
    return false
  })

  conns.set(t.sock, entry)

  return entry
}

async function fetchTarget(t) {
  let e = connFor(t)

  // 只在首帧阻塞等待；后续帧不等（重连由客户端指数退避自己推进）
  if (e.ready) {
    await e.ready
    e.ready = null
  }

  if (!e.cli.connected) {
    // 明确显示状态而不是清空该用户的区块。
    // 曾经连上过 = daemon 在重建 socket，显示"重连中"；
    // 从未连上 = daemon 根本没跑（或权限不符），要显示真实原因而不是"重连中"。
    if (e.cli.everConnected) return {ok: false, message: '重连中…'}

    let kind = e.err ? classify(e.err) : 'down'
    return {ok: false, message: describe(kind, t.sock, e.err)}
  }

  try {
    let reply = await e.cli.request('status')
    if (!reply.ok) return {ok: false, message: reply.error || 'unknown'}
    return {ok: true, data: reply.data}
  } catch (err) {
    return {ok: false, message: err.message}
  }
}

/** 关闭所有长连接：socket 句柄会保持事件循环，不关会导致进程不退出 */
function closeConns() {
  for (let e of conns.values()) {
    try { e.cli.close() } catch (err) {}
  }
  conns.clear()
}

async function snapshot(detail, termCols) {
  // 先把所有目标取回来：列宽必须由**全部用户的内容**一起决定，
  // 各表用同一套宽度才能跨用户对齐；边取边渲染做不到这一点。
  let fetched = []
  let sysSource = null

  for (let t of targets) {
    let res = await fetchTarget(t)

    if (!res.ok) {
      fetched.push({ t, ok: false, message: res.message })
      continue
    }

    let ld = res.data
    if (!sysSource && ld.sys) sysSource = ld

    fetched.push({ t, ok: true, childs: model.filterChilds(ld, applist, t.user) })
  }

  // 展开详情时把表格放宽到终端宽度的 85%（只延长最后一列），收起即恢复默认
  let allChilds = []
  for (let f of fetched) {
    if (f.ok) for (let c of f.childs) allChilds.push(c)
  }
  let widths = model.summaryWidths(detail, termCols, allChilds)

  let allLines = []

  for (let f of fetched) {
    if (!f.ok) {
      if (allLines.length > 0) allLines.push('')
      // TUI 按行计算帧高，单个元素里绝不能含换行
      let lines = String(f.message).split('\n')
      allLines.push(`  ${f.t.user || 'root'}  (${lines[0]})`)
      for (let extra of lines.slice(1)) allLines.push(extra)
      continue
    }

    if (f.childs.length === 0) continue

    // 同 outstatus：指定了具体服务名就完整列出进程树，不封顶
    let rows = model.buildRows(f.childs, {
      detail,
      widths,
      fullProcs: applist.length > 0
    })
    let title = f.t.user ? `User: ${f.t.user}` : undefined
    let lines = renderTable(model.SUMMARY_HEADERS, rows, {
      title,
      minWidths: widths,
      boldHeader: true
    })
    if (allLines.length > 0) allLines.push('')  // 表间空行
    for (let ln of lines) allLines.push(ln)
  }

  return { lines: allLines, sys: sysSource }
}

// ------------------------------------------------------------
// 非 TTY：一次性打印（与 outstatus 多目标串联等价）
// ------------------------------------------------------------
async function runSnapshotOnce() {
  let snap = await snapshot(args.list, process.stdout.columns)
  if (snap.lines.length > 0) console.log(snap.lines.join('\n'))
  closeConns()
}

// ------------------------------------------------------------
// TTY 主循环
// ------------------------------------------------------------
function runTTY() {
  let state = {
    detail: args.list,
    firstVisibleRow: 0,
    content: [],         // 当前帧的全部内容行
    sysLine: '',         // 当前帧顶部 sticky 行（整机 CPU/MEM）
    quitting: false,
    needRedraw: false
  }

  let ctrl = null

  let render = () => {
    if (!ctrl) return
    let { rows: termRows, cols: termCols } = ctrl.getSize()
    // sysLine 可能含换行（用于上下留白），按行拆分后全部 sticky-top
    let topLines = state.sysLine ? state.sysLine.split('\n') : []
    let topRows = topLines.length
    let footerRows = 1
    let visibleRows = Math.max(1, termRows - topRows - footerRows)
    let total = state.content.length

    // 滚动夹紧
    let maxFirst = Math.max(0, total - visibleRows)
    if (state.firstVisibleRow > maxFirst) state.firstVisibleRow = maxFirst
    if (state.firstVisibleRow < 0) state.firstVisibleRow = 0

    let last = Math.min(total, state.firstVisibleRow + visibleRows)
    let window = state.content.slice(state.firstVisibleRow, last)

    // 视口不足时补空行，避免备用屏残留
    let pad = visibleRows - window.length
    for (let i = 0; i < pad; i++) window.push('')

    // 状态条
    let from = total === 0 ? 0 : state.firstVisibleRow + 1
    let to = last
    let footer = ` [${from}-${to}/${total}]  ↑↓/PgUp/PgDn scroll  g/G top/bot  l detail (${state.detail ? 'on' : 'off'})  r refresh  q quit `
    if (footer.length > termCols) footer = footer.slice(0, termCols)
    // 反色一行作为状态条
    let footerLine = '\x1b[7m' + footer + ' '.repeat(Math.max(0, termCols - footer.length)) + '\x1b[0m'

    // 按可见宽度（剥离 ANSI）裁切到 termCols；避免把 escape 序列截在中间
    let safeLine = (s) => truncateByVisible(s, termCols)

    let frame = []
    for (let ln of topLines) frame.push(safeLine(ln))
    for (let ln of window) frame.push(safeLine(ln))
    frame.push(footerLine)
    tty.fullRedraw(ctrl.write, frame)
  }

  let refresh = async () => {
    // 每帧都重新取终端宽度：窗口改过大小后，下一次刷新就按新宽度重排
    let snap = await snapshot(state.detail, ctrl ? ctrl.getSize().cols : 0)
    state.content = snap.lines
    state.sysLine = snap.sys ? model.fmtSysLoad(snap.sys) : ''
    render()
  }

  let onKey = (key) => {
    if (key === 'quit') {
      state.quitting = true
      closeConns()
      ctrl.cleanup()
      process.exit(0)
    }
    if (key === 'up') { state.firstVisibleRow--; render(); return }
    if (key === 'down') { state.firstVisibleRow++; render(); return }
    if (key === 'pageup') {
      let { rows: termRows } = ctrl.getSize()
      state.firstVisibleRow -= Math.max(1, termRows - 2)
      render()
      return
    }
    if (key === 'pagedown') {
      let { rows: termRows } = ctrl.getSize()
      state.firstVisibleRow += Math.max(1, termRows - 2)
      render()
      return
    }
    if (key === 'home') { state.firstVisibleRow = 0; render(); return }
    if (key === 'end') { state.firstVisibleRow = Number.MAX_SAFE_INTEGER; render(); return }
    if (key === 'detail') { state.detail = !state.detail; refresh(); return }
    if (key === 'refresh') { refresh(); return }
  }

  ctrl = tty.enterTTY(onKey)
  ctrl.onResize(() => render())

  // 首帧
  refresh()

  // 周期刷新
  let timer = setInterval(() => {
    if (state.quitting) return
    refresh()
  }, periodMs)

  process.on('exit', () => { clearInterval(timer); closeConns() })
}

;(async () => {
  if (!process.stdout.isTTY) {
    await runSnapshotOnce()
    return
  }
  runTTY()
})()
