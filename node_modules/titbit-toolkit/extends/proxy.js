'use strict';

const urlparse = require('url');
const http = require('http');
const https = require('https');

/**
 * {
 *    host : {}
 * }
 * {
 *    host : ''
 * }
 * 
 * {
 *    host : [
 *      {}
 *    ]
 * }
 * 
 */

class proxy {

  constructor (options = {}) {

    this.methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE'];

    this.hostProxy = {};

    this.proxyBalance = {};

    this.pathTable = {};

    this.config = {};

    this.urlpreg = /(unix|http|https):\/\/[a-zA-Z0-9\-\_]+/;

    this.maxBody = 50000000;

    //是否启用全代理模式。
    this.full = false;

    this.timeout = 10000;

    this.addIP = false;

    //记录定时器
    this.proxyIntervals = {};

    this.error = {
      '502' : `<!DOCTYPE html><html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error 502</title>
          </head>
          <body>
            <div style="width:100%;font-size:105%;color:#737373;padding:0.8rem;">
              <h2>502 Bad Gateway</h2><br>
              <p>代理请求不可达。</p>
            </div>
          </body>
      </html>`,

      '503' :`<!DOCTYPE html><html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error 503</title>
          </head>
          <body>
            <div style="width:100%;font-size:105%;color:#737373;padding:0.8rem;">
              <h2>503 Service Unavailable</h2><br>
              <p>此服务暂时不可用。</p>
            </div>
          </body>
      </html>` 
    };

    if (typeof options !== 'object') {
      options = {};
    }

    for (let k in options) {
      switch (k) {
        case 'host':
        case 'config':
          this.config = options[k];
          break;

        case 'methods':
          if (options[k] instanceof Array)
            this.methods = options[k];
          break;

        case 'maxBody':
          if (typeof options[k] == 'number' && parseInt(options[k]) >= 0) {
            this.maxBody = parseInt(options[k]);
          }
          break;
      
        case 'full':
          this.full = options[k] ? true : false;
          break;

        case 'timeout':
          if (typeof options[k] === 'number' && options[k] >= 0) {
            this.timeout = options[k];
          }
          break;

        case 'addIP':
          this.addIP = options[k];
          break;

        default:;
      }
    }

    this.setHostProxy(this.config);

  }

  fmtpath (path) {
    path = path.trim();
    if (path.length == 0) {
      return '/*';
    }

    if (path[0] !== '/') {
      path = `/${path}`;
    }

    if (path.length > 1 && path[path.length - 1] !== '/') {
      path = `${path}/`;
    }

    if (path.indexOf('/:') >= 0) {
      return path.substring(0, path.length-1);
    }

    return `${path}*`;
  }

