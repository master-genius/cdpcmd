'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')

/*
  这个模块用于titbit框架的登录会话，调用一定要在cookie中间件之后。
  整体的过程就是在基于cookie中间件的解析结果，如果检测到cookie中有会话ID
  则寻找文件并读取数据，解析成JSON对象添加到c.session；如果cookie中
  没有会话ID或者读取文件失败则创建会话文件并发送Set-Cookie头部信息保存会话ID。
*/

class Session {

  constructor() {
    this.expires = false
    this.domain  = false
    this.path  = '/'
    this.sessionDir = '/tmp'

    this.ds = '/'

    if (process.platform.indexOf('win') === 0) {
      this.ds = '\\'
      this.sessionDir = 'C:\\Users\\Public\\sess'
      try {
        fs.accessSync(this.sessionDir)
      } catch (err) {
        fs.mkdirSync(this.sessionDir)
      }
    }

    this.prefix = 'titbit_sess_'

    this.sessionKey = 'TITBIT_SESSID'

    this.error = null

  }

  init(app) {
    let proto = app.httpServ.Content.prototype

    let self = this

    proto.sessionError = function (options={}) {
      let err = self.error
      if (options.clear) self.error = null
      return err
    }

    proto.setSession = function (key, data) {
      this._session[key] = data
      this._sessionState = true
    }

    proto.getSession = function (key = null) {
      if (key === null) {
        return this._session
      }

      return this._session[key] || null
    }

    proto.deleteSession = function (key) {
      delete this._session[key]
      this._sessionState = true
    }

    proto.clearSession = function () {
      this._sessionState = false
      this._session = {}
      fs.unlink(this._sessFile, (err) => {
        err && (self.error = err)
      })
    }

  }

  mid() {
    let self = this

    return async (c, next) => {
      c._session = {}
      c._sessionState = false
      c._sessFile = ''

      let sess_file = ''
      let sessid = c.cookie[ self.sessionKey ]
      let sess_state

      if (sessid) {
        sess_file = `${self.sessionDir}${self.ds}${self.prefix}${sessid}`
        c._sessFile = sess_file

        await new Promise((rv, rj) => {
          fs.readFile(sess_file, (err, data) => {
            if (err) {
              rj(err)
            } else {
              sess_state = true
              rv(data)
            }
          })
        }).then(data => {
          c._session = JSON.parse(data)
        }, err => {
          sess_state = false
        }).catch(err => {
          self.error = err
        })
      }

      if (sessid === undefined || sess_state === false) {
        let org_name = `${c.host}_${Date.now()}__${Math.random()}`

        let hash = crypto.createHash('sha1')

        hash.update(org_name)

        sessid = hash.digest('hex')
  
        sess_file = self.prefix + sessid
  
        let set_cookie = `${self.sessionKey}=${sessid};`

        if (self.expires) {
          var t = new Date(Date.now() + self.expires * 1000)
          set_cookie += `Expires=${t.toString()};`
        }
  
        set_cookie += `Path=${self.path};`
  
        if (self.domain) {
          set_cookie += `Domain=${self.domain}`
        }
  
        let session_path_file = `${self.sessionDir}/${sess_file}`

        c._sessFile = session_path_file

        await new Promise((rv, rj) => {
          fs.writeFile(session_path_file, '{}', err => {
            if (err) {
              rj(err)
            } else {
              rv(true)
            }
          })
        }).then(data => {
          c.setHeader('set-cookie', set_cookie)
        }, err => {
          self.error = err
        })

      }

      await next()

      if (c._sessionState) {
        let tmpText = JSON.stringify(c._session)
        fs.writeFile(c._sessFile, tmpText, (err) => {
          self.error = err
        })
      }
      
      c._session = null
    }

  }

}

module.exports = Session
