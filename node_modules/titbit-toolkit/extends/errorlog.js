'use strict'

const cluster = require('node:cluster')
const fs = require('node:fs')
const fsp = fs.promises

const fmtTime = (m = 'long') => {
  let t = new Date()
  let year = t.getFullYear()
  let month = t.getMonth() + 1
  let day = t.getDate()
  let hour = t.getHours()
  let min = t.getMinutes()
  let sec = t.getSeconds()

  let mt = `${year}_${month > 9 ? '' : '0'}${month}_${day > 9 ? '' : '0'}${day}`

  if (m === 'short') {
    return mt
  }

  let md = `${mt}_${hour > 9 ? '' : '0'}${hour}`
  if (m === 'middle') {
    return md
  }

  return `${md}_${min > 9 ? '' : '0'}${min}_${sec > 9 ? '' : '0'}${sec}`
}

/**
 * 错误收集程序，它运行在两种模式：单独的记录和发送给master进程。
 * 
 * 格式： 
  ! --ERR-TAG-- | code | constructor name | message | time | extra info(ip, usera-gent...)
  stack info

  文件存储的命名格式：{prefix_name}_year_month_day_hour_minute_second.log
 * 
 */
class ErrorLog {
  constructor(options) {
    if (!options || typeof options !== 'object') options = {}

    this.flog = null
    this.dir = './tmp'
    this.prefix = 'errorlog_'
    this.maxHistory = 100
    this.maxLines = 10000
    this.historyList = []
    this.debug = false
    this.selfLog = false
    this.stdioOutput = false

    for (let k in options) {
      switch (k) {
        case 'dir':
        case 'prefix':
          if (typeof options[k] === 'string' && options[k]) {
            this[k] = options[k]
          }
          break

        case 'debug':
        case 'selfLog':
        case 'stdioOutput':
          this[k] = !!options[k]
          break

        case 'maxHistory':
        case 'maxLines':
          if (typeof options[k] === 'number' && options[k] > 0) {
            this[k] = options[k]
          }
          break
      }
    }

    this.logname = this.prefix + 'now.log'
    this.logfile = this.dir + '/' + this.logname

    this.initDirAndHistory()

    this.count = 0
    this.checkLock = false

    this.initLogStream()
  }

  initDirAndHistory() {
    if (!(cluster.isPrimary || this.selfLog)) return false;

    try {
      fs.accessSync(this.dir)
    } catch (err) {
      try {
        fs.mkdirSync(this.dir, {mode: 0o755})
      } catch (err) {
        this.debug && console.error(err)
      }
    }

    try {
      let flist = fs.readdirSync(this.dir, {withFileTypes: true})
      for (let f of flist) {
        if (!f.isFile()) continue

        if (f.name.substring(f.name.length - 4) !== '.log') continue

        if (f.name === this.logfile) continue

        if (f.name.indexOf(this.prefix) !== 0) continue

        this.historyList.push(`${this.dir}/${f.name}`)
      }
    } catch (err) {
      this.debug && console.error(err)
    }
  }

  /**
   * 
   * @param {object} app - Titbit实例
   */
  init(app) {
    if (app.strong && typeof app.strong === 'object') {
      app.strong.errorHandle = this.sendErrorLog.bind(this)
    }

    if (app.isWorker) {
      app.addService('sendErrorLog', this.sendErrorLog.bind(this))
    } else {
      app.setMsgEvent('errorlog', this.mlog.bind(this))
    }
  }

  async initLogStream() {
    if (this.flog) return;
    if (!(cluster.isPrimary || this.selfLog)) return;

    try {
      this.flog = fs.createWriteStream(this.logfile, {flags: 'a+', mode: 0o644})

      this.flog.on('close', () => {
        this.flog = null
      })

      this.flog.on('error', () => {
        this.flog = null
      })
    } catch (err) {
      this.debug && console.error(err)
    }
  }

  clearHistory() {
    if (this.historyList.length < this.maxHistory) return;

    let i = 0
    let total = 5
    let hfile

    while (i < total) {
      hfile = this.historyList.shift()
      if (!hfile) return;
      fs.unlink(hfile, err => {})
      i += 1
    }
  }

  async _checkLines() {
    if (!this.flog) return;
    if (this.count < this.maxLines) return;

    try {
      let old_log = `${this.dir}/${this.prefix}${fmtTime()}.log`

      await fsp.rename(this.logfile, old_log)

      this.historyList.push(old_log)
    } catch (err) {
      this.debug && console.error(err)
    } finally {
      this.flog && !this.flog.destroyed && this.flog.destroy()
      this.flog = null
      this.count = 0
      this.initLogStream()
    }
  }

  async checkLog() {
    if (this.checkLock) return;

    this.checkLock = true
    
    await this._checkLines()
    this.clearHistory()

    this.checkLock = false
  }

  fmtLog(msg) {
    let {error={}, errname='-'} = msg

    return `! ${errname} | ${error.code || '-'} | ${error.name} | `
          + `${error.message} | ${fmtTime()} | ${error.extrainfo || '-'}\n`
          + `${error.stack || ''}\n`
  }
  
  //mlog is master log
  async mlog(worker, msg, handle=null) {
    try {
      let logtext = this.fmtLog(msg)

      if (!this.flog) this.initLogStream()

      this.flog && this.flog.write(logtext) && (this.count += 1);

      this.checkLog()
    } catch (err) {
      this.debug && console.error(err)
    }
  }

  sendErrorLog(e, errname='--ERR-ERROR--') {
    if (e.code === 'EPIPE') {
      return false
    }

    this.stdioOutput && console.error(errname, e)

    let errmsg = {
      type: 'errorlog',
      error: {
        code: e.code || '',
        name: e.constructor.name,
        message: e.message,
        stack: e.stack || '',
        extrainfo: e.extrainfo || ''
      },
      errname
    }

    if (!process.send || this.selfLog) {
      return this.mlog(null, errmsg)
    }
  
    process.send(errmsg)
  }

}

module.exports = ErrorLog
