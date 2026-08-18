'use strict'

/**
 * 表格渲染器，支持 span-row（跨列子行）和顶边线嵌入标题。
 *
 * 行类型：
 *   { type: 'cells', cells: [string, ...] }   普通列对齐行
 *   { type: 'span',  lines: [string, ...]  }  跨列子行（可多行；按内宽自动换行）
 *
 * 选项：
 *   { title: string }   把标题居中嵌入顶边线（不占独立行）
 *
 * 返回字符串行数组（不带 \n），便于 runtime 视口切片与拼接。
 */

// 表格框线颜色：暗白色（dim white），仅用于装饰边框，不影响内容可读性。
// 与 status-model.js 中的 dim 约定一致（如 EXIT 状态用 '\x1b[2;37m'）。
const BORDER_COLOR = '\x1b[2;37m'
const RESET = '\x1b[0m'

// 给框线字符染色：仅包裹框线，内容单元各自携带自己的颜色码不受影响。
function dim(s) {
  return BORDER_COLOR + s + RESET
}

function visibleWidth(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length
}

function padRight(s, width) {
  let pad = width - visibleWidth(s)
  return s + (pad > 0 ? ' '.repeat(pad) : '')
}

// 左填充：必须按"可见宽度"算，字符串里可能含 ANSI 颜色码，
// 直接用 padStart 会把转义序列算进长度，造成列错位。
function padLeft(s, width) {
  let pad = width - visibleWidth(s)
  return (pad > 0 ? ' '.repeat(pad) : '') + s
}

function centerFill(s, width, fillChar=' ') {
  let pad = width - visibleWidth(s)
  if (pad <= 0) return s
  let left = Math.floor(pad / 2)
  let right = pad - left
  return fillChar.repeat(left) + s + fillChar.repeat(right)
}

// 按可见宽度换行；空白处优先断行，超长 token 硬断。
function wrapText(text, width) {
  if (width <= 0) return [String(text)]
  let s = String(text)
  if (visibleWidth(s) <= width) return [s]

  let tokens = s.split(/(\s+)/)
  let lines = []
  let cur = ''
  for (let t of tokens) {
    if (t.length === 0) continue
    let tw = visibleWidth(t)
    if (tw > width) {
      if (cur) { lines.push(cur); cur = '' }
      let rem = t
      while (visibleWidth(rem) > width) {
        lines.push(rem.slice(0, width))
        rem = rem.slice(width)
      }
      cur = rem
      continue
    }
    if (visibleWidth(cur) + tw > width) {
      lines.push(cur)
      cur = /^\s+$/.test(t) ? '' : t
    } else {
      cur += t
    }
  }
  if (cur || lines.length === 0) lines.push(cur)
  return lines
}

/**
 * @param {string[]|null} headers 列标题（null 不渲染表头行）
 * @param {Array} rows  行对象数组
 * @param {Object} [opts]  { title?: string }
 * @returns {string[]}
 */
