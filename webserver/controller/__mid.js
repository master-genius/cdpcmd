'use strict'

let tkverify = async (c, next) => {

  if (c.ip === '127.0.0.1' || c.ip === '::1' || c.ip === '::ffff:127.0.0.1') {
    return await next()
  }

  if (!c.service.token) {
    return await next()
  }

  let token = c.headers.authorization || c.query.token || ''

  if (!token || token !== c.service.token) {
    return c.status(403).send('deny')
  }

  await next()
}

module.exports = [
  {
    middleware: tkverify
  }
]
