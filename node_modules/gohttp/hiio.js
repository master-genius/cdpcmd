'use strict';

const http2 = require('http2')
const crypto = require('crypto')
const fs = require('fs')
const urlparse = require('url')
const qs = require('querystring')
const bodymaker = require('./bodymaker')

function parseUrl (url) {

  let urlobj = new urlparse.URL(url);

  let headers = {
    ':method' : 'GET',
    ':path': urlobj.pathname+urlobj.search,
  }

  return {
    url : urlobj,
    headers:headers
  }

}

  //Content-Range: <unit> <range-start>-<range-end>/<size>
  //Content-Range: <unit> <range-start>-<range-end>/*
  //Content-Range: <unit> */<size>
  //unit 是单位，通常按照字节表示：bytes
/**
 * 此处解析只认为unit是bytes。
 * @param {string} range 
 */
function parseContentRange(range) {
  let rsplit = range.split(' ').filter(p => p.length > 0)

  if (rsplit.length < 2) {
    return null
  }

  let robj = {
    start : '*',
    end : '*',
    size : '*'
  }

  let parseStartEnd = (rst) => {
    if (rst === '*') {
      return robj
    }

    let mind = rst.indexOf('-')
    if (mind < 0) {
      return null
    }

    robj.start = parseInt(rst.substring(0, mind))
    if (mind < rst.length - 1) {
      robj.end = parseInt(rst.substring(mind+1))
    }

    return robj
  }

  let slashIndex = rsplit[1].indexOf('/')

  if (slashIndex === 0) {
    return null
  }

  if (slashIndex > 0) {
    let bytes_arr = rsplit[1].split('/')
    if (bytes_arr.length < 2) {
      return null
    }
    
    if (bytes_arr[1] !== '*') {
      robj.size = parseInt(bytes_arr[1])
    }

    return parseStartEnd(bytes_arr[0])

  }

  return parseStartEnd(rsplit[1])

}

async function payload (reqobj, mkbody) {
  let needbody = false
  if (reqobj.method[0] === 'P') {
    needbody = true
  } else if (reqobj.method[0] === 'D' && reqobj.body) {
    needbody = true
  }

  if (!needbody) {
    return true
  }

  if (reqobj.body === undefined) {
    throw new Error(`${reqobj.method} must with body data`)
  }

  //直接转发请求过来的数据。
  if (reqobj.body instanceof Buffer) {
    return 'body'
  }

  let bodytype = typeof reqobj.body

  if (bodytype === 'string' && reqobj.headers['content-type'] === undefined) {
    reqobj.headers['content-type'] = 'text/plain'
  }

  if (bodytype === 'object' && reqobj.headers['content-type'] === undefined) {
    reqobj.headers['content-type'] = 'application/x-www-form-urlencoded'
  }

  if (bodytype === 'string') {
    
    reqobj.headers['content-length'] = Buffer.byteLength(reqobj.body)

    return 'body'

  } else if (reqobj.multipart && bodytype === 'object') {

    let tmpbody = await mkbody.makeUploadData(reqobj.body)
    
    reqobj.headers['content-type'] = tmpbody['content-type']
    reqobj.headers['content-length'] = tmpbody['content-length']
    //reqobj._bodyData = tmpbody.body
    return tmpbody

  } else if (bodytype === 'object') {

    let tmpbody = {
      body : ''
    }

    if (reqobj.headers['content-type'] === 'application/x-www-form-urlencoded') {
      tmpbody.body = Buffer.from(qs.stringify(reqobj.body))
    } else {
      tmpbody.body = Buffer.from(JSON.stringify(reqobj.body))
    }

    reqobj.headers['content-length'] = tmpbody.length

    return tmpbody
  }

}

/**
 * release self when session closed
 */

let _methodList = [
  'GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD', 'TRACE'
]

class _response {

  constructor () {
    this.headers = null
    this.status = 0
    this.data = null
    this.timeout = null
    this.error = null
    this.ok = null
    this.buffers = []
    this.totalLength = 0
    this.contentLength = 0
  }

  text () {
    if (this.data !== null) {
      return this.data.toString()
    }
    return 'null'
  }

  json () {
    return JSON.parse(this.text())
  }

  blob () {
    return this.data
  }

}

