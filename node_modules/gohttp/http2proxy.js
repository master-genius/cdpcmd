'use strict'

const hiio = require('./hiio.js')

let h2cli = new hiio()


let error_502_text = `<!DOCTYPE html><html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error 502</title>
      </head>
      <body>
        <div style="width:100%;font-size:105%;color:#737373;padding:0.8rem;">
          <h2>502 Bad Gateway</h2><br>
          <p>代理请求不可达。</p>
        </div>
      </body>
  </html>`

let error_503_text = `<!DOCTYPE html><html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error 503</title>
      </head>
      <body>
        <div style="width:100%;font-size:105%;color:#737373;padding:0.8rem;">
          <h2>503 Service Unavailable</h2><br>
          <p>此服务暂时不可用。</p>
        </div>
      </body>
  </html>` 

function fmtpath (path) {
  path = path.trim()
  if (path.length == 0) {
    return '/*'
  }

  if (path[0] !== '/') {
    path = `/${path}`
  }

  if (path.length > 1 && path[path.length - 1] !== '/') {
    path = `${path}/`
  }

  if (path.indexOf('/:') >= 0) {
    return path.substring(0, path.length-1)
  }

  return `${path}*`
}

let hiiproxy = function (options = {}) {
  
  if (!(this instanceof hiiproxy)) return hiiproxy(options)

  if (typeof options !== 'object') options = {}

  this.urlpreg = /(unix|http|https):\/\/[a-zA-Z0-9\-\_]+/

  this.hostProxy = {}
  this.proxyBalance = {}
  this.pathTable = {}

  this.methods = [
    'GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE'
  ]

  this.maxBody = 50000000

  //是否启用全代理模式。
  this.full = false

  this.timeout = 10000

  this.starPath = false

  this.addIP = false

  this.debug = false

  this.config = {}

  this.connectOptions = {
    family: 4
  }

  for (let k in options) {
    switch (k) {
      case 'config':
        this.config = options[k]
        break

      case 'starPath':
        this.starPath = !!options[k]
        break

      case 'maxBody':
      case 'addIP':
      case 'timeout':
      case 'full':
      case 'debug':
        this[k] = options[k]
        break

      case 'connectOptions':
        if (options[k] && typeof options[k] === 'object') {
          for (let a in options[k]) this.connectOptions[a] = options[k][a]
        }
        break
    }
  }

  this.setHostProxy(this.config)

}

hiiproxy.prototype.fmtConfig = function (cfg, k) {
  if (typeof cfg[k] === 'string') {
    cfg[k] = [
      { path : '/', url : cfg[k] }
    ]
  } else if (! (cfg[k] instanceof Array) ) {
    cfg[k] = [ cfg[k] ]
  }
}

hiiproxy.prototype.checkConfig = function (tmp, k) {

  if (typeof tmp !== 'object' || (tmp instanceof Array) ) {
    console.error(`${k} ${JSON.stringify(tmp)} 错误的配置格式`)
    return false
  }

  if (tmp.path === undefined) {
    tmp.path = '/'
  }

  tmp.path = tmp.path.trim().replace(/(\/){2,}/g, '/')

  if (tmp.path.length > 2 && tmp.path[tmp.path.length - 1] === '/') {
    tmp.path = tmp.substring(0, tmp.path.length-1)
  }

  if (tmp.url === undefined) {
    console.error(`${k} ${tmp.path}：没有指定要代理转发的url。`)
    return false
  }

  if (this.urlpreg.test(tmp.url) === false) {
    console.error(`${tmp.url} : 错误的url，请检查。`)
    return false
  }

  if (tmp.url[ tmp.url.length - 1 ] == '/') {
    tmp.url = tmp.url.substring(0, tmp.url.length - 1)
  }

  if (tmp.headers !== undefined) {
    if (typeof tmp.headers !== 'object') {
      console.error(`${k} ${tmp.url} ${tmp.path}：headers属性要求是object类型，使用key-value形式提供。`)
      return false
    }
  }

  return true
}

hiiproxy.prototype.checkAndSetConfig = function (backend_obj, tmp) {
  if (tmp.headers && tmp.headers.toString() === '[object Object]') {
    backend_obj.headers = {}

    for (let h in tmp.headers) {
      backend_obj.headers[h] = tmp.headers[h]
    }

  }

  if (tmp.max && typeof tmp.max === 'number' && tmp.max > 1)
    backend_obj.max = tmp.max

  if (tmp.debug !== undefined) backend_obj.debug = tmp.debug

  if (tmp.weight && typeof tmp.weight === 'number' && tmp.weight > 1)
    backend_obj.weight = parseInt(tmp.weight)

  if (tmp.reconnDelay !== undefined && typeof tmp.reconnDelay === 'number') 
    backend_obj.reconnDelay = tmp.reconnDelay

  if (tmp.timeout !== undefined && typeof tmp.timeout === 'number')
    backend_obj.timeout = tmp.timeout

  if (tmp.rewrite && typeof tmp.rewrite === 'function')
    backend_obj.rewrite = tmp.rewrite

}