  setHostProxy (cfg) {
    if (typeof cfg !== 'object') {
      return;
    }

    let pt = '';
    let tmp = '';
    let backend_obj = null;

    for (let k in cfg) {

      if (typeof cfg[k] === 'string') {
        cfg[k] = [ { path : '/', url : cfg[k] } ];

      } else if (!(cfg[k] instanceof Array) && typeof cfg[k] === 'object') {
        cfg[k] = [ cfg[k] ];

      } else if ( !(cfg[k] instanceof Array) ) {
        continue;
      }
      /**
       * {
       *    path : '',
       *    url : '',
       *    aliveCheckPath : '',
       *    headers : {}
       * }
       */
      for (let i = 0; i < cfg[k].length; i++) {
        tmp = cfg[k][i];

        if (typeof tmp !== 'object' || (tmp instanceof Array) ) {
          console.error(`${k} ${JSON.stringify(tmp)} 错误的配置格式`);
          continue;
        }

        if (tmp.path === undefined) {
          tmp.path = '/';
        }

        if (tmp.url === undefined) {
          console.error(`${k} ${tmp.path}：没有指定要代理转发的url。`);
          continue;
        }

        if (this.urlpreg.test(tmp.url) === false) {
          console.error(`${tmp.url} : 错误的url，请检查。`);
          continue;
        }

        pt = this.fmtpath(tmp.path);
  
        if (tmp.url[ tmp.url.length - 1 ] == '/') {
          tmp.url = tmp.url.substring(0, tmp.url.length - 1);
        }
  
        if (tmp.headers !== undefined) {
          if (typeof tmp.headers !== 'object') {
            console.error(`${k} ${tmp.url} ${tmp.path}：headers属性要求是object类型，使用key-value形式提供。`);
            continue;
          }
        }

        if (this.hostProxy[k] === undefined) {
          this.hostProxy[k] = {};
          this.proxyBalance[k] = {};
        }
  
        tmp.urlobj = this.parseUrl(tmp.url);

        tmp.urlobj.timeout = tmp.timeout || this.timeout;

        backend_obj = {
          url : tmp.url,
          urlobj : tmp.urlobj,
          headers : {},
          path : tmp.path,
          weight: 1,
          weightCount : 0,
          alive : true,
          aliveCheckInterval : 5,
          aliveCheckPath : '/',
          intervalCount : 0,
        };

        if (tmp.headers !== undefined) {
          for (let h in tmp.headers) {
            backend_obj.headers[h] = tmp.headers[h];
          }
        }

        if (typeof tmp.aliveCheckPath === 'string' && tmp.aliveCheckPath.length > 0) {
          if (tmp.aliveCheckPath[0] !== '/') {
            tmp.aliveCheckPath = `/${tmp.aliveCheckPath}`;
          }

          backend_obj.aliveCheckPath = tmp.aliveCheckPath;
        }

        if (tmp.weight && typeof tmp.weight === 'number' && tmp.weight > 1) {
          backend_obj.weight = parseInt(tmp.weight);
        }

        if (tmp.aliveCheckInterval && typeof tmp.aliveCheckInterval === 'number') {
          if (tmp.aliveCheckInterval >= 0 && tmp.aliveCheckInterval < 7200) {
            backend_obj.aliveCheckInterval = tmp.aliveCheckInterval;
          }
        }

        if (this.hostProxy[k][pt] === undefined) {
          
          this.hostProxy[k][pt] = [ backend_obj ];
          this.proxyBalance[k][pt] = {
            stepIndex : 0,
            useWeight : false
          };
          
        } else if (this.hostProxy[k][pt] instanceof Array) {
          this.hostProxy[k][pt].push(backend_obj);
        }

        if (backend_obj.weight > 1) {
          this.proxyBalance[k][pt].useWeight = true;
        }

        this.pathTable[pt] = 1;

      }
    }
  }

  parseUrl (url) {
    var u = new urlparse.URL(url);
    var urlobj = {
      hash :    u.hash,
      hostname :  u.hostname,
      protocol :  u.protocol,
      path :    u.pathname,
      method :  'GET',
      headers : {},
    };

    if (u.search.length > 0) {
      urlobj.path += u.search;
    }
    
    if (u.protocol  === 'unix:') {
      urlobj.protocol = 'http:';
      let sockarr = u.pathname.split('.sock');
      urlobj.socketPath = `${sockarr[0]}.sock`;
      urlobj.path = sockarr[1];
    } else {
      urlobj.host = u.host;
      urlobj.port = u.port;
    }
  
    if (u.protocol === 'https:') {
      urlobj.requestCert = false;
      urlobj.rejectUnauthorized = false;
    }
  
    return urlobj;
  }

  copyUrlobj (uobj) {
    let u = {
      hash: uobj.hash,
      hostname :  uobj.hostname,
      protocol :  uobj.protocol,
      path :    uobj.path,
      method :  'GET',
      headers : {},
      timeout : uobj.timeout
    };

    if (uobj.host) {
      u.host = uobj.host;
      u.port = uobj.port;
    } else {
      u.socketPath = uobj.socketPath;
    }

    if (uobj.protocol === 'https:') {
      u.requestCert = false;
      u.rejectUnauthorized = false;
    }

    return u;
  }

  getBackend (c, host) {
    let prlist = this.hostProxy[host][c.routepath];
    let pb = this.proxyBalance[host][c.routepath];
    let pr;

    if (prlist.length === 1) {
      pr = prlist[0];
    } else {
      if (pb.stepIndex >= prlist.length) {
        pb.stepIndex = 0;
      }

      pr = prlist[pb.stepIndex];

      if (pb.useWeight) {
        if (pr.weightCount >= pr.weight) {
          pr.weightCount = 0;
          pb.stepIndex += 1;
        } else {
          pr.weightCount += 1;
        }
      } else {
        pb.stepIndex += 1;
      }
    }

    if (pr.alive === false) {
      for (let i = 0; i < prlist.length; i++) {
        
        pr = prlist[i];

        if (pr.alive === true) {
          return pr;
        }
      }
      return null;
    }

    return pr;
  }

