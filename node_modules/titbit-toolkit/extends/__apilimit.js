class apilimit {

  /**
   * 
   */
  constructor (options = {}) {

    this.cacheCount = 0;

    //最大缓存数量，已经存在的需要有过期删除。
    this.maxCache = 50000;

    //this.apicache = {};
    //使用map可以有更好的性能。
    this.apicache = new Map();

    this.maxLimit = 28;

    this.allow = [
      //允许调用的api路径
    ];

    this.allowLimit = 100;

    //单位时间，毫秒单位。
    this.peerTime = 56000;

    //一天内可以调用接口次数
    this.dayLimit = 0;

    //一天按照12小时计算。
    this.dayExpires = 43200000;

    this.tooManyRequest = '请求过于频繁';

    if (typeof options !== 'object') {
      options = {};
    }

    for (let k in options) {
      switch(k) {

        case 'allow':
          if (typeof options[k] === 'string') {
            options[k] = options[k].split(',').filter(p => p.length > 0);
          }

          if (options[k] instanceof Array) {
            this.allow = options[k];
          }
          break;

        case 'peerTime':
        case 'maxLimit':
        case 'dayLimit':
        case 'dayExpires':
        case 'allowLimit':
          if (typeof options[k] === 'number' && options[k] >= 0) {
            this[k] = options[k];
          }
          break;
        
        case 'tooManyRequest':
          this.tooManyRequest = options[k];
          break;

      }
    }

    //this.allowLimit += this.maxLimit;

    //允许调用的API最大计数。
    this.allowCount = this.allowLimit + 1;
    this.dayCount = this.dayLimit + 1;
    this.maxCount = this.maxLimit + 1;

    this.liveTime = this.peerTime * 100;

    this.ind = 0;

    this.clearMaxCount = 500;

  }

  mid () {
    let self = this;
    /** 
     * 请求限制依赖于用户体系，也就是说，需要先进行用户验证，然后把用户信息挂载到c.box.user。
     * 过期删除策略：
     * 
    */
    return async (c, next) => {

      let id = c.box.user.id;
      let tm = Date.now();

      let m = self.apicache.get(id);

      if (m === undefined) {
        
        if (self.apicache.size >= self.maxCache) {
          
          self.ind = 0;

          for (let [k, v] of self.apicache) {
            this.ind += 1;
            if (self.ind > self.clearMaxCount) {
              break;
            }
            self.apicache.delete(k);
          }

        }

        self.apicache.set(id, {
          daystart : tm,
          daycount: 1,
          time : tm,
          count : 1,
          startTime: tm
        });

        await next();

        return;
      }

      if (self.dayLimit > 0) {
        if (tm - m.daystart > self.dayExpires) {
          m.daystart = tm;
          m.daycount = 1;
        } else if (m.daycount < self.dayCount) {
          m.daycount += 1;
        }
      }
  
      if (self.maxLimit > 0) {
        if (tm - m.time > self.peerTime) {
          m.time = tm;
          m.count = 1;
        } else if (m.count < self.allowCount) {
          m.count += 1;
        }
      }

      //allow不进行每天限制，只有最大调用频率限制。
      if (self.allow.indexOf(c.routepath) >= 0 && m.count <= self.allowLimit) {
        await next();
        return;
      }
  
      //不在允许的api之内或者超出了api调用的最大限制则不会执行下一层。
      if (m.daycount > self.dayLimit || m.count > self.maxLimit) {
        c.status(429);
        c.res.body = self.tooManyRequest;
        return ;
      }
  
      await next();

    };//end middleware

  }


}

module.exports = apilimit;
