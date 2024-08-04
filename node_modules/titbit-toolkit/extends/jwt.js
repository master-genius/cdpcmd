'use strict'

/**
 * 
 * jwt格式：
 * 
 * base64UrlEncoded(header).base64UrlEncoded(payload).signature
 * 
 * header: {
 *   "alg": "hs256",
 *   "typ": "JWT"
 * }
 * 
 * payload是任何object类型的数据
 * 
 * payload 示例 {
 *   "id": "1234",
 *   "name": "okk"
 * }
 * 
 * signature是hamacsha256(base64UrlEncoded(header).base64UrlEncoded(payload), key)
 * 
 */

const randstring = require('./__randstring')

const crypto = require('crypto')

class JWT {

  constructor(options = {}) {
    this.expires = 3600000
    this.autoTimeout = true
    this.header = ''

    this.algMap = {
      HS256: 'sha256',
      HS384: 'sha384',
      HS512: 'sha512',
      SM3: 'sm3',
      SHA256: 'sha256',
      SHA512: 'sha512',
      SHA384: 'sha384'
    }

    this.algKeys = Object.keys(this.algMap)

    Object.defineProperty(this, '__key__', {
      value: randstring(16),
      enumerable: false,
      configurable: false,
      writable: true
    })

    Object.defineProperty(this, '__alg__', {
      value: 'SM3',
      enumerable: false,
      configurable: false,
      writable: true
    })

    Object.defineProperties(this, {
      key: {
        get: () => {
          return this.__key__
        },

        set: (key) => {
          this.__key__ = key
          this.makeHeader()
        }
      },

      alg: {
        get: () => {
          return this.__alg__
        },

        set: (a) => {
          a = a.toUpperCase()
          if (this.algKeys.indexOf(a) >= 0) {
            this.__alg__ = a
            this.makeHeader()
          } else {
            console.error(`无法支持的算法：${a}`)
          }
        }
      }
    })

    for (let k in options) {
      switch(k) {
        case 'expires':
        case 'autoTimeout':
        case 'alg':
        case 'key':
          this[k] = options[k];
          break;
      }
    }

    this.makeHeader()
  }

  makeHeader() {
    let hdata = `{"alg":"${this.__alg__}","typ":"JWT"}`
    this.header = Buffer.from(hdata).toString('base64url')
  }

  make(data) {
    if (typeof data === 'object') {
      if (this.autoTimeout) {
        data.__timeout__ = Date.now() + this.expires
      }

      data = JSON.stringify(data)
    }

    let org_str = `${this.header}.${Buffer.from(data).toString('base64url')}`
    return `${org_str}.${this.sign(org_str, this.algMap[this.__alg__])}`
  }

  sign(org_str, a = 'sm3') {
    let h = crypto.createHmac(a, this.__key__)
    h.update(org_str)
    return h.digest('base64url')
  }

  verify(token) {
    let arr = token.split('.')
    if (arr.length !== 3) {
      return {
        ok: false,
        errcode: 'ILLEGAL'
      }
    }

    let alg = this.__alg__

    try {
      let header = JSON.parse(Buffer.from(arr[0], 'base64url').toString('utf8'))
      alg = header.alg
    } catch (err) {
      return {
        ok: false,
        errcode: 'ERR_HEADER'
      }
    }

    let hs = this.algMap[alg]

    if (!hs) {
      return {
        ok: false,
        errcode: 'UNKNOW_ALG'
      }
    }
    
    let hstr = this.sign(`${arr[0]}.${arr[1]}`, hs)

    if (hstr !== arr[2]) {
      return {
        ok: false,
        errcode: 'FAILED'
      }
    }

    let data = Buffer.from(arr[1], 'base64url').toString('utf8')

    try {
      data = JSON.parse(data)
    } catch (err) {
      return {
        ok: false,
        errcode: 'ERR_DATA'
      }
    }

    if (data.__timeout__ !== undefined && (Date.now() > data.__timeout__)) {
      return {
        ok: false,
        errcode: 'TIMEOUT'
      }
    }

    return {
      ok: true,
      data: data
    }

  }

  mid() {
    let self = this

    return async (c, next) => {
      let token = c.headers.authorization
      if (!token) {
        return c.status(401).send('unauthorized')
      }

      let r = self.verify(token)

      if (!r.ok) {
        return c.status(401).send(r.errcode)
      }

      c.box.user = r.data

      await next()
    }
  }

}

module.exports = JWT
