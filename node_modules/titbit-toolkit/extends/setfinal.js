'use strict'

class setfinal {

  constructor (options = {}) {
    
    this.finalHandle = null

    this.http1Final = null

    this.http2Final = null

    for (let k in options) {
      
      switch(k) {

        case 'http1Final':
        case 'http2Final':
        case 'finalHandle':
          if (typeof options[k] === 'function') {
            this.finalHandle = options[k]
          }
          break

      }

    }

  }

  init(app) {

    if (app.config.http2) {
      this.finalHandle = this.http2Final
    } else {
      this.finalHandle = this.http1Final
    }
    
    if (typeof this.finalHandle === 'function' && this.finalHandle.constructor.name === 'AsyncFunction')
    {
      app.midware.addFinal = () => {
        app.midware.add(this.finalHandle)
      }
    }

  }

}

module.exports = setfinal
