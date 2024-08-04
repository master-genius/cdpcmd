'use strict';

class Cookie {
  constructor() {

  }

  mid() {

    return async (rr, next) => {
      
      rr.cookie = {};

      if (rr.headers['cookie']) {
        let cookies = rr.headers['cookie'].split(';').filter(c => c.length > 0);
    
        let tmpList = [];
        let name = '';

        for(let i = 0; i < cookies.length; i++) {

          tmpList = cookies[i].split('=').filter(p => p.length > 0);
          name = tmpList[0].trim();

          if (name.length == 0) {
            continue;
          }
          if (tmpList.length < 2) {
            rr.cookie[name] = '';
          }
          else {
            rr.cookie[name] = tmpList[1];
          }
        }
      }

      await next();
      
      rr.cookie = null;
    };

  }

}

module.exports = Cookie;
