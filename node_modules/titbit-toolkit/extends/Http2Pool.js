'use strict';

const http2 = require('node:http2')
const crypto = require('node:crypto')

class Http2Pool {
  
  constructor(options = {}) {
    // 存储session的Map
    if (!options || typeof options !== 'object') options = {}
    if (!options.connectOptions) options.connectOptions = {}

    this.pool = new Map()
    
    // 配置项
    this.maxStreamId = !isNaN(options.maxStreamId) && options.maxStreamId > 1
                        ? options.maxStreamId
                        : 100000000

    this.timeout = options.timeout || 30000
    this.max = (options.max && !isNaN(options.max) && options.max > 0) ? options.max : 50
    this.poolMax = parseInt(this.max * 1.5 + 0.5)

    this.url = options.url || ''
    this.debug = options.debug || false
    // 连接选项
    this.connectOptions = {
      rejectUnauthorized: false,
      requestCert: false,
      peerMaxConcurrentStreams: 100,
      timeout: this.timeout,
      ...options.connectOptions
    }

    this.reconnDelay = 100
    if (options.reconnDelay !== undefined && !isNaN(options.reconnDelay)) {
      this.reconnDelay = options.reconnDelay
    }

    this.parent = null

    if (options.parent && typeof options.parent === 'object') {
      this.parent = options.parent
    }

    this.quiet = false
    if (options.quiet)
      this.quiet = !!options.quiet
  }

  /**
   * 创建新的session连接
   */
  async connect(url='') {
    let real_url = url || this.url
    const session = http2.connect(real_url, this.connectOptions)

    // 生成唯一session id
    const sessionId = crypto.randomBytes(16).toString('hex')
    
    // 初始化session相关计数器和状态
    const sessionState = {
      id: sessionId,
      session,
      streamCount: 0,
      url: real_url,
      connected: false,
      error: null
    }

    // 处理session事件
    this._handleSessionEvents(sessionState)

    // 等待连接建立
    try {
      let timeout_timer = null
      let resolved = false
      let rejected = false

      await new Promise((resolve, reject) => {
          session.once('connect', () => {
            if (timeout_timer) {
              clearTimeout(timeout_timer)
              timeout_timer = null
            }

            sessionState.connected = true
            this.parent && !this.parent.alive && (this.parent.alive = true)

            resolve()
          })

          session.once('error', err => {
            if (timeout_timer) {
              clearTimeout(timeout_timer)
              timeout_timer = null
            }

            if (this.pool.size < 1) {
              this.parent && (this.parent.alive = false)
            }

            !rejected && (rejected = true) && reject(err)
          })

          session.once('goaway', err => {
            if (timeout_timer) {
              clearTimeout(timeout_timer)
              timeout_timer = null
            }
            !rejected && (rejected = true) && reject(err)
          })

          session.once('frameError', err => {
            if (timeout_timer) {
              clearTimeout(timeout_timer)
              timeout_timer = null
            }
            !rejected && (rejected = true) && reject(err)
          })
          
          if (!timeout_timer) {
            timeout_timer = setTimeout(() => {
              timeout_timer = null
              !session.destroyed && session.destroy()
              !rejected && (rejected = true) && reject(new Error('connect timeout'))
            }, this.timeout + 100)
          }
      })
    } catch (err) {
      sessionState.error = err
      sessionState.session = null
      this.debug && console.error(err)
    }

    if (this.pool.size < this.poolMax && sessionState.connected) {
      this.pool.set(sessionId, sessionState)
    }

    return sessionState
  }

  createPool(url='', max=0) {
    if (max <= 0) max = this.max

    for (let i = 0; i < max; i++) {
      this.connect(url)
    }
  }

  delayConnect() {
    if (this.reconnDelay) {
      if (!this.delayTimer) {
        this.delayTimer = setTimeout(() => {
          this.delayTimer = null
          this.connect()
        }, this.reconnDelay)
      }
    } else {
      this.connect()
    }
  }

  /**
   * 处理session的各种事件
   */
  _handleSessionEvents(sessionState) {
    const { session, id } = sessionState

    session.on('close', () => {
      // session关闭时从pool中移除
      this.pool.delete(id)

      if (this.pool.size < 1) {
        this.delayConnect()
      }
    })

    session.on('error', (err) => {
      !session.destroyed && session.destroy()
      this.pool.delete(id)
      /* if (this.pool.size < 1) {
        this.parent && (this.parent.alive = false)
      } */
    })

    session.on('frameError', err => {
      !session.destroyed && session.destroy()
      this.pool.delete(id)
    })

    session.on('goaway', () => {
      !session.destroyed && session.close()
      this.pool.delete(id)
    })

    session.setTimeout(this.timeout, () => {
      if (!session.destroyed) {
        session.close()
        queueMicrotask(() => {
          !session.destroyed && session.destroy()
        })
      }

      this.pool.delete(id)
    })
  }

  /**
   * 获取可用的session,如果没有则创建新的
   */
  async getSession(url='') {
    let real_url = url || this.url
    // 遍历查找可用的session
    if (this.pool.size > 0) {
      let items = this.pool.entries()
      for (const [id, state] of items) {
        if (state.url === real_url && 
            state.connected && 
            state.streamCount < this.maxStreamId)
        {
          return state
        }
      }
    }

    // 没有可用session则创建新的
    return this.connect(url)
  }

  /**
   * 创建新的请求stream
   */
  async request(headers, url='') {
    let sessionState = await this.getSession(url)
    
    // 增加stream计数
    sessionState.streamCount++
    
    // 检查是否超过最大限制
    if (sessionState.streamCount >= this.maxStreamId) {
      // 关闭并移除该session
      this.pool.delete(sessionState.id)

      if (!sessionState.session.destroyed) {
        sessionState.session.close()
        sessionState.connected = false
      }
    }

    if (!sessionState.connected) {
      let real_url = url || (sessionState.url === this.url ? '' : sessionState.url)
      sessionState = await this.connect(real_url)
    }

    if (!sessionState.connected) {
      if (this.quiet) return null
      throw new Error('There is no connected')
    }

    // 创建请求stream
    return sessionState.session.request(headers)
  }

  /**
   * 关闭所有session
   */
  closeAll() {
    for (const [id, state] of this.pool.entries()) {
      if (!state.session.destroyed) {
        state.session.close()
      }
    }
    this.pool.clear()
  }

  async aok() {
    if (this.pool.size <= 0) {
      await this.connect()
    }

    return this.ok()
  }

  ok() {
    let items = this.pool.entries()

    for (const [id, state] of items) {
      if (state.connected) return true
    }

    return false
  }

  /**
   * 获取当前pool状态
   */
  status() {
    const status = {
      total: this.pool.size,
      sessions: []
    }

    let items = this.pool.entries()

    for (const [id, state] of items) {
      status.sessions.push({
        id: state.id,
        url: state.url,
        streamCount: state.streamCount,
        connected: state.connected
      })
    }

    return status
  }
}

module.exports = Http2Pool
