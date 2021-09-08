'use strict';

//const fs = require('fs');

const zlib = require('zlib');

/**
 * 处理静态资源的请求，需要把中间件挂载到一个分组下，否则会影响全局，如果一个只做静态分发的服务则可以全局启用。
 */

class staticdata {

  constructor (options = {}) {

    this.cache = new Map()

    this.staticPath = ''

    //最大缓存，单位为字节，0表示不限制。
    this.maxCacheSize = 50000000

    this.size = 0

    //失败缓存统计，当失败缓存计数达到一个阈值，则会清空缓存。
    this.cacheFailed = 0

    this.failedLimit = 50

    this.compress = true

    this.cacheControl = null

    this.routePath = '/static/*'

    this.prepath = ''
    
    this.routeGroup = `__static_${parseInt(Math.random()*10000)}_`

    this.decodePath = false

    if (typeof options !== 'object') {
      options = {};
    }

    for (let k in options) {
      switch(k) {
        case 'staticPath':
          this.staticPath = options[k]
          break

        case 'maxCacheSize':
          this.maxCacheSize = options[k]
          break

        case 'failedLimit':
          if (options[k] > 0) {
            this.failedLimit = options[k]
          }
          break

        case 'compress':
          this.compress = options[k]
          break

        case 'cacheControl':
          this.cacheControl = options[k]
          break
        
        case 'routePath':
          if (typeof options[k] === 'string') {
            this.routePath = options[k]
          }
          break

        case 'routeGroup':
          if (typeof options[k] === 'string') {
            this.routeGroup = options[k]
          }
          break
        
        case 'decodePath':
          this.decodePath = options[k]
          break

        case 'prepath':
          this.prepath = options[k]

          if (this.prepath.length > 0 && this.prepath[0] !== '/') {
            this.prepath = `/${this.prepath}`
          }
          break

      }
    }

    if (this.maxCacheSize < 100000) {
      this.maxCacheSize = 100000
    }

    if (this.staticPath.length > 1 && this.staticPath[ this.staticPath.length-1 ] === '/') {
      this.staticPath = this.staticPath.substring(0, this.staticPath.length-1)
    }

    this.ctypeMap = {
      '.css' : 'text/css; charset=utf-8',
      '.js'  : 'text/javascript; charset=utf-8',
      '.txt' : 'text/plain; charset=utf-8',
      '.json' : 'text/json; charset=utf-8',

      '.jpg' : 'image/jpeg',
      '.jpeg' : 'image/jpeg',
      '.png' : 'image/png',
      '.gif' : 'image/gif',
      '.ico' : 'image/x-icon',
      '.webp' : 'image/webp',

      '.mp3' : 'audio/mp3',
      '.mp4' : 'video/mp4',

      '.ttf' : 'font/ttf',
      '.wtf' : 'font/wtf',
      '.woff' : 'font/woff',
      '.woff2' : 'font/woff2',
      '.ttc' : 'font/ttc'
    }

  }

  filetype (filename) {

    let extind = filename.length - 1
    let extstart = filename.length - 5

    while (extind > 0 && extind >= extstart) {
      if (filename[extind] === '.') break

      extind -= 1
    }

    let extname = filename.substring(extind)

    if (this.ctypeMap[extname] !== undefined) {
      return this.ctypeMap[extname]
    }

    return 'application/octet-stream'
  }

  mid () {

    let self = this

    return async (c, next) => {

      let real_path = c.param.starPath || c.path

      if (real_path[0] !== '/') {
        real_path = `/${real_path}`
      }

      if (self.decodePath) {
        try {
          real_path = decodeURIComponent(real_path)
        } catch (err) {
          c.send('', 404)
          return
        }
      }

      let pathfile = `${self.staticPath}${self.prepath}${real_path}`
  
      if (self.cache.has(real_path)) {

        let r = self.cache.get(real_path)

        c.setHeader('content-type', r.type)
        c.setHeader('content-length', r.data.length)
        
        if (r.gzip) {
          c.setHeader('content-encoding', 'gzip')
        }

        if (self.cacheControl) {
          c.setHeader('cache-control', self.cacheControl)
        }

        c.send(r.data)

        return
      }
  
      try {
        let data = await c.helper.readb(pathfile)

        let ctype = self.filetype(pathfile)

        let zipdata = null

        if (ctype.indexOf('text/') === 0 && self.compress) {
          zipdata = await new Promise((rv, rj) => {
              zlib.gzip(data, (err, d) => {
                if (err) {
                  rj(err)
                } else {
                  rv(d)
                }
              })
          })

        }

        if (self.cacheFailed >= self.failedLimit) {

          self.cacheFailed = 0
          self.size = 0
          self.cache.clear()

        } else if (self.maxCacheSize > 0 && self.size >= self.maxCacheSize) {

          self.cacheFailed += 1

        } else {

          self.cache.set(real_path, {
            data : zipdata || data,
            type : ctype,
            gzip : zipdata ? true : false,
          })

          self.size += zipdata ? zipdata.length : data.length

        }

        c.setHeader('content-type', ctype)
        c.setHeader('content-length', zipdata ? zipdata.length : data.length)

        if (zipdata) {
          c.setHeader('content-encoding', 'gzip')
        }

        if (self.cacheControl) {
          c.setHeader('cache-control', self.cacheControl)
        }

        c.send(zipdata || data)

      } catch (err) {
        c.status(404)
      }
  
    }

  }

  init (app, group = null) {
    app.get(this.routePath, async c => {}, {group: group || this.routeGroup})
    app.use(this.mid(), {group : group || this.routeGroup})
  }

}

module.exports = staticdata
