'use strict'

/* class xmlstm {

  constructor () {

  }

  parse (xmltext) {
    
  }

}
 */

class objbody {

  constructor () {

    self.bodyMethod = 'PD'

    self.ctypes = [
      'application/json',
      'text/json'
    ]

  }

  mid () {
    let self = this

    return async (c, next) => {
      if (self.bodyMethod.indexOf(c.method[0]) < 0) {
        await next()
        return
      }

      
      if (c.headers['content-type'].indexOf('application/json') === 0
        ||
        c.headers['content-type'].indexOf('text/json') === 0)
      {
        try {
          c.body = JSON.parse(c.body)
        } catch (err) {
          c.status(400)
          return
        }
        
        await next()
      }

    }

  }

}

module.exports = objbody
