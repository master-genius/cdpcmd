'use strict'

/**
 *
 * 基于IP的限制，titbit已经能够处理。
 *
 * 此限流针对的是因为http/2协议设计上特点导致单个连接请求密集。
 *
 * 当请求密集时，关闭连接即可，若频繁发起连接请求，此时titbit层面的IP连接限制自会处理。
 *
 * 连接但不请求，空闲自然会有超时处理。
 *
 * 所以需要限制的场景：
 *    - 时间段内的密集请求。
 *    - 在空闲超时限制内，不频繁的请求，一直持有连接。
 *
 * 设定一个session生命期，超过则关闭连接。
 *
 **/

class stmlimit {

  constructor (options = {}) {
    this.cache = new Map();
  
    if (typeof options !== 'object') {
      options = {};
    }

    this.timeSlice = 1000;

    //单位时间内的最大请求次数。
    this.maxRequest = 50;

    this.socketLife = 3600000;

    for (let k in options) {
        switch (k) {
          case 'timeSlice':
          case 'maxRequest':
          case 'socketLife':
            if (typeof options[k] === 'number') {
              this[k] = options[k];
            }
            break;
        }
    }

  }

  _sid (sess) {
    return `${sess.socket.remoteAddress} ${sess.socket.remotePort}`;
  }

  set (id) {

    let s = this.cache.get(id);

    if (!s) {
      let d = {
        time: Date.now(),
        count: 1
      };

      d.startTime = d.time;

      this.cache.set(id, d);
      return d;
    }

    s.count += 1;
    
    return s;
  }

  remove (id) {
    return this.cache.delete(id);
  }

  checkAndSet (id) {
    let s = this.set(id);
 
    if (s.count <= 1) return true;
    
    let tm = Date.now();
    
    if (this.socketLife > 0 && (s.startTime + this.socketLife) < tm) {
      return null;
    }

    if ( (s.time + this.timeSlice) > tm ) {
      if (this.maxRequest > 0 && s.count > this.maxRequest) {
        return false;
      }
    } else {
      s.count = 1;
      s.time = tm;
    }

    return true;
  }

  init (app) {
    app.on('session', session => {

        let id = this._sid(session);

        session.socket && session.socket.on('close', () => {
            this.remove(id);
        });

        session.on('stream', stm => {
          let st = this.checkAndSet(id);
          if (st === null) {
            session.close(() => {
              !session.destroyed && session.destroy();
            });
          } else if (!st) {
            session.destroy();
          }
        });
    });
  }

}

module.exports = stmlimit;