async function _download (stream, reqobj, ret, bkey) {

  if (!reqobj.dir) {
    reqobj.dir = './'
  } else if (reqobj.dir.length > 0 && reqobj.dir[ reqobj.dir.length - 1 ] !== '/') {
    reqobj.dir += '/'
  }

  let _writeStream

  let onResponse = (headers, flags) => {
    ret.headers = headers
    ret.status = parseInt(headers[':status'] || 0)
    if (ret.status > 0 && ret.status < 400) {
      ret.ok = true
    } else {
      ret.ok = false
    }

    if (ret.status !== 200) {
      return
    }

    let filename = ''
    if(headers['content-disposition']) {
      let name_split = headers['content-disposition']
                        .split(';')
                        .filter(p => p.length > 0)

      for(let i=0; i < name_split.length; i++) {
        
        if (name_split[i].indexOf('filename*=') >= 0) {
          
          filename = name_split[i].trim().substring(10)
          filename = filename.split('\'')[2]
          filename = decodeURIComponent(filename)

        } else if(name_split[i].indexOf('filename=') >= 0) {
          filename = name_split[i].trim().substring(9)
        }
      }

    }

    if (headers['content-length']) {
      ret.contentLength = parseInt(headers['content-length'])
    }

    if (!filename) {
      let h = crypto.createHash('sha1')
      h.update(`${Date.now()}${Math.random()}`)
      filename = h.digest('hex')
    }

    let target = reqobj.target || `${reqobj.dir}${filename}`

    let wstm_opts = {
      encoding : 'binary'
    }
    
    /**
     * 存在content-range并且已经存在对应名称的文件：
     *  - 解析content-range
     *  - 检测文件尺寸
     *  - 对比是否对应
     */
    if (headers['content-range']) {
      
      let range = parseContentRange(headers['content-range'])
      if (range && range.start !== '*') {
        try {
          let fst = fs.statSync(filename)
          
          if (fst.size === range.size) {
            stream.emit('end')
            return
          }
          if (range.start > 0 && fst.size === range.start) {
            wstm_opts.flags = 'a+'
          }
        } catch (err) {}
      }
    }

    try {
      _writeStream = fs.createWriteStream(target, wstm_opts)
    } catch (err) {
      stream.emit('error', err)
    }

  }

  return new Promise((rv, rj) => {

    stream.on('response', onResponse)
    
    stream.on('timeout', () => {
      ret.ok = false
      ret.timeout = true
      stream.close()
      rv(ret)
    })

    stream.on('data', chunk => {
      ret.totalLength += chunk.length
      _writeStream.write(chunk)
      if (reqobj.ondata && typeof reqobj.ondata === 'function') {
        reqobj.ondata(ret)
      }
    })

    stream.on('end', () => {
      stream.close()
      rv(ret)
    })

    stream.on('error', err => {
      stream.close()
      ret.error = err
      rv(ret)
    })

    stream.on('frameError', err => {
      stream.close()
      ret.error = err
      rv(ret)
    })

    if (bkey !== true) {
      if (typeof bkey === 'object') {
        stream.end(bkey.body)
      } else {
        stream.end(reqobj[bkey])
      }
    } else {
      stream.end()
    }

  })
  .finally(() => {
    if (_writeStream) {
      _writeStream.end()
    }
  })
  
}

class _Request {

  constructor (options) {
    this.session = options.session
    this.host = options.host
    this.bodymaker = options.bodymaker
    this.parent = options.parent
    this.pending = options.pending
    this.debug = options.debug
    this.keepalive = options.keepalive
    this.reconnDelay = options.reconnDelay
    this.connected = false
    this.init()
  }

  init () {
    this.session.on('connect', () => {
      this.connected = true
    })

    this.session.on('close', async () => {
      this.connected = false
      if (this.keepalive && typeof this.reconn === 'function') {
        await new Promise((rv, rj) => {
          setTimeout(() => {
            rv()
          }, this.reconnDelay)
        })

        if (this.connected) return

        this.debug && console.log('Connect closed, reconnect...')
        this.reconn()
      } else {
        this.free()
      }
    })

    this.session.on('error', err => {
      this.debug && console.error(err)
      this.connected = false
      this.session.destroy()
    })
  }

  close () {
    if (this.session && !this.session.closed) {
      this.session.close()
    }
  }

  destroy() {
    if (this.session && !this.session.destroyed) {
      this.session.destroy()
    }
  }

  on (evt, callback) {
    return this.session.on(evt, callback)
  }

  free () {
    this.parent._freeRequest(this)
  }

  /**
   * {
   *    method : 'GET',
   *    path : '/',
   *    body : BODY,
   *    data : DATA,
   *    query : {},
   *    files : FILES,
   *    headers : {},
   *    options : {}
   * }
   * @param {object} reqobj
   */

