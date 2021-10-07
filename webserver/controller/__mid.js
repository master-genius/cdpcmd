'use strict'

module.exports = [
  {
    middleware: async (c, next) => {

      let token = c.headers.authorization || c.query.token || ''

      if (!token || token !== c.service.token) {
        return c.status(403).send('deny')
      }

      await next()
    }
  }
]