hiiproxy.prototype.setHostProxy = function (cfg) {
  if (typeof cfg !== 'object') return false

  let pt = ''
  let tmp = ''
  let backend_obj = null

  for (let k in cfg) {

    for (let i = 0; i < cfg[k].length; i++) {
      tmp = cfg[k][i]

      if (!this.checkConfig(tmp, k)) continue

      if (this.hostProxy[k] === undefined) {
        this.hostProxy[k] = {}
        this.proxyBalance[k] = {}
      }

      pt = fmtpath(tmp.path)

      backend_obj = {
        url : tmp.url,
        headers : null,
        path : tmp.path,
        pathLength: tmp.path.length,
        rewrite: false,
        weight: 1,
        weightCount : 0,
        alive : true,
        reconnDelay : 2000,
        max: 100,
        debug: this.debug,
        h2Pool: null,
        timeout: this.timeout,
        connectOptions: {...this.connectOptions}
      }

      if (tmp.connectOptions && typeof tmp.connectOptions === 'object') {
        for (let o in tmp.connectOptions) {
          backend_obj.connectOptions[o] = tmp.connectOptions[o]
        }
      }

      backend_obj.connectOptions.keepalive = true
      backend_obj.connectOptions.max = backend_obj.max
      backend_obj.connectOptions.reconnDelay = backend_obj.reconnDelay
      backend_obj.connectOptions.debug = backend_obj.debug

      this.checkAndSetConfig(backend_obj, tmp)

      backend_obj.h2Pool = h2cli.connectPool(backend_obj.url, backend_obj.connectOptions)

      if (this.hostProxy[k][pt] === undefined) {
        
        this.hostProxy[k][pt] = [ backend_obj ]

        this.proxyBalance[k][pt] = {
          stepIndex : 0,
          useWeight : false
        }
        
      } else if (this.hostProxy[k][pt] instanceof Array) {
        this.hostProxy[k][pt].push(backend_obj)
      }

      if (backend_obj.weight > 1) this.proxyBalance[k][pt].useWeight = true

      this.pathTable[pt] = 1

    }

  }

}

hiiproxy.prototype.checkAlive = function (pr) {

  if (!pr.h2Pool || !pr.h2Pool.pool[0].connected) {
    return false
  }

  return true
}

hiiproxy.prototype.getBackend = function (c, host) {

  let prlist = this.hostProxy[host][c.routepath]

  let pxybalance = this.proxyBalance[host][c.routepath]

  let pr

  if (prlist.length === 1) {
    pr = prlist[0]
  } else {
    if (pxybalance.stepIndex >= prlist.length) {
      pxybalance.stepIndex = 0
    }

    pr = prlist[pxybalance.stepIndex]

    if (pxybalance.useWeight) {
      if (pr.weightCount >= pr.weight) {
        pr.weightCount = 0
        pxybalance.stepIndex += 1
      } else {
        pr.weightCount += 1
      }
    } else {
      pxybalance.stepIndex += 1
    }
  
  }

  if ( !this.checkAlive(pr) ) {

    for (let i = prlist.length - 1; i >= 0 ; i--) {
      
      pr = prlist[i]

      if ( this.checkAlive(pr) ) {
        return pr
      }
    }

    return null
  }

  return pr
}

hiiproxy.prototype.mid = function () {
  let self = this

  let timeoutError = new Error('request timeout')

  timeoutError.code = 'ETIMEOUT'

  return async (c, next) => {

    let host = c.host
    
    let hind = c.host.length - 1

    if (hind > 4) {
      let eind = hind - 5

      while (hind >= eind) {
        if (c.host[hind] === ':') {
          host = c.host.substring(0, hind)
          break
        }
  
        hind -= 1
      }
    }

    if (!self.hostProxy[host] || !self.hostProxy[host][c.routepath]) {
      if (self.full) {
        return c.send(error_502_text, 502) 
      }

      return await next()
    }

    let pr = self.getBackend(c, host)

    if (pr === null) {
      pr = self.getBackend(c, host)

      if (pr === null)
        return c.send(error_503_text, 503)
    }

    if (self.addIP && c.headers['x-real-ip']) {
      c.headers['x-real-ip'] += `,${c.ip}`
    } else {
      c.headers['x-real-ip'] = c.ip
    }

    let hii = pr.h2Pool.getSession()

    try {
      if (pr.headers) {
        for (let k in pr.headers) c.headers[k] = pr.headers[k]
      }

      if (pr.rewrite) {
        let rpath = pr.rewrite(c, c.headers[':path'])
        if (rpath) {
          let path_typ = typeof rpath
          if (path_typ === 'object' && rpath.redirect) {
            return c.setHeader('location', rpath.redirect)
          } else if (path_typ === 'string') {
            c.headers[':path'] = rpath
          }
        }
      }

      await new Promise((rv, rj) => {

        let stm = hii.session.request(c.headers)

        stm.setTimeout(pr.timeout, () => {
          stm.close()
        })

        stm.on('aborted', err => {
          rj(err)
        })

        stm.on('response', (headers, flags) => {
          c.reply.respond(headers)
        })

        stm.on('frameError', err => {
          stm.close()
          rj(err)
        })
      
        stm.on('error', err => {
          stm.close()
          rj(err)
        })

        c.request.on('data', chunk => {
          stm.write(chunk)
        })

        c.request.on('end', () => {
          stm.end()
        })

        stm.on('data', chunk => {
          c.reply.write(chunk)
        })

        stm.on('end', () => {
          stm.close()
          rv(true)
        })

      })
    } catch (err) {
      self.debug && console.error(err)
      c.send(error_503_text, 503)
    }

  }

}

hiiproxy.prototype.init =function (app) {

  app.config.timeout = this.timeout

  for (let p in this.pathTable) {
    app.router.map(this.methods, p, async c => {}, '@titbit_h2_proxy');
  }

  app.use(this.mid(), {
    pre: true,
    group: `titbit_h2_proxy`
  })

}


module.exports = hiiproxy