  checkAndSetOptions (reqobj) {
    if (reqobj.headers === undefined || typeof reqobj.headers !== 'object') {
      reqobj.headers = {}
    }

    if (reqobj.method === undefined || _methodList.indexOf(reqobj.method) < 0) {
      reqobj.method = 'GET'
    }

    if (reqobj.path === undefined || reqobj.path === '') {
      reqobj.path = '/'
    }

    if (reqobj.path[0] !== '/') {
      reqobj.path = `/${reqobj.path}`
    }

    if (reqobj.timeout === undefined) {
      reqobj.timeout = 15000
    }

    reqobj.headers[':path'] = reqobj.path
    reqobj.headers[':method'] = reqobj.method
  }

  async request (reqobj, events = {}) {

    this.checkAndSetOptions(reqobj)
    
    let rb = await payload(reqobj, this.bodymaker)

    if (!this.session || this.session.destroyed) {
      if (this.keepalive) {
        this.reconn()
      } else {
        throw new Error(`session is destroyed, please reconnect`)
      }
    }

    let stm
    if (reqobj.options) {
      stm = this.session.request(reqobj.headers, reqobj.options)
    } else {
      stm = this.session.request(reqobj.headers)
    }
    
    let ret = new _response()

    if (reqobj.selfHandle) {
      return {
        bodykey : rb,
        stream : stm,
        ret : ret
      }
    }

    if (events.response && typeof events.response === 'function') {
      stm.on('response', events.response)
    } else {
      stm.on('response', (headers, flags) => {
        ret.headers = headers
        ret.status = parseInt(headers[':status'] || 0)
        if (ret.status > 0 && ret.status < 400) {
          ret.ok = true
        } else {
          ret.ok = false
        }
      })
    }

    return new Promise((rv, rj) => {
      
      stm.on('timeout', () => {
        ret.ok = false
        ret.timeout = true
        stm.close()
        rv(ret)
      })

      if (events.data && typeof events.data === 'function') {
        stm.on('data', events.data)
      } else {
        stm.on('data', chunk => {
          ret.buffers.push(chunk)
          ret.totalLength += chunk.length
        })
      }

      stm.on('end', () => {
        if (ret.buffers && ret.buffers.length > 0) {
          ret.data = Buffer.concat(ret.buffers, ret.totalLength)
          ret.buffers = null
        }
        stm.close()
        rv(ret)
      })

      stm.on('error', err => {
        stm.close()
        ret.error = err
        rv(ret)
      })

      stm.on('frameError', err => {
        stm.close()
        ret.error = err
        rv(ret)
      })

      if (rb !== true) {
        if (typeof rb === 'object') {
          stm.end(rb.body)
        } else {
          stm.end(reqobj[rb])
        }
      } else {
        stm.end()
      }

    })

  }

  async get (reqobj) {
    reqobj.method = 'GET'
    return this.request(reqobj)
  }

  async post (reqobj) {
    reqobj.method = 'POST'
    return this.request(reqobj)
  }

  async put (reqobj) {
    reqobj.method = 'PUT'
    return this.request(reqobj)
  }

  async delete (reqobj) {
    reqobj.method = 'DELETE'
    return this.request(reqobj)
  }

  async options (reqobj) {
    reqobj.method = 'OPTIONS'
    return this.request(reqobj)
  }

  async upload (reqobj) {
    reqobj.multipart = true
    if (reqobj.method === undefined) {
      reqobj.method = 'POST'
    }

    if (reqobj.body === undefined) {
      reqobj.body = {}
    }

    if (reqobj.form) {
      reqobj.body.form = reqobj.form
    }

    if (reqobj.files) {
      reqobj.body.files = reqobj.files
    }

    return this.request(reqobj)
  }

  async up (reqobj) {
    reqobj.files = {}
    reqobj.files[ reqobj.name ] = reqobj.file
    return this.upload(reqobj)
  }

  async download (reqobj) {
    reqobj.selfHandle = true
    let r = await this.request(reqobj)
    return _download(r.stream, reqobj, r.ret, r.bodykey)
  }

}

/**
 * 多个session负载均衡，提高客户端请求效率。
 */

class sessionPool {

  constructor (options = {}) {
    this.max = 10
    this.pool = []
    this.step = -1

    for (let k in options) {
      switch (k) {
        case 'max':
          this.max = options.max
          break
      }
    }

  }

