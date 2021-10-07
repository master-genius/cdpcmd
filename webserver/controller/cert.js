'use strict'

class cert {

  constructor () {
    this.param = ''
  }

  async put (c) {
    let fcert = c.getFile('cert')
    let fkey = c.getFile('key')

    if (!fcert || !fkey) {
      return c.status(400).send('cert or key file not found')
    }

    await fcert.toFile(c.service.certDir, c.service.certFile)

    await fkey.toFile(c.service.certDir, c.service.keyFile)

    c.service.restart()

  }

}

module.exports = cert