  midhost () {
    let self = this;
    let timeoutError = new Error('request timeout');
    timeoutError.code = 'ETIMEOUT';

    return async (c, next) => {

      let host = c.host;

      let hind = c.host.length - 1;

      if (hind > 4) {
        let eind = hind - 5;
  
        while (hind >= eind) {
          if (c.host[hind] === ':') {
            host = c.host.substring(0, hind);
            break;
          }
    
          hind -= 1;
        }
      }
      
      if (self.hostProxy[host]===undefined || self.hostProxy[host][c.routepath]===undefined) {
        if (self.full) {
          c.send(self.error['502'], 502);
          return;
        }
        return await next();
      }

      let pr = self.getBackend(c, host);

      if (pr === null) {
        c.send(self.error['503'], 503);
        return;
      }

      let urlobj = self.copyUrlobj(pr.urlobj);

      urlobj.path = c.request.url;
      urlobj.headers = c.headers;
      urlobj.method = c.method;

      if (self.addIP && urlobj.headers['x-real-ip']) {
        urlobj.headers['x-real-ip'] += `,${c.ip}`;
      } else {
        urlobj.headers['x-real-ip'] = c.ip;
      }

      let hci = urlobj.protocol == 'https:' ? https : http;

      let h = hci.request(urlobj);

      h.on('timeout', () => {
        h.destroy(timeoutError);
      });

      return await new Promise((rv, rj) => {
        h.on('response', res => {
          
          c.status(res.statusCode);

          for (let k in res.headers) {
            c.setHeader(k, res.headers[k]);
          }
    
          res.on('data', chunk => {
            c.response.write(chunk);
          });
      
          res.on('end', () => {
            c.response.end();
            rv();
          });
      
          res.on('error', err => {
            rj(err);
          });
        });

        h.on('error', (err) => {
          rj(err);
        });
    
        c.request.on('data', chunk => {
          h.write(chunk);
        });
    
        c.request.on('end', () => {
          h.end();
        });
    
      }).catch(err => {
        c.send(self.error['503'], 503);
      });

    };

  }

  timerRequest (pxy) {
    let h = http;

    let opts = {
      timeout : this.timeout
    };

    if (pxy.urlobj.protocol === 'https:') {
      h = https;
      opts.rejectUnauthorized = false;
      opts.requestCert = false;
    }

    let aliveUrl = `${pxy.urlobj.protocol}//${pxy.urlobj.host}${pxy.aliveCheckPath}`;

    h.get(aliveUrl, opts, res => {
      
      res.on('error', err => {
        pxy.alive = false;
      })

      res.on('data', chunk => {});
      
      res.on('end', () => {
        pxy.alive = true;
      });

    }).on('error', err => {
      pxy.alive = false;
    });
  }

  setTimer (pxys) {

    let count = 0;

    for (let p of pxys) {
      if (p.aliveCheckInterval > 0) count += 1;
    }

    if (count === 0) return null;
    
    let self = this;

    return setInterval(() => {

      for (let i = 0; i < pxys.length; i++) {
        if (pxys[i].aliveCheckInterval <= 0) continue;

        pxys[i].intervalCount += 1;

        if (pxys[i].intervalCount >= pxys[i].aliveCheckInterval) {
          pxys[i].intervalCount = 0;
          self.timerRequest(pxys[i]);
        }
      }

    }, 1000);
    
  }

  init (app) {

    app.config.timeout = this.timeout;

    for (let p in this.pathTable) {
      app.router.map(this.methods, p, async c => {}, '@titbit_proxy');
    }

    app.use(this.midhost(), {pre: true, group: `titbit_proxy`});

    for (let k in this.hostProxy) {

      this.proxyIntervals[k] = {};

      for (let p in this.hostProxy[k]) {
        this.proxyIntervals[k][p] = this.setTimer(this.hostProxy[k][p]);
      }
      
    }

  }

}

module.exports = proxy;