  request (reqobj, events = {}) {
    return this.getSession().request(reqobj, events)
  }

  get (reqobj) {
    return this.getSession().get(reqobj)
  }

  post (reqobj) {
    return this.getSession().post(reqobj)
  }

  put (reqobj) {
    return this.getSession().put(reqobj)
  }

  delete (reqobj) {
    return this.getSession().delete(reqobj)
  }

  options (reqobj) {
    return this.getSession().options(reqobj)
  }

  upload (reqobj) {
    return this.getSession().upload(reqobj)
  }

  up (reqobj) {
    return this.getSession().up(reqobj)
  }

  download (reqobj) {
    return this.getSession().download(reqobj)
  }

  destroy () {
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].destroy()
    }
  }

  close () {
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].close()
    }
  }

  getSession () {
    if (this.pool.length <= 0) {
      return null
    }
    if ( (this.step+1) >= this.pool.length) {
      this.step = -1
    }
    this.step += 1
    return this.pool[this.step]
  }

  add (sess) {
    if (this.pool.length < this.max) {
      this.pool.push(sess)
    }
  }

  on (evt, callback) {
    for (let a of this.pool) {
      a.on(evt, callback)
    }
  }

}

/**

connect --> session --> session.request --> stream1
                                        --> stream2
                                        --> stream3
                                        ...
                                        ...

 */

var hiio = function () {

  if (!(this instanceof hiio)) {
    return new hiio()
  }

  //process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  this.bodyMethods = 'PD'

  this.noBodyMethods = 'GOHT'

  this.bodymaker = new bodymaker()

  this.pool = []

  this.maxPool = 1000

}

hiio.prototype._freeRequest = function (req) {
  if (this.pool.length < this.maxPool) {
    req.pending = true
    req.session = null
    req.host = ''
    req.connected = false
    this.pool.push(req)
  }
}

hiio.prototype._getPool = function (options) {
  let r = this.pool.pop()
  
  if (r) {
    r.connected = true
    r.session = options.session
    r.host = options.host
    r.pending = false
    r.parent = options.parent
    r.bodymaker = options.bodymaker
    r.debug = options.debug === undefined ? false : options.debug
    r.keepalive = options.keepalive === undefined ? false : options.keepalive
    r.init()

    return r
  }

  return null
}

hiio.prototype._newRequest = function (options) {
  return this._getPool(options) || new _Request(options)
}

hiio.prototype.parseUrl = parseUrl

hiio.prototype.connect = function (url, options = {}) {

  if (options.requestCert  === undefined) {
    options.requestCert = false
  }

  if (options.rejectUnauthorized === undefined) {
    options.rejectUnauthorized = false
  }

  if (options.peerMaxConcurrentStreams === undefined) {
    options.peerMaxConcurrentStreams = 100
  }

  if (options.settings === undefined) {
    options.settings = {
      maxHeaderListSize: 16368,
      maxConcurrentStreams: 100
    }
  }

  if (options.checkServerIdentity === undefined) {
    options.checkServerIdentity = (name, cert) => {}
  }

  let h = http2.connect(url, options)

  if (options.timeout && typeof options.timeout === 'number') {
    h.setTimeout(options.timeout, () => {
      h.close()
    })
  }

  if (options.sessionRequest) {
    options.sessionRequest.session = h
    return options.sessionRequest
  }

  let newReq = this._newRequest({
    session : h,
    host : url,
    bodymaker : this.bodymaker,
    parent : this,
    pending: false,
    debug: !!options.debug,
    keepalive : !!options.keepalive,
    reconnDelay : options.reconnDelay === undefined ? 500 : options.reconnDelay
  })

  /**
   * 延迟重连不能使用setTimeout，因为timer循环会在下一个循环开始执行，
   * 而在本次循环，error的处理会先执行，此时，error事件还没有监听。
   */
  if (options.keepalive) {
    newReq.reconn = () => {
      options.sessionRequest = newReq
      this.connect(url, options)
      newReq.init()
    }
  }

  return newReq

}

hiio.prototype.connectPool = function (url, options = {}) {

  if (options.max === undefined || options.max <= 0) {
    options.max = 5
  }

  let max = options.max

  let sp = new sessionPool({max : max})

  delete options.max

  if (!options.keepalive) {
    options.keepalive = true
  }

  for (let i = 0; i < max; i++) {
    sp.add( this.connect(url, options) )
  }

  return sp
}

module.exports = hiio
