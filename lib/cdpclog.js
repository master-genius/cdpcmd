'use strict'

const fs = require('fs')
const path = require('path')
const fmtTime = require('./fmttime')

const fsp = fs.promises

class cdpclog {

  constructor (logfile) {

    this.flog = null

    this.maxLines = 10000

    this.count = 0

    this.checkLock = false

    this.maxHistory = 50

    this.historyList = []

    this.logfile = logfile

    this.logdir = path.resolve( path.dirname(logfile) )

    this.logname = path.basename(logfile)

    this.prefix = this.logname.substring(0, this.logname.length - 4) + '_'

    try {
      let flist = fs.readdirSync(this.logdir, {withFileTypes: true})
      for (f of flist) {
        if (!f.isFile()) continue

        if (f.name.substring(f.name.length - 4) !== '.log') continue

        if (f.name === this.logname) continue

        this.historyList.push(`${this.logdir}/${f.name}`)
      }
    } catch (err) {

    }

    this.init().catch(err => {
      console.error(err)
    })

  }

  async init () {

    if (this.flog === null) {
      this.flog = fs.createWriteStream(this.logfile, {flags: 'a+', mode: 0o644})

      this.flog.on('close', () => {
        this.flog = null
      })

      this.flog.on('error', () => {
        this.flog = null
      })
    }

  }

  clearHistory () {
    if (this.historyList.length < this.maxHistory) return;

    let i = 0;
    let total = 5;
    let hfile;

    while (i < total) {
      hfile = this.historyList.shift();
      if (!hfile) return;
      fs.unlink(hfile, err => {});
      i += 1;
    }
  }

  async _checkLines () {
    if (!this.flog) return;
    if (this.count < this.maxLines) return;

    try {
      let old_log = `${this.logdir}/${this.prefix}${fmtTime()}.log`
      await fsp.rename(this.logfile, old_log)

      this.historyList.push(old_log)
      this.flog && !this.flog.destroyed && this.flog.destroy()
      this.flog = null
      this.count = 0
      this.init()
    } catch (err) {}

  }

  async checkLog () {
    if (this.checkLock) return;

    this.checkLock = true

    await this._checkLines()

    this.clearHistory()

    this.checkLock = false
  }

  fmtLog (msg) {
    return `@ ${msg.logname || 'log'} | ${fmtTime()} | ${msg.message} | ${msg.other || '-'}\n`
  }

  fmtErrorLog (msg) {
    return `! ${msg.errorType} | ${fmtTime()} | `
        + `${msg.message} | ${msg.code || '-'} | ${msg.errname} | ${msg.other || '-'}\n`
        + `  ${msg.stack}\n`
  }

  /**
   * 日志格式
   *    @ 正确的日志
   *    ! 错误的日志
   *    ' | '字段分隔符
   */

  log (msg) {
    if (!msg.type || !msg.message) {
      return
    }

    let logtext = ''

    if (msg.type === 'error') {
      logtext = this.fmtErrorLog(msg)
    } else {
      logtext = this.fmtLog(msg)
    }

    this.flog && this.flog.write(logtext) && (this.count += 1)

    if (!this.flog) this.init()

    this.checkLog()
  }

  errorLog (err, errname) {
    let emsg = typeof err === 'string' ? err : err.message;
    let etype = typeof err === 'string' ? 'errorText' : err.constructor.name

    this.log({
      type: 'error',
      errorType: etype,
      errname: errname,
      message: emsg,
      stack: err.stack || '',
      code: err.code || ''
    })
  }

}

module.exports = cdpclog
