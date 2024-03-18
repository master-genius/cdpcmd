'use strict';

class sendtype {

  constructor () {
    
  }

  sendType (data, type = 'html') {
    this.setHeader('content-type', `${type};charset-utf-8`)
        .send(data);
  }

  html (data) {
    this.sendType(data, 'text/html')
  }

  json (data) {
    this.sendType(data, 'application/json')
  }

  xml (data) {
    this.sendType(data, 'application/xml')
  }

  text (data) {
    this.sendType(data, 'text/plain')
  }

  js (data) {
    this.sendType(data, 'text/javascript')
  }

  css (data) {
    this.sendType(data, 'text/css')
  }

  mid () {

    let self = this

    return async (c, next) => {

      c.sendType = self.sendType
      c.sendhtml = self.html
      c.sendjson = self.json
      c.sendxml = self.xml
      c.sendtext = self.text
      c.sendjs = self.js
      c.sendcss = self.css
      
      await next()
    }

  }

}

module.exports = sendtype
