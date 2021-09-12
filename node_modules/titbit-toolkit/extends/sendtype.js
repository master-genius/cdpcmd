'use strict';

class sendtype {

  constructor () {
    
  }

  sendType (data, status = 200, type = 'html') {
    this.setHeader('content-type', `text/${type}; charset-utf-8`)
    this.send(data, status)
  }

  html (data, status = 200) {
    this.sendType(data, status, 'html')
  }

  json (data, status = 200) {
    this.sendType(data, status, 'json')
  }

  xml (data, status = 200) {
    this.sendType(data, status, 'xml')
  }

  string (data, status = 200) {
    this.sendType(data, status, 'plain')
  }

  js (data, status = 200) {
    this.sendType(data, status, 'javascript')
  }

  css (data, status = 200) {
    this.sendType(data, status, 'css')
  }

  mid () {

    let self = this

    return async (c, next) => {

      c.sendType = self.sendType
      c.sendhtml = self.html
      c.sendjson = self.json
      c.sendxml = self.xml
      c.sendtext = self.string
      c.sendjs = self.js
      c.sendcss = self.css
      
      await next()
    }

  }

}

module.exports = sendtype
