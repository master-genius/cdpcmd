'use strict'

/**
 * cdpcd sock 客户端（NDJSON 协议 v1）—— CLI 侧唯一实现。
 *
 * 关键纪律（对应 cdpcmd-issues.md C1/C3/C5/C6/C7 的根治）：
 *   1. 失败必须四分类，不能一律当"未运行"：
 *      down    —— sock 不存在 / ECONNREFUSED  → daemon 未运行
 *      denied  —— EACCES / EPERM              → 权限/属主不符，不是未运行
 *      timeout —— connect 超时                → daemon 无响应（可能卡死）
 *      error   —— 其他
 *   2. 控制类是"已受理"语义，完成确认靠轮询目标状态，且**超时必须显式报错**；
 *   3. 长连接必须自动重连（daemon re-listen 会断开连接）；
 *   4. 一律单连接 + id 配对并发，不为每个请求新建连接。
 */

const net = require('net')

const CONNECT_TIMEOUT = 300
const REQUEST_TIMEOUT = 3000

/** 把底层错误归入四分类之一 */
function classify(err) {
  if (!err) return 'error'
  if (err.kind) return err.kind
  if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') return 'down'
  if (err.code === 'EACCES' || err.code === 'EPERM') return 'denied'
  return 'error'
}

/** 四分类 → 面向用户的中文说明（禁止静默空白，禁止把权限问题误报为未运行） */
function describe(kind, sockFile, err) {
  switch (kind) {
    case 'down':
      return `daemon 未运行（${sockFile} 不可连接），可尝试 cdpc service-start`
    case 'denied':
      return `无权限连接 ${sockFile}（sock 权限/属主不符）`
    case 'timeout':
      return `cdpcd 无响应（连接 ${sockFile} 超时 ${CONNECT_TIMEOUT}ms），daemon 可能卡死`
    default:
      return `连接 ${sockFile} 失败: ${err ? (err.message || err.code) : 'unknown'}`
  }
}

class SockClient {
  constructor(sockFile, opts = {}) {
    this.sockFile = sockFile
    this.connectTimeout = opts.connectTimeout || CONNECT_TIMEOUT
    this.timeout = opts.timeout || REQUEST_TIMEOUT
    this.autoReconnect = !!opts.autoReconnect
    this.onState = opts.onState || (() => {})

    this.conn = null
    this.buf = ''
    this.seq = 0
    this.pending = new Map()
    this.retry = 0
    this.connected = false
    // 是否曾经成功连接过：用于区分"从未连上（daemon 没跑）"与"连上后断线（重连中）"
    this.everConnected = false
    this.lastKind = ''
  }

