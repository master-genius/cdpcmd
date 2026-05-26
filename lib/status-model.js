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

// 汇总表的一行（cells row）
function summaryCells(ch) {
  return [
    ch.name,
    colorState(stateText(ch)),
    ch.pid ? String(ch.pid) : '-',
    fmtVal(ch.cpu, '%'),
    fmtVal(ch.mem, 'M')
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
  SUMMARY_HEADERS
}
