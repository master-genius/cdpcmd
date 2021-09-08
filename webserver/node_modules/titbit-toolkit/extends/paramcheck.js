'use strict'

/**
 * 用于param或者query检测的中间件扩展，启用此扩展，会自动进行属性值的检测。
 * 支持声明式的设计，避免重复劳动。
 */

class paramcheck {

  constructor (options = {}) {
    this.type = ['query', 'param']

    this.key = 'param'

    this.data = {}

    for (let k in options) {
      switch (k) {
        case 'key':
          if (this.type.indexOf(options[k]) >= 0) {
            this.key = options[k]
          }
          break

        case 'data':
          if (typeof options[k] === 'object') {
            this.data = options[k]
          }
          break

      }
    }

  }

  /**
   * 
   * @param {object} obj c.param or c.query
   * @param {*} k key name
   * @param {*} rule filter rule
   * 
   * rule描述了如何进行数据的过滤，如果rule是字符串或数字则要求严格相等。
   * 否则rule应该是一个object，可以包括的属性如下：
   *    - callback  用于过滤的回调函数，在验证时，会传递数据，除此之外没有其他参数。
   *    - must     false|true，表示是不是必须，如果must为true，则表示数据不能是undefined。
   *    - default  默认值，如果存在，而参数属性未定义，则赋予默认值。
   *    - to       int|float 要转换成哪种类型。
   *    - min      最小值，可以 >= 此值，数字或字符串。
   *    - max      最大值，可以 <= 此值，数字或字符串。
   */
  checkData (obj, k, rule) {

    let typ = typeof rule

    if (typ === 'object') {
      if (obj[k] === undefined) {
        if (rule.must) {
          return false
        }
        
        if (rule.default !== undefined) {
          obj[k] = rule.default
          return true
        }

      } else {
        //数据初始必然是字符串，转换只能是整数或浮点数。
        if (rule.to) {
          if (isNaN(obj[k])) {
            return false
          }

          switch(rule.to) {
            case 'int':
              obj[k] = parseInt(obj[k])
              break

            case 'float':
              obj[k] = parseFloat(obj[k])
              break
          }
        }

        if (rule.min !== undefined && obj[k] < rule.min) {
          return false
        }

        if (rule.max !== undefined && obj[k] > rule.max) {
          return false
        }
      }

      //无论obj[k]是否存在，只要存在callback，就要执行。
      if (rule.callback && typeof rule.callback === 'function') {
        return (rule.callback(obj, k) === false) ? false : true
      }
      
    } else if (typ === 'string') {
      
      if (obj[k] === undefined || obj[k] !== rule) {
        return false
      }

    } else if (typ === 'number') {
      if (obj[k] === undefined || obj[k] != rule) {
        return false
      }
    }

    return true
  }

  dataFilter (c) {
    let d = c[this.key]

    if (this.data instanceof Array) {

      for (let i = 0; i < this.data.length; i++) {
        
        if (typeof this.data[i] !== 'object' || this.data[i].key === undefined) {
          continue
        }

        if (!this.checkData(d, this.data[i].key, this.data[i])) {
          return false
        }

      }

    } else {

      for (let k in this.data) {
        if (!this.checkData(d, k, this.data[k])) {
          return false
        }
      }

    }

    return true
  }

  mid () {

    let self = this

    return async (c, next) => {
      if (!self.dataFilter(c)) {
        c.send('bad data', 400)
        return
      }

      await next()
    }

  }

}

module.exports = paramcheck
