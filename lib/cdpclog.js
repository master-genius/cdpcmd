'use strict'

const fs = require('fs')
const path = require('path')
const fmtTime = require('./fmttime')

const fsp = fs.promises

class cdpclog {

  constructor (logfile) {

    this.flog = null

    this.maxLines = 20000

    this.count = 0

    this.checkLock = false

    this.maxHistory = 15

    this.historyList = []

    this.logfile = logfile

    this.logdir = path.resolve( path.dirname(logfile) )

    this.logname = path.basename(logfile)

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

    this.flog = fs.createWriteStream(this.logfile, {flags: 'a+', mode: 0o644})

    this.flog.on('close', () => {
      this.flog = null
    })

    this.flog.on('error', () => {
      this.flog = null
    })

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
    if (this.count < this.maxLines) return;

    try {
      let new_log = `${this.logdir}/${fmtTime()}_${this.logname}`;
      await fsp.rename(this.logfile, new_log);
      this.historyList.push(new_log);
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
    return `! ${msg.errorType} | ${fmtTime} | `
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

    this.checkLog()
  }

  errorLog (err, errname) {
    this.log({
      type: 'error',
      errorType: err.constructor.name,
      errname: errname,
      message: err.message,
      stack: err.stack || '',
      code: err.code || ''
    })
  }

}

module.exports = cdpclog
