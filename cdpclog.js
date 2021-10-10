'use strict'

const fs = require('fs')

const fsp = fs.promises

class cdpclog {

  constructor (logfile) {
    this.maxLogs= 100000
    this.count = 0
  }

  log () {
    
  }

  okLog (err, errname) {

  }

  errorLog (err, errname) {

  }

}

module.exports = cdpclog
