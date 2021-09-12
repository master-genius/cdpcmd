'use strict'

const cluster = require('cluster')

class mixlogger {

  constructor (options = {}) {
    this.logHandle = (w, msg, handle) => {
      return true
    }

    for (let k in options) {
      switch(k) {
        case 'logHandle':
          if (typeof options[k] === 'function') {
            this.logHandle = options[k]
          }
          break

      }
    }

  }

  init(app) {

    if (cluster.isWorker) {
      return
    }

    if (app.daeMsgEvent['_log'] === undefined) {
      console.error(`Warning: mixlogger must be running in daemon mode`)
      return
    }

    let self = this

    let org_log = app.daeMsgEvent['_log'].callback

    let log_handle = (w, msg, handle) => {
      if (false === self.logHandle(w, msg, handle) ) {
        return
      }

      org_log(w, msg, handle)
    }

    app.setMsgEvent('_log', log_handle)
  }

}

module.exports = mixlogger
