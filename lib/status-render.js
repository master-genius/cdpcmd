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

function visibleWidth(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, '').length
}

function padRight(s, width) {
  let pad = width - visibleWidth(s)
  return s + (pad > 0 ? ' '.repeat(pad) : '')
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
  if (headers) vrows.push({ type: 'cells', cells: headers })
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
      let mid = centerFill(' ' + opts.title + ' ', innerWidth, '─')
      return '┌' + mid + '┐'
    }
    let firstHasCols = vrows[0] && vrows[0].type === 'cells'
    if (firstHasCols) return '┌' + segs.join('┬') + '┐'
    return '┌' + '─'.repeat(innerWidth) + '┐'
  }

  let midBorder = (prevHasCols, nextHasCols) => {
    if (prevHasCols && nextHasCols) return '├' + segs.join('┼') + '┤'
    if (prevHasCols && !nextHasCols) return '├' + segs.join('┴') + '┤'
    if (!prevHasCols && nextHasCols) return '├' + segs.join('┬') + '┤'
    return '├' + '─'.repeat(innerWidth) + '┤'
  }

  let bottomBorder = (prevHasCols) => {
    if (prevHasCols) return '└' + segs.join('┴') + '┘'
    return '└' + '─'.repeat(innerWidth) + '┘'
  }

  let renderCellsRow = (cells) => {
    let parts = []
    for (let c = 0; c < cols; c++) {
      let t = (cells[c] === undefined || cells[c] === null) ? '' : String(cells[c])
      parts.push(' ' + padRight(t, widths[c]) + ' ')
    }
    return '│' + parts.join('│') + '│'
  }

  let renderSpanRow = (lines) => {
    let result = []
    let innerTextWidth = innerWidth - 2  // 两侧各留一空格
    let arr = Array.isArray(lines) ? lines : [String(lines || '')]
    for (let ln of arr) {
      let wrapped = wrapText(ln, innerTextWidth)
      for (let w of wrapped) {
        result.push('│ ' + padRight(w, innerTextWidth) + ' │')
      }
    }
    if (result.length === 0) {
      result.push('│ ' + ' '.repeat(innerTextWidth) + ' │')
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

module.exports = {
  renderTable,
  visibleWidth,
  padRight,
  centerFill,
  wrapText
}
