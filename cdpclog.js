'use strict'

const fs = require('fs')
const path = require('path')

const fsp = fs.promises

class cdpclog {

  constructor (logfile) {

    this.flog = null

    this.maxLines = 20000

    this.count = 0

    this.maxHistory = 15

    this.historyList = []

    this.logdir = path.resolve( path.dirname(logfile) )

    this.logname = path.basename(logfile)

    try {
      let flist = fs.readdirSync(this.logdir, {withFileTypes: true})
      for (f of flist) {
        if (!f.isFile()) continue

        if (f.name.substring(f.name.length - 4) !== '.log') continue

        this.historyList.push(`${this.logdir}/${f.name}`)
      }
    } catch (err) {

    }

    this.init().catch(err => {
      console.error(err)
    })

  }

  async init () {

    this.flog = fs.createWriteStream(this.logfile, 'a+', {flags: 'a+', mode: 0o644})

    this.flog.on('close', () => {
      this.flog = null
    })

    this.flog.on('error', () => {
      this.flog = null
    })

  }

  checkLog () {
    
  }

  log () {
    
  }

  okLog (err, errname) {

  }

  errorLog (err, errname) {

  }

}

module.exports = cdpclog
