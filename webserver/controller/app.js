'use strict'

class app {

  constructor () {
    this.param = '/:name'
  }

  async get (c) {

  }

  /**
   * 
   * 添加新的应用，应用可以是已经存在于某一路径下的，或者是git仓库获取或者是上传。
   * 
   * @param {object} c 
   */

  async post (c) {

  }

  /**
   * 
   * 对应于应用的操作：restart、start、stop、pause、resume。
   * 
   * @param {object} c 
   */
  async put (c) {

  }

  async list (c) {

  }

  async delete (c) {

  }

}

module.exports = app
