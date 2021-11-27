'use strict';

//const fs = require('fs');

const zlib = require('zlib');
const fs = require('fs');

const fsp = fs.promises;

let _typemap = {
  '.css'  : 'text/css; charset=utf-8',
  '.js'   : 'text/javascript; charset=utf-8',
  '.txt'  : 'text/plain; charset=utf-8',
  '.json' : 'application/json; charset=utf-8',
  '.lrc'  : 'text/plain; charset=utf-8',
  '.md'   : 'text/plain; charset=utf-8',
  '.html' : 'text/html; charset=utf-8',
  '.xml'  : 'text/xml; charset=utf-8',

  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.png'  : 'image/png',
  '.gif'  : 'image/gif',
  '.ico'  : 'image/x-icon',
  '.webp' : 'image/webp',
  '.tif'  : 'image/tiff',
  '.tiff' : 'image/tiff',

  '.mp3'  : 'audio/mpeg',
  '.mp4'  : 'video/mp4',
  '.wav'  : 'audio/x-wav',

  '.ttf'  : 'font/ttf',
  '.wtf'  : 'font/wtf',
  '.woff' : 'font/woff',
  '.ttc'  : 'font/ttc',
  '.woff2' : 'font/woff2',
};

/**
 * 处理静态资源的请求，需要把中间件挂载到一个分组下，否则会影响全局，如果一个只做静态分发的服务则可以全局启用。
 */

class staticdata {

  constructor (options = {}) {

    this.cache = new Map()

    this.staticPath = ''

    //最大缓存，单位为字节，0表示不限制。
    this.maxCacheSize = 120_000_000

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

    if (this.maxCacheSize < 500000) {
      this.maxCacheSize = 500000
    }

    if (this.staticPath.length > 1 && this.staticPath[ this.staticPath.length-1 ] === '/') {
      this.staticPath = this.staticPath.substring(0, this.staticPath.length-1)
    }

    this.ctypeMap = _typemap

    for (let k in this.ctypeMap) {
      this.ctypeMap[ k.toUpperCase() ] = _typemap[k]
    }

  }

  addType (tobj) {
    let lower_name, up_name;

    for (let k in tobj) {
      lower_name = k.toLowerCase()

      up_name = k.toUpperCase()

      this.ctypeMap[lower_name] = tobj[k]

      this.ctypeMap[up_name] = tobj[k]
    }
  }

  extName (filename) {
    let extind = filename.length - 1
    let extstart = filename.length - 5

    while (extind > 0 && extind >= extstart) {
      if (filename[extind] === '.') break

      extind -= 1
    }

    return filename.substring(extind)
  }

  filetype (extname) {

    if (this.ctypeMap[extname] !== undefined) {
      return this.ctypeMap[extname]
    }

    return 'application/octet-stream'
  }

  /**
   * 超过10M的数据则不再缓存，所以不再返回数据。
   */
  async pipeData (pathfile, ctx, maxsize = 10000000) {
    let stm = fs.createReadStream(pathfile)
    let dataBuffer = []
    let total = 0

    if (ctx.major === 2) {
      ctx.sendHeader()
    }

    let bufferLock = false

    return new Promise((rv, rj) => {
      stm.on('data', data => {

        if (bufferLock) return;

        total += data.length

        if (total > maxsize) {
          bufferLock = true
        }

        dataBuffer.push(data)
      })

      stm.on('error', err => {
        rj(err)
      })

      stm.on('end', () => {
        if (bufferLock) {
          dataBuffer = null
        }
        
        if (dataBuffer && dataBuffer.length > 0) {
          let retData = Buffer.concat(dataBuffer, total)
          dataBuffer = null;
          rv(retData)
        } else {
          rv(null)
        }
      })

      stm.pipe(ctx.reply)

    })

  }

  mid () {

    let self = this

    return async (c, next) => {

      let rpath = c.param.starPath || c.path

      if (rpath[0] !== '/') {
        rpath = `/${rpath}`
      }

      let real_path = rpath

      if (self.decodePath) {
        try {
          real_path = decodeURIComponent(rpath)
        } catch (err) {
          real_path = rpath
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

      let file_ok = true

      await fsp.access(pathfile).catch(err => {
        file_ok = false
      })

      if (!file_ok) return c.status(404).send('file not found')
  
      try {
        let data = null

        let extname = this.extName(pathfile)

        let ctype = self.filetype(extname)

        let zipdata = null

        c.setHeader('content-type', ctype)

        if (self.cacheControl) {
          c.setHeader('cache-control', self.cacheControl)
        }

        if (ctype.indexOf('text/') === 0 || extname === '.json' || ctype.indexOf('font/') === 0) {
          
          data = await c.helper.readb(pathfile)

          //若文件很小，压缩后的数据很可能要比源文件还大，所以对超过1k的文件进行压缩，否则不进行压缩。
          if (data.length > 1024) {
              zipdata = await new Promise((rv, rj) => {
                  zlib.gzip(data, (err, d) => {
                    if (err) {
                      rj(err)
                    } else {
                      rv(d)
                    }
                  })
              }).catch(err => {
                zipdata = null
              })
          }

          c.setHeader('content-length', zipdata ? zipdata.length : data.length)

          if (zipdata) {
            c.setHeader('content-encoding', 'gzip')
          }

          c.send(zipdata || data)

        } else {
          let fst = await fsp.stat(pathfile)
          c.setHeader('content-length', fst.size)

          data = await this.pipeData(pathfile, c)
          //说明数据太大，放弃了缓存
          if (!data) return;
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

      } catch (err) {
        c.status(404).send('read file failed')
      }
  
    }

  }

  init (app, group = null) {
    app.get(this.routePath, async c => {}, {group: group || this.routeGroup})
    app.use(this.mid(), {group : group || this.routeGroup})
  }

}

module.exports = staticdata
