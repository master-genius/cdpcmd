'use strict';

class cookies {
  constructor () {

  }

  mid () {

    return async (rr, next) => {
      
      rr.cookie = {};

      if (rr.headers['cookie']) {
        var cookies = rr.headers['cookie'].split(';').filter(c => c.length > 0);
    
        var tmpList = [];
        var name = '';

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

module.exports = cookies;
