'use strict'

/**
 * cdpc status --runtime 的 TUI 入口。
 *
 * 输入：
 *   CDPC_RUNTIME_TARGETS 环境变量，行分隔；每行 "<user>\t<loadfile>"
 *     - user 可为空字符串（不显示 title）
 *
 * 命令行参数：
 *   -l               初始即展开详情
 *   --period N       刷新周期秒数（默认 1，最小 0.2，最大 60）
 *   [name ...]       app 过滤（位置参数，可用 user:name 形式）
 *
 * 行为：
 *   - 非 TTY：回退为一次性快照打印（与 outstatus 多次调用等价）
 *   - TTY：进入备用屏；周期 readLoad，全帧重绘；按键控制滚动 / 详情 / 退出
 */

const npargv = require('npargv')

const model = require('./lib/status-model')
const { renderTable } = require('./lib/status-render')
const tty = require('./lib/status-tty')

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
    let loadfile = line.substring(ind + 1).trim()
    if (loadfile) result.push({ user, loadfile })
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
async function snapshot(detail) {
  let allLines = []
  let sysSource = null
  for (let t of targets) {
    let ld = await model.readLoad(t.loadfile).catch(() => null)
    if (!ld) continue
    if (!sysSource && ld.sys) sysSource = ld
    let childs = model.filterChilds(ld, applist, t.user)
    if (childs.length === 0) continue
    let rows = model.buildRows(childs, { detail })
    let title = t.user ? `User: ${t.user}` : undefined
    let lines = renderTable(model.SUMMARY_HEADERS, rows, {
      title,
      minWidths: model.SUMMARY_MIN_WIDTHS,
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
  let snap = await snapshot(args.list)
  if (snap.lines.length > 0) console.log(snap.lines.join('\n'))
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
    let topRows = state.sysLine ? 1 : 0
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

    // 每行裁切到 termCols（含 ANSI 时可能截到 escape 中间，但状态/title 之外行宽通常 ≤ cols；
    // 极端窄屏下用纯字符近似截断）
    let safeLine = (s) => s.length > termCols ? s.slice(0, termCols) : s

    let frame = []
    if (state.sysLine) frame.push(safeLine(state.sysLine))
    for (let ln of window) frame.push(safeLine(ln))
    frame.push(footerLine)
    tty.fullRedraw(ctrl.write, frame)
  }

  let refresh = async () => {
    let snap = await snapshot(state.detail)
    state.content = snap.lines
    state.sysLine = snap.sys ? model.fmtSysLoad(snap.sys) : ''
    render()
  }

  let onKey = (key) => {
    if (key === 'quit') {
      state.quitting = true
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

  process.on('exit', () => clearInterval(timer))
}

;(async () => {
  if (!process.stdout.isTTY) {
    await runSnapshotOnce()
    return
  }
  runTTY()
})()
