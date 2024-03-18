'use strict';

/**
 * 
 * 通过挂载方法到files上，可以快速写入数据到文件
 * 
 */

class tofile {

  constructor () {

  }

  mid () {
    let self = this

    return async (c, next) => {
      if (!c.isUpload) {
        await next()
        return
      }

      c.getFile = (name, ind = 0) => {
        if (c.files[name] === undefined) {
          return null
        }

        if (ind >= c.files[name].length) {
          return null
        }

        let flist = c.files[name]

        if (ind < 0) {
          for (let i = 0; i < flist.length; i++) {
            if (flist[i].toFile === undefined) {
              flist[i].toFile = async (target, filename = null) => {
                if (filename === null) {
                  filename = c.helper.makeName(flist[i].filename)
                }
                await c.moveFile(flist[i], `${target}/${filename}`)
                return filename
              }
            }
          }
          return flist
        }

        if (flist[ind].toFile === undefined) {
          flist[ind].toFile = async (target, filename = null) => {

            if (filename === null) {
              filename = c.helper.makeName(flist[ind].filename)
            }

            await c.moveFile(flist[ind], `${target}/${filename}`)

            return filename
          }
        }

        return flist[ind]

      }

      await next()

    }

  }

}

module.exports = tofile