function renderTable(headers, rows, opts={}) {
  // 虚拟行序列：表头作为一个 cells pseudo-row 排在最前
  let vrows = []
  if (headers) {
    let h = headers
    if (opts.boldHeader) h = headers.map(x => `\x1b[1m${x}\x1b[0m`)
    vrows.push({ type: 'cells', cells: h })
  }
  for (let r of rows) vrows.push(r)

  if (vrows.length === 0) return []

  // 列宽：取所有 cells 行中每列的最大可见宽度
  let cellsRows = vrows.filter(r => r.type === 'cells')
  let cols = 0
  for (let r of cellsRows) {
    if (r.cells.length > cols) cols = r.cells.length
  }
  if (cols === 0) cols = 1  // 退化保护

  let widths = new Array(cols).fill(0)
  for (let r of cellsRows) {
    for (let i = 0; i < r.cells.length; i++) {
      let w = visibleWidth(r.cells[i] === undefined ? '' : r.cells[i])
      if (w > widths[i]) widths[i] = w
    }
  }

  // 应用列宽下限（用于多表跨实例对齐：如多用户场景下 Name 列固定下限，
  // 表与表之间宽度天然一致，不必做严格的跨表统一计算）。
  let minWidths = Array.isArray(opts.minWidths) ? opts.minWidths : []
  for (let i = 0; i < cols; i++) {
    if (minWidths[i] && minWidths[i] > widths[i]) widths[i] = minWidths[i]
  }

  // 每列填一段 `─`.repeat(widths[i]+2)，列间以 junction 连接
  let segs = widths.map(w => '─'.repeat(w + 2))
  // 内宽（不含两侧 │）= 各段长度之和 + 列间 junction 数
  let innerWidth = segs.reduce((a, b) => a + b.length, 0) + Math.max(0, cols - 1)

  // 若有 title 但宽度不够包住 ' title ' 文本，至少要把 innerWidth 撑到能放下
  if (opts.title) {
    let needed = visibleWidth(opts.title) + 4  // ' title ' + 两侧至少各一个 ─
    if (innerWidth < needed) {
      // 把多余宽度补到最后一列，保持列对齐
      let delta = needed - innerWidth
      widths[cols - 1] += delta
      segs[cols - 1] = '─'.repeat(widths[cols - 1] + 2)
      innerWidth += delta
    }
  }

  let out = []

  let topBorder = () => {
    if (opts.title) {
      // 左对齐：固定 '──' 前缀 + ' title ' + 剩余用 '─' 填满
      // 框线染暗，标题文本保持正常亮度，确保可读。
      let titleText = ' ' + opts.title + ' '
      let prefix = '──'
      let pad = innerWidth - prefix.length - visibleWidth(titleText)
      if (pad < 0) pad = 0
      return dim('┌' + prefix) + titleText + dim('─'.repeat(pad) + '┐')
    }
    let firstHasCols = vrows[0] && vrows[0].type === 'cells'
    if (firstHasCols) return dim('┌' + segs.join('┬') + '┐')
    return dim('┌' + '─'.repeat(innerWidth) + '┐')
  }

  let midBorder = (prevHasCols, nextHasCols) => {
    if (prevHasCols && nextHasCols) return dim('├' + segs.join('┼') + '┤')
    if (prevHasCols && !nextHasCols) return dim('├' + segs.join('┴') + '┤')
    if (!prevHasCols && nextHasCols) return dim('├' + segs.join('┬') + '┤')
    return dim('├' + '─'.repeat(innerWidth) + '┤')
  }

  let bottomBorder = (prevHasCols) => {
    if (prevHasCols) return dim('└' + segs.join('┴') + '┘')
    return dim('└' + '─'.repeat(innerWidth) + '┘')
  }

  let renderCellsRow = (cells) => {
    // 列分隔的 │ 单独染暗，单元内容各自携带颜色码不受影响。
    let bar = dim('│')
    let parts = []
    for (let c = 0; c < cols; c++) {
      let t = (cells[c] === undefined || cells[c] === null) ? '' : String(cells[c])
      parts.push(' ' + padRight(t, widths[c]) + ' ')
    }
    return bar + parts.join(bar) + bar
  }

  let renderSpanRow = (lines) => {
    let bar = dim('│')
    let result = []
    let innerTextWidth = innerWidth - 2  // 两侧各留一空格
    let arr = Array.isArray(lines) ? lines : [String(lines || '')]
    for (let ln of arr) {
      let wrapped = wrapText(ln, innerTextWidth)
      for (let w of wrapped) {
        result.push(bar + ' ' + padRight(w, innerTextWidth) + ' ' + bar)
      }
    }
    if (result.length === 0) {
      result.push(bar + ' ' + ' '.repeat(innerTextWidth) + ' ' + bar)
    }
    return result
  }

  out.push(topBorder())

  for (let i = 0; i < vrows.length; i++) {
    let r = vrows[i]
    if (r.type === 'cells') {
      out.push(renderCellsRow(r.cells))
    } else {
      for (let line of renderSpanRow(r.lines)) out.push(line)
    }

    let prevHasCols = r.type === 'cells'
    let next = vrows[i + 1]
    if (!next) {
      out.push(bottomBorder(prevHasCols))
    } else {
      let nextHasCols = next.type === 'cells'
      out.push(midBorder(prevHasCols, nextHasCols))
    }
  }

  return out
}

// 按可见宽度截断字符串，保留 ANSI 转义码完整跨过。
// 适合用作 runtime 视口边界裁切。
function truncateByVisible(s, maxVisible) {
  s = String(s)
  if (visibleWidth(s) <= maxVisible) return s
  let out = ''
  let visible = 0
  let i = 0
  while (i < s.length && visible < maxVisible) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      let j = i + 2
      while (j < s.length && !/[a-zA-Z~]/.test(s[j])) j++
      out += s.slice(i, j + 1)
      i = j + 1
    } else {
      out += s[i]
      visible++
      i++
    }
  }
  return out
}

module.exports = {
  renderTable,
  visibleWidth,
  padRight,
  centerFill,
  wrapText,
  truncateByVisible,
  padLeft
}
