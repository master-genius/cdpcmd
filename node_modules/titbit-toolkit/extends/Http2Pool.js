'use strict';

const http2 = require('node:http2')
const crypto = require('node:crypto')

class Http2Pool {
  
  constructor(options = {}) {
    // 存储session的Map
    if (!options || typeof options !== 'object') options = {}
    if (!options.connectOptions) options.connectOptions = {}

    this.pool = new Map()
    
    this.reconnecting = false
    // 配置项
    this.maxStreamId = !isNaN(options.maxStreamId) && options.maxStreamId > 1
                        ? options.maxStreamId
                        : 90000

    this.timeout = options.timeout || 30000
    this.connectTimeout = options.connectTimeout || 15000

    this.max = (options.max && !isNaN(options.max) && options.max > 0) ? options.max : 50
    this.poolMax = parseInt(this.max * 1.5 + 0.5)
    this.maxConnect = (options.maxConnect && !isNaN(options.maxConnect) && options.maxConnect > 0)
                      ? options.maxConnect
                      : this.poolMax + 500

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

    this.maxAliveStreams = options.maxAliveStreams || 100

    this.quiet = false
    if (options.quiet)
      this.quiet = !!options.quiet
  }

  /**
   * 创建新的session连接
   */
  async connect() {
    if (this.pool.size > this.maxConnect) {
      return {
        deny: true,
        error: `超出最大连接限制：${this.maxConnect}`
      }
    }

    const session = http2.connect(this.url, this.connectOptions)

    // 生成唯一session id
    const sessionId = crypto.randomBytes(16).toString('hex')
    
    // 初始化session相关计数器和状态
    const sessionState = {
      using: false,
      id: sessionId,
      session,
      streamCount: 0,
      url: this.url,
      connected: false,
      error: null,
      aliveStreams: 0
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

            !rejected && (rejected = true) && reject(err||new Error('goaway'))
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
            }, this.connectTimeout)
          }
      })
    } catch (err) {
      sessionState.error = err
      sessionState.session = null
      this.debug && console.error(err)
    } finally {
      this.reconnecting = false
    }

    if (this.pool.size < this.poolMax && sessionState.connected) {
      this.pool.set(sessionId, sessionState)
    }

    return sessionState
  }

  createPool(max=0) {
    if (max <= 0) max = this.max

    for (let i = 0; i < max; i++) {
      this.connect()
    }
  }

  delayConnect() {
    if (this.reconnecting) return false

    if (this.reconnDelay) {
      if (!this.delayTimer) {
        this.reconnecting = true
        this.delayTimer = setTimeout(() => {
          this.delayTimer = null
          this.connect()
        }, this.reconnDelay)
      }
    } else {
      this.reconnecting = true
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

    session.on('error', err => {
      this.debug && console.error(err)
      !session.destroyed && session.destroy()
      this.pool.delete(id)
    })

    session.on('frameError', err => {
      !session.destroyed && session.destroy()
      this.pool.delete(id)
    })

    session.on('goaway', err => {
      this.debug && err && console.error('..........goaway........', err)
      !session.destroyed && session.close()
      this.pool.delete(id)
    })

    session.setTimeout(this.timeout, () => {
      this.debug && console.error('session.....time.....out......')
      if (!session.destroyed) {
        session.destroy()
      }

      this.pool.delete(id)
    })
  }

  isSessionHealthy(session) {
    return session
            && !session.destroyed
            && !session.closed
            && session.socket
            && !session.socket.destroyed
  }

  /**
   * 获取可用的session,如果没有则创建新的
   */
  async getSession() {
    if (this.pool.size > 0) {
        let items = this.pool.entries()
        for (const [id, state] of items) {
          if (state.connected
              && state.streamCount < this.maxStreamId
              && this.isSessionHealthy(state.session))
          {
            if (state.aliveStreams < this.maxAliveStreams) {
              return state
            }
          } else {
            state.connected = false
            if (!state.session.destroyed) {
              state.session.close()

              if (state.aliveStreams < 1) {
                state.session.destroy()
              }
              /*  else {
                let sess = state.session
                setTimeout(() => {
                  !sess.destroyed && sess.destroy()
                  sess = null
                }, this.timeout + 5000)
              } */
            }

            this.pool.delete(state.id)
          }
        }
    }

    return this.connect()
  }

  /**
   * 创建新的请求stream
   */
  async request(headers, sessionState=null) {
    !sessionState && (sessionState = await this.getSession())

    sessionState.streamCount++

    if (!sessionState.connected) {
      if (this.quiet) return null
      throw new Error('There is no connected')
    }

    //创建请求stream
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
        streamCount: state.streamCount,
        connected: state.connected
      })
    }

    return status
  }
}

module.exports = Http2Pool
