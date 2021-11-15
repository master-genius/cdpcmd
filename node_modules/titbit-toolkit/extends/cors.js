'use strict';

/**
 * 跨域请求中，在以下情况下，origin不会出现：
 *        https页面请求http接口。
 *        但是在目前的策略中，在https页面中，引入http资源会引入不安全因素。
 *        浏览器会报错：已阻止载入混合活动内容。
 * 
 * 跨域请求中，origin字段是必须的。
 * 
 * 在https跨域测试中，若要使用自签名的证书，必须先通过浏览器访问后端API，并把证书添加信任。
 * 
 * 这之后，fetch才会成功请求。
 * 
 * 这里讨论的跨域和referer问题只有在浏览器环境才会有效，通过命令请求完全不会理会这些处理过程。
 * 
 * 严格的权限控制要通过token以及其他数据检测手段。
 * 
 * 所以为了保证服务既可以适用于跨域也可以同源，必须要针对referer进行检测。
 * 
 * 
 */

class cors {

  constructor (options = {}) {
    
    this.allow = '*';
    
    this.allowHeaders = 'content-type';

    this.requestHeaders = '*';

    //Access-Control-Expose-Headers 指定哪些消息头可以暴露给请求端。
    this.exposeHeaders = '';

    this.methods = [
      'GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'
    ];

    if (typeof options !== 'object') {
      options = {};
    }

    this.optionsCache = null;

    for (let k in options) {
      switch (k) {
        case 'allow':
          if (options[k] === '*' || (options[k] instanceof Array)) {
            this.allow = options[k];
          }
          break;

        case 'referer':
          if (options[k] === '*') {
            this[k] = '*';
          } else {
            if (typeof options[k] === 'string') options[k] = [ options[k] ];
            if (options[k] instanceof Array) this[k] = options[k];
          }
          break;

        case 'requestHeaders':
          this.requestHeaders = options[k];
          break;

        case 'methods':

          if ((options[k] instanceof Array) || typeof options[k] === 'string') {
            this.methods = options[k];
          }

          break;

        case 'optionsCache':
        case 'maxAge':
          if (!isNaN(options[k]))
            this.optionsCache = options[k];
          break;

        case 'allowHeaders':
          this.allowHeaders = options[k];
          break;

        case 'exposeHeaders':
          this.exposeHeaders = options[k];
          break;

      }
    }

    if (this.methods instanceof Array) {
      this.methodString = this.methods.join(',');
    } else {
      this.methodString = this.methods;
    }

  }

  checkOrigin (url) {
    if (this.allow.indexOf(url) >= 0) return true;

    return false;
  }

  checkReferer (url) {
    if (this.allow === '*') return true;

    for (let r of this.allow) {
      if (url.indexOf(r) === 0) return true;
    }
  }

  /**
   * 要区分两种状态：跨域请求和同源请求。
   *    在同源请求：c.headers.referer必然是包含页面路径。
   *    若直接请求此资源则不会返回数据。
   * 
   */

  mid () {
    let self = this;

    return async (c, next) => {

      //跨域请求，必须存在origin。
      if (c.headers.origin) {
          if (self.allow === '*' || self.checkOrigin(c.headers.origin)) {
            c.setHeader('access-control-allow-origin', '*');
            c.setHeader('access-control-allow-methods', self.methodString);
            c.setHeader('access-control-allow-headers', self.allowHeaders);
            //服务端也要包含此消息头。
            c.setHeader('access-control-request-headers', self.requestHeaders);

            if (self.exposeHeaders)
              c.setHeader('access-control-expose-headers', self.exposeHeaders);

            //method is OPTIONS
            if (c.method[0] === 'O') {
              self.optionsCache && c.setHeader('access-control-max-age', self.optionsCache);
            } else {
              return await next();
            }
          }
      } else {
        /**
         * 在浏览器里，如果是跨域，则必然会遵循跨域原则，所以origin和referer的规则都会有效。
         * 若不是浏览器，仅凭CORS规范是无法约束非法请求的。
         */
        //有一种情况，直接返回的页面并不具备referer，所以前端页面的请求不能有跨域扩展。
        //直接通过file方式进行，也不会有referer。

        //非跨域请求，或仅仅是没有携带origin
        let referer = c.headers.referer || '';

        //处理同源请求。要求allow配置为 * 或使用数组配置必须包含返回页面应用的host。
        if (referer && self.checkReferer(referer)) {
          return await next();
        }
        
        //检测referer是否是同源的请求
        //这种情况其实还要验证host，就和origin的allow验证一致。
        //let org_url = `${c.protocol}://${c.host}`;

        /* if (referer.indexOf(org_url) === 0 
          || (this.emptyReferer && referer === '')
          || (referer && self.checkReferer(referer)) )
        {
          return await next();
        } */
      }
      
    };

  }

}

module.exports = cors;
