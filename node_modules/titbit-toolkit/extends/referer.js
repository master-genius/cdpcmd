'use strict';

class referer {
  constructor (options = {}) {

    this.allow = [];

    this.failedCode = 404;

    if (typeof options !== 'object') {
      options = {};
    }

    for (let k in options) {
      switch (k) {
        case 'allow':
          if (options[k] === '*' || (options[k] instanceof Array)) {
            this.allow = options[k];
          }
          break;
        
        case 'failedCode':
          if (typeof options[k] === 'number' && options[k] >=400 && options[k] < 500)
            this.failedCode = options[k];
          break;

      }
    }

  }

  mid () {
    let self = this;

    return async (c, next) => {

      if (c.headers.referer === undefined) c.headers.referer = '';

      let stat = false;

      if (self.allow === '*' || self.allow.length === 0 ) {
        stat = true;
      }
      else {
        let refer = c.headers.referer;

        for (let i = self.allow.length - 1; i >= 0; i--) {
          if (refer.indexOf(self.allow[i]) === 0) {
            stat = true;
            break;
          }
        }

      }
      
      if (stat) {
        await next();
      } else {
        c.status(self.failedCode).send('');
      }

    };

  }

}

module.exports = referer;
