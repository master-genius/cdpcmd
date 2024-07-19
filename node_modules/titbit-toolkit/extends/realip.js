'use strict'

class realip {

  constructor() {
    
  }

  mid() {
    return async (c, next) => {

      let realipstr = c.headers['x-real-ip'] || c.headers['x-forwarded-for'] || ''

      if (realipstr !== '') {
        if (realipstr.indexOf(',') > 0) {
          
          c.box.realip = realipstr.split(',').filter(p => p.length > 0)

          if (c.box.realip.length > 0) {
            c.ip = c.box.realip[0].trim()
          }
        } else {
          c.ip = realipstr
        }
      }

      await next()

    }

  }

}

module.exports = realip
