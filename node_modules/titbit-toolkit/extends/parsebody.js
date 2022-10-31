'use strict';

/**
 * 目前仅仅支持json
 * application/x-www-form-urlencoded类型titbit会自动处理。
 * 上传文件titbit也会自动解析。
 */

class parsebody {

  constructor () {

  }

  mid () {
    return async (c, next) => {
      //非允许提交body数据的请求或DELETE请求但是没有提交body数据则直接跳过。
      let md = c.method[0];

      if ((md !== 'P' && md !== 'D') || (md === 'D' && !c.rawBody)) {
        return await next();
      }

      let ctype = c.headers['content-type'] || '';

      try {
        if (ctype.indexOf('text/json') === 0) {
          c.body = JSON.parse(c.body);
        } else if (ctype.indexOf('application/json') === 0) {
          c.body = JSON.parse(c.rawBody.toString('utf8'));
        }
      } catch (err) {
        return c.status(400).send('bad data: illegal json data.')
      }
      
      await next();
    }
  }
  

}

module.exports = parsebody;
