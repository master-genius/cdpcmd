'use strict';

const fs = require('fs');
const tls = require('tls');

class sni {
  constructor (certs = {}) {
    this.certs = {};

    if (typeof certs !== 'object') {
      throw new Error('必须传递key-value形式的配置，key是域名，value是证书路径');
    }

    let t = '';
    for (let h in certs) {
      t = certs[h];
      if (t.key === undefined || t.cert === undefined) {
        console.error(`${h} 没有设置key和cert`);
        continue;
      }

      try {
        this.certs[h] = {
          key : fs.readFileSync(t.key),
          cert : fs.readFileSync(t.cert)
        }
      } catch (err) {
        console.error(h, err.message);
        continue;
      }

    }
  }

  init (app) {
    let self = this;
    app.config.server.SNICallback = (servername, cb) => {
      return cb(null, tls.createSecureContext(self.certs[servername]) );
    };
  }

}

module.exports = sni;
