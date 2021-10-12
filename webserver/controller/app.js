'use strict'

class app {

  constructor () {
    this.param = '/:name'
  }

  async get (c) {

  }

  /**
   * 
   * 添加新的应用，应用可以是git仓库获取或者是上传。
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

  /**
   * 获取应用列表。
   */
  async list (c) {

  }

  //对应于应用的remove、safeRemove操作。

  async delete (c) {

  }

}

module.exports = app
