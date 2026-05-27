'use strict'

const fs = require('fs')

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

// loadfile 写入存在并发风险（cdpcd 周期 fs.writeFile，读侧偶尔读到半文件），
// 用与原 outstatus 一致的指数小抖动重试。
async function readLoad(loadfile, retries=10) {
  try {
    let data = fs.readFileSync(loadfile, { encoding: 'utf8' })
    return JSON.parse(data)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    if (retries > 0) {
      await new Promise(rv => setTimeout(rv, parseInt(Math.random() * 5) + retries))
      return readLoad(loadfile, retries - 1)
    }
    throw err
  }
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

// 汇总表的一行（cells row）
function summaryCells(ch) {
  return [
    ch.name,
    colorState(stateText(ch)),
    ch.pid ? String(ch.pid) : '-',
    fmtCpu(ch.cpu),
    fmtMem(ch.mem)
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

  if (ch.net) {
    kv('net', `receive ${ch.net.recvBytes}  transmit ${ch.net.transmitBytes}`)
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

const SUMMARY_HEADERS = ['Name', 'State', 'PID', 'CPU', 'MEM']

// 列宽下限：所有列都按已知最长形态预留固定宽度，多用户表跨实例完全对齐。
//   Name  16  —  应用名常规上限
//   State 10  —  最长状态 'RUNNING(D)'
//   PID   7   —  容纳 7 位 PID
//   CPU   6   —  '50.50%' 形态
//   MEM   7   —  '123.34M' 或转 G 后的 'XXX.XXG' 形态
const SUMMARY_MIN_WIDTHS = [16, 10, 7, 6, 7]

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
  readLoad,
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
  SUMMARY_HEADERS,
  SUMMARY_MIN_WIDTHS
}
