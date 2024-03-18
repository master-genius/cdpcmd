'use strict'

/**
 * 用于param或者query检测的中间件扩展，启用此扩展，会自动进行属性值的检测。
 * 支持声明式的设计，避免重复劳动。
 */

let TYPE_STRING = 1
let TYPE_NUMBER = 2

class paramcheck {

  constructor (options = {}) {
    this.type = ['query', 'param', 'body']
    this.key = 'param'
    this.data = {}
    this.errorMessage = "提交数据不符合要求"
    //设置禁止提交的字段
    this.deny = null
    this.denyMessage = '存在禁止提交的数据'
    this.deleteDeny = false

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

        case 'errorMessage':
          this[k] = options[k]
          break

        case 'deny':
          if (typeof options[k] === 'string') {
            options[k] = [options[k]]
          }
          if (Array.isArray(options[k])) {
            this.deny = options[k]
          }
          break

        case 'deleteDeny':
          this.deleteDeny = !!options[k]
          break

        default: 
          this[k] = options[k]
      }
    }

    let data_type = ''
    for (let k in this.data) {
      data_type = typeof this.data[k]

      if (data_type === 'string' || data_type === 'number') {
        this.data[k] = {
          __is_value__: true,
          __value__: this.data[k],
          __type__: data_type === 'string' ? TYPE_STRING : TYPE_NUMBER
        }

        continue
      }

      this.data[k].__is_value__ = false

      if (this.data[k].callback && typeof this.data[k].callback === 'function') {
        this.data[k].__is_call__ = true
      } else {
        this.data[k].__is_call__ = false
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
  checkData (obj, k, rule, method, ost) {
    let typ = typeof rule

    ost.ok = true
    ost.key = k

    if (!rule.__is_value__) {
        if (obj[k] === undefined) {
          if (rule.must) {
            ost.ok = false
            return false
          }
          
          if (rule.default !== undefined) {
            obj[k] = rule.default
            return true
          }

        } else {
          //数据初始必然是字符串，转换只能是整数或浮点数或boolean。
          if (rule.to) {
            if (isNaN(obj[k])) {
              ost.ok = false
              return false
            }

            switch(rule.to) {
              case 'int':
                obj[k] = parseInt(obj[k])
                break

              case 'float':
                obj[k] = parseFloat(obj[k])
                break
              
              case 'boolean':
              case 'bool':
                obj[k] = obj[k] === 'true' ? true : false
                break
            }
          }

          if (rule.min !== undefined && obj[k] < rule.min) {
            ost.ok = false
            return false
          }

          if (rule.max !== undefined && obj[k] > rule.max) {
            ost.ok = false
            return false
          }
        }

        //无论obj[k]是否存在，只要存在callback，就要执行。
        if (rule.__is_call__) {
          if (rule.callback(obj, k, method) !== false) {
            return true
          }
          ost.ok = false
          return false
        }
      
    } else if (rule.__type__ === TYPE_STRING) {
      if (obj[k] === undefined || obj[k] !== rule.__value__) {
        ost.ok = false
        return false
      }
    } else if (rule.__type__ === TYPE_NUMBER) {
      if (obj[k] === undefined || obj[k] != rule.__value__) {
        ost.ok = false
        return false
      }
    }

    return true
  }

  dataFilter (c) {
    let d = c[this.key]
    let ost = {ok: true, key: ''}

    if (this.key !== 'body' || (c.body !== c.rawBody && typeof c.body === 'object')) {
      for (let k in this.data) {
        if (!this.checkData(d, k, this.data[k], c.method, ost)) {
          return ost
        }
      }
    }

    return ost
  }

  mid () {
    let self = this
    let dataObject = this.data

    if (!Array.isArray(this.deny) || this.deny.length === 0) this.deny = null

    if (this.deny) {
      if (this.deleteDeny) {
        return async (c, next) => {

          if (self.key !== 'body' || (c.body !== c.rawBody && typeof c.body === 'object')) {
            let obj = c[self.key]

            for (let k of self.deny) {
              if (obj[k] !== undefined) delete obj[k]
            }
          }

          let r = self.dataFilter(c)
          if (!r.ok) {
            return c.status(400).send(dataObject[r.key].errorMessage || self.errorMessage)
          }

          await next()
        }

      }

      return async (c, next) => {
        if (self.key !== 'body' || (c.body !== c.rawBody && typeof c.body === 'object')) {
          let obj = c[self.key]

          for (let k of self.deny) {
            if (obj[k] !== undefined) return c.status(400).send(self.denyMessage)
          }
        }

        let r = self.dataFilter(c)
        if (!r.ok) {
          return c.status(400).send(dataObject[r.key].errorMessage || self.errorMessage)
        }

        await next()
      }
      
    }

    return async (c, next) => {
      let r = self.dataFilter(c)
      if (!r.ok) {
        return c.status(400).send(dataObject[r.key].errorMessage || self.errorMessage)
      }

      await next()
    }
  }

}

module.exports = paramcheck