  connect() {
    return new Promise((rv, rj) => {
      let done = false

      let timer = setTimeout(() => {
        if (done) return
        done = true
        try { this.conn.destroy() } catch (e) {}
        let err = new Error('connect-timeout')
        err.kind = 'timeout'
        this.lastKind = 'timeout'
        rj(err)
      }, this.connectTimeout)

      this.conn = net.createConnection(this.sockFile)
      this.conn.setEncoding('utf8')

      this.conn.on('connect', () => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.connected = true
        this.everConnected = true
        this.retry = 0
        this.lastKind = ''
        this.onState('connected')
        rv(true)
      })

      this.conn.on('error', err => {
        if (done) return
        done = true
        clearTimeout(timer)
        err.kind = classify(err)
        this.lastKind = err.kind
        rj(err)
      })

      this.conn.on('close', () => {
        this.connected = false
        for (let [, p] of this.pending) p.rj(new Error('connection-closed'))
        this.pending.clear()
        this.onState('disconnected')
        if (this.autoReconnect) this._scheduleReconnect()
      })

      this.conn.on('data', chunk => {
        this.buf += chunk
        let i = this.buf.indexOf('\n')
        while (i >= 0) {
          this._onLine(this.buf.substring(0, i))
          this.buf = this.buf.substring(i + 1)
          i = this.buf.indexOf('\n')
        }
      })
    })
  }

  _scheduleReconnect() {
    this.retry += 1
    // daemon re-listen 期间指数退避重连，界面显示"重连中"而不是清空
    let delay = Math.min(200 * Math.pow(2, this.retry - 1), 5000)
    this.onState(`reconnecting#${this.retry}`)
    let t = setTimeout(() => { this.connect().catch(() => {}) }, delay)
    t.unref && t.unref()
  }

  _onLine(line) {
    if (!line.trim()) return

    let msg
    try { msg = JSON.parse(line) } catch (err) { return }

    let key = (msg.id === null || msg.id === undefined) ? '__noid__' : String(msg.id)
    let p = this.pending.get(key)
    if (!p) return
    this.pending.delete(key)
    p.rv(msg)
  }

  /** 发一个请求（id 自动分配），返回配对的应答对象 */
  request(op, extra = {}) {
    let id = (this.seq += 1)
    let req = Object.assign({v: 1, id, op}, extra)

    return new Promise((rv, rj) => {
      if (!this.conn || this.conn.destroyed) return rj(new Error('not-connected'))

      let timer = setTimeout(() => {
        this.pending.delete(String(id))
        rj(new Error(`请求超时: ${op}`))
      }, this.timeout)

      this.pending.set(String(id), {
        rv: m => { clearTimeout(timer); rv(m) },
        rj: e => { clearTimeout(timer); rj(e) }
      })

      this.conn.write(JSON.stringify(req) + '\n')
    })
  }

  /**
   * 控制类 op：受理后轮询确认目标状态。
   * 替代原 get_app_state.js 的 35ms×280 文件轮询（其 readFileSync 无 try/catch，
   * state 文件缺失即崩溃；且超时后静默结束，用户看不到任何提示）。
   * @returns {object} {ok, state, ms} 或 {ok:false, error}
   */
  async control(op, name, wantState = '', waitMs = 10000) {
    /**
     * restart 的目标状态与当前状态可能相同（RUNNING → RUNNING），
     * 只比状态会在"状态还没开始迁移"时抓到旧的 RUNNING，误报重启成功。
     * 因此先记下旧 pid，要求 pid 变化才算完成。
     */
    let prevPid = null

    if (op === 'restart') {
      let h0 = await this.request('has', {name})
      let row0 = (h0.ok && h0.data && h0.data[0]) ? h0.data[0] : null
      if (row0 && row0.pid > 0) prevPid = row0.pid
    }

    let r = await this.request(op, {name})

    if (!r.ok) return r
    if (!wantState) return r

    let start = Date.now()
    let lastRow = null

    while (Date.now() - start < waitMs) {
      let h = await this.request('has', {name})
      let row = (h.ok && h.data && h.data[0]) ? h.data[0] : null

      if (row) lastRow = row

      if (wantState === 'REMOVED') {
        if (!row) return {ok: true, state: 'REMOVED', ms: Date.now() - start}
      } else if (row) {
        // 已禁用的服务永远起不来，立刻说清楚，不要白等到超时
        if (row.disabled && wantState === 'RUNNING') {
          return {ok: false, error: 'disabled', state: row.state}
        }

        if (row.state === wantState) {
          // restart：pid 未变说明还没真正重启，继续等
          if (!(prevPid !== null && row.pid === prevPid)) {
            return {ok: true, state: row.state, ms: Date.now() - start}
          }
        }
      }

      await new Promise(rv => setTimeout(rv, 50))
    }

    // 超时必须显式报错（C7：原实现静默结束，命令"卡一会儿然后没下文"），
    // 并带上当前状态便于判断卡在哪
    return {
      ok: false,
      error: 'wait-timeout',
      want: wantState,
      state: lastRow ? lastRow.state : null,
      disabled: lastRow ? !!lastRow.disabled : false
    }
  }

  close() {
    this.autoReconnect = false
    try { this.conn && this.conn.destroy() } catch (err) {}
  }
}

/**
 * 一次性查询：连接 → 请求 → 关闭。
 * @returns {{ok: boolean, data?: any, kind?: string, message?: string, reply?: object}}
 */
async function query(sockFile, op, extra = {}, opts = {}) {
  if (!sockFile) {
    return {ok: false, kind: 'down', message: '无法推导 sock 路径'}
  }

  let cli = new SockClient(sockFile, opts)

  try {
    await cli.connect()
  } catch (err) {
    let kind = classify(err)
    return {ok: false, kind, message: describe(kind, sockFile, err)}
  }

  try {
    let reply = await cli.request(op, extra)

    if (!reply.ok) {
      return {ok: false, kind: 'reply-error', message: reply.error || 'unknown', reply}
    }

    return {ok: true, data: reply.data, reply}
  } catch (err) {
    return {ok: false, kind: 'error', message: err.message}
  } finally {
    cli.close()
  }
}

module.exports = {SockClient, query, classify, describe, CONNECT_TIMEOUT}
