'use strict'

function fmtMessage(msg, withEnd = true) {
  let text = ''

  if (Array.isArray(msg)) {
    let textarr = []
    
    for (let m of msg) {
      text = fmtMessage(m, false)
      text && textarr.push(text)
    }
    if (textarr.length === 0) return ''

    return textarr.join('\r\n') + '\n\n'
  }

  if (msg === null || msg === undefined || msg === '') {
    return ''
  }

  let typ = typeof msg

  if (typ === 'number') {
    msg = `${msg}`
    typ = 'string'
  }

  if (typ === 'object') {
    if (!(msg.event || msg.data || msg.retry || msg.id)) return ''
    
    if (msg.data === undefined) msg.data = ''

    let datatype = typeof msg.data

    switch (datatype) {
      case 'number':
        msg.data = msg.data.toString()
        break
      case 'object':
        msg.data = JSON.stringify(msg.data).replaceAll('\n', '%0A')
        break
      case 'function':
        msg.data = msg.data.toString().replaceAll('\n', '%0A')
        break
      case 'string':
        msg.data = msg.data.replaceAll('\n', '%0A')
        break

      default:
        msg.data = `${msg.data}`
    }

    text = `event: ${msg.event || 'message'}\ndata: ${msg.data}\n`
    if (msg.id) {
      text += `id: ${msg.id}\n`
    }

    if (msg.retry) {
      text += `retry: ${msg.retry}\n`
    }
  } else if (typ === 'string') {
    if (msg[0] !== ':') {
      text = `data: ${msg.replaceAll('\n', '%0A')}\n`
    } else {
      text = msg.replaceAll('\n', '%0A') + '\n'
    }
  } else if (typ === 'function') {
    text = `event: function\ndata: ${msg.toString().replaceAll('\n', '%0A')}\n`
  }

  if (withEnd) {
    text += `\n\n`
  }

  return text
}

class SSE {

  constructor(options = {}) {
    this.timer = null
    this.handle = null
    this.timeSlice = 1000

    this.retry = 0
    this.timeout = 15000

    this.fmtMsg  = fmtMessage

    this.handleClose = null
    this.handleError = null

    this.mode = 'timer'

    for (let k in options) {
      switch (k) {
        case 'timeSlice':
        case 'timeout':
        case 'retry':
          if (typeof options[k] === 'number' && options[k] >= 0) {
            this[k] =  options[k]
          }
          break

        case 'handle':
        case 'handleClose':
        case 'handleError':
          if (typeof options[k] === 'function') this[k] = optionsp[k]
          break

        case 'mode':
          if (['timer', 'generator', 'yield'].indexOf(options[k]) >= 0)
            this[k] = options[k]
          break
      }
    }

  }

  async interval(ctx) {
    if (!this.handle || typeof this.handle !== 'function') {
      throw new Error('请设置handle为要处理的函数，然后再次运行。')
    }

    let self = this

    if (self.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    return new Promise((rv, rj) => {
      ctx.reply.on('error', err => {
        clearInterval(self.timer)
        self.timer = null
        rj(err)
      })

      ctx.reply.on('close', () => {
        clearInterval(self.timer)
        self.timer = null
        rv('sse closed')
      })

      self.timer = setInterval(async () => {
        ctx.box.sseCount += 1
        if (self.timeout > 0 && ctx.box.sseCount * self.timeSlice > self.timeout) {
          if (self.retry > 0) {
            ctx.sendmsg({data: 'timeout', retry: self.retry})
          }
          return ctx.reply.end()
        }

        try {
          await self.handle(ctx)
        } catch (err) {
          clearInterval(self.timer)
          self.timer = null
          rj(err)
        }
      }, self.timeSlice || 1000)
    })

  }

  async moment(t) {
    return new Promise((rv) => {
      setTimeout(rv, t)
    })
  }

  gn(ctx) {
    if (!this.handle || typeof this.handle !== 'function') {
      throw new Error('请设置handle为要处理的函数，然后再次运行。')
    }

    let self = this

    ctx.box.sseNext = true

    ctx.reply.on('error', err => {
      ctx.box.sseNext = false
      ctx.box.sseError = err
    })

    ctx.reply.on('close', () => {
      ctx.box.sseNext = false
    })

    return async function * () {
        while (true) {
          let tm = Date.now()

          if (self.timeout > 0 && (tm - ctx.box.sseTime) > self.timeout) {
            if (self.retry > 0) {
              ctx.sendmsg({data: 'timeout', retry: self.retry})
            }
            return
          }
          ctx.box.sseCount += 1
          try {
            await self.handle(ctx)
          } catch (err) {
            ctx.box.sseNext = false
            ctx.box.sseError = err
          }

          if (ctx.box.sseNext) {
            yield tm
          } else {
            break
          }
        }
    }

  }

  async rungn(ctx) {
    let yn = this.gn(ctx)
    let r
    let y = yn()

    while (true) {
      r = await y.next()
      
      if (r.done) break

      if (this.timeSlice > 0) await this.moment(this.timeSlice)
    }

    if (ctx.box.sseError) {
      if (this.handleError && typeof this.handleError === 'function')
        this.handleError(ctx.box.sseError, ctx)
      else throw ctx.box.sseError
    } else if (this.handleClose && typeof this.handleClose === 'function') {
      this.handleClose(ctx)
    }
  }

  autoRun(ctx) {
    if (this.mode === 'timer') {
      return this.interval(ctx)
                .then(data => {
                  if (typeof this.handleClose === 'function') this.handleClose(ctx)
                })
                .catch(err => {
                  if (typeof this.handleError === 'function') {
                    this.handleError(err, ctx)
                  } else {
                    throw err
                  }
                })
    } else {
      ctx.box.sseTime = Date.now()
      return this.rungn(ctx)
    }
  }

  mid() {
    let self = this

    return async (ctx, next) => {
      ctx.setHeader('content-type', 'text/event-stream;charset=utf-8').sendHeader()
      ctx.sse = self
      //用于统计是否超时断开并发送retry
      ctx.box.sseCount = 0
      if (!ctx.sendmsg || typeof ctx.sendmsg !== 'function') {
        ctx.sendmsg = (msg, callback = undefined) => {
          let emsg = fmtMessage(msg)
          if (emsg) return ctx.reply.write(emsg, callback)
        }
      }

      ctx.reply.setTimeout(self.timeout, () => {
        if (ctx.reply.writable) ctx.reply.end()
      })

      //http2协议需要设置session超时，否则如果默认的服务超时设置比self.timeout短，会导致无法收到消息。
      if (ctx.major == 2 && ctx.reply.session && ctx.reply.session.listenerCount) {
        //http2的session会保持连接，如果stream超时关闭后，session可能会维持连接，此时有可能会复用session。
        if (ctx.reply.session.listenerCount('timeout') < 2) {
          ctx.reply.session.setTimeout(self.timeout, () => {})
        }
      }

      await self.autoRun(ctx)
    }
  }

}

module.exports = SSE
