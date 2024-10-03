'use strict'

/**********************************************************************
提示：
  表单提交或异步请求发送的数据，对应于POST或PUT请求：
    提交的请求体数据通过 ctx.body 获取。

  路由参数通过 ctx.param 获取，示例：let id = ctx.param.id

  url参数(?a=1&b=2)通过 ctx.query 获取，示例：let name = ctx.query.name

  使用ctx.getFile(name)获取上传的文件，示例：let f = ctx.getFile('image')
**********************************************************************/

class app {

  constructor() {
    //this.param = '/:id'
  }

  async init(service) {
    
  }

  /**
   * 获取资源具体内容
   * @param {context} ctx
   * @returns 
   */
  async get(ctx) {

  }

  /**
   * 创建资源
   * @param {context} ctx
   * @returns 
   */
  async post(ctx) {

  }

  /**
   * 更新资源
   * @param {context} ctx
   * @returns 
   */
  async put(ctx) {

  }

  /**
   * GET请求，用于获取资源列表
   * @param {context} ctx
   * @returns 
   */
  async list(ctx) {

  }

  /**
   * 删除资源
   * @param {context} ctx
   * @returns 
   */
  async _delete(ctx) {

  }
}

module.exports = app

//！！注意：以下注释是为了能够在支持jsdoc的代码编辑器中提示以及方便查阅提供，不需要可以去掉。
/**
 * ---------------------- ctx.ext模块具备的方法 -----------------------------
 *
 * @typedef {object} ext
 *   @property {function} extName(filename: string) - 解析文件扩展名。
 *   @property {function} makeName(filename: string) - 生成唯一文件名，默认为时间字符串+随机数：2021-01-01_12-12-23_27789.jpg，filename主要用于获取扩展名。
 *   @property {function} nrand(n, m) - 返回两个数之间的随机数。
 *   @property {function} uuid() - 返回唯一字符串用于唯一ID，支持标准的8-4-4-4-12和短字符串8-2-2-4两种模式（传递参数为true）。
 *   @property {function} timestr() - 默认返回年-月-日_时-分-秒，没有空格，方便保存和解析。
 *   @property {function} sha1(text, encoding = 'hex')
 *   @property {function} sha256(text, encoding = 'hex') 
 *   @property {function} sha512(text, encoding = 'hex')
 *   @property {function} sm3(text, encoding = 'hex')
 *   @property {function} hmacsha1(text, key, encoding = 'hex')
 *   @property {function} pipe(filename: string, reply: object)
 *  
 * 更多参考：{@link https://gitee.com/daoio/titbit/wikis/helper-function}
 */
/**
 * --------------------------------- 请求上下文 -----------------------------------------
 *
 * @typedef {object} context
 * @property {string} version - 协议版本，字符串类型，为'1.1' 或 '2' 或 '3'。
 * @property {number} major - 协议主要版本号，1、2、3分别表示HTTP/1.1 HTTP/2 HTTP/3。
 * @property {string} method - 请求类型，GET POST等HTTP请求类型，大写字母的字符串。
 * @property {string} path - 具体请求的路径，比如 /x/y。
 * @property {string} routepath - 实际执行请求的路由字符串，比如 /x/:id。
 * @property {boolean} isUpload - 是否为上传文件请求，此时就是检测消息头content-type是否为multipart/form-data格式。
 * @property {object} box - 默认为空对象，可以添加任何属性值，用来动态传递给下一层组件需要使用的信息。
 * @property {object} query - url传递的参数。
 * @property {object} param - 路由参数。
 * @property {object} headers - 指向request.headers。
 * @property {object} files - 上传文件保存的信息。
 * @property {(object|string|buffer|null)} body - body请求体的数据，具体格式需要看content-type，一般为字符串或者对象，也可能是buffer。
 * @property {object} request HTTP/1.1 - 就是http模块request事件的参数IncomingMessage对象，HTTP/2 指向stream对象。
 * @property {object} reply - HTTP/1.1协议，指向response，HTTP/2 指向stream。
 * @property {object} service - 用于依赖注入的对象，指向app.service。
 * @property {function} moveFile(file: object) - 用来移动上传的文件到指定路径，file是通过getFile获取的文件对象。
 * @property {function} getFile(name: string, index = 0) - 根据上传名获取上传的文件，如果index是-1表示获取整个数组。
 * @property {function} sendHeader() - 发送消息头，针对http/2设计，http/1.1只是一个空函数，为了代码保持一致。
 * @property {function} setHeader(key: string, value: string|array)
 * @property {function} send(body: string|object|buffer) - 设置要返回的body数据。
 * @property {function} status(code: null | number) - 设置状态码，默认为null表示返回状态码。
 * @property {ext} ext - 指向ext模块，提供了一些助手函数，具体参考wiki。
 * 
 * 更多参考：{@link https://gitee.com/daoio/titbit/blob/master/README.md#%E8%AF%B7%E6%B1%82%E4%B8%8A%E4%B8%8B%E6%96%87}
 */
