'use strict';

const fs = require('node:fs')
const crypto = require('node:crypto')

function extName(fname) {
  let ind = fname.length - 2

  while (ind > 0 && fname[ind] !== '.') {
    ind -= 1
  }

  if (ind <= 0) return ''

  return fname.substring(ind)
}

let fmtbits = (n) => {
  return n < 10 ? `0${n}` : n
}

function makeName(filename = '') {
  let tm = new Date()

  let orgname = `${tm.getFullYear()}-${fmtbits(tm.getMonth()+1)}-${fmtbits(tm.getDate())}_`
      + `${fmtbits(tm.getHours())}-${fmtbits(tm.getMinutes())}-${fmtbits(tm.getSeconds())}`
      + `_${tm.getMilliseconds()}${parseInt(Math.random() * 1000) + 1}${parseInt(Math.random() * 100000) + 10000}`

  if (filename) return (orgname + extName(filename))

  return orgname
}

async function moveFile(target, filename = null) {
  if (!this || !this.rawBody) return false

  if (!filename) filename = makeName(this.filename || '')
  
  let ds = ''
  if (target[target.length-1] !== '/') ds = '/'

  let pathfile = `${target}${ds}${filename}`

  let fd = await new Promise((rv, rj) => {
      fs.open(pathfile, 'w+', 0o644, (err, fd) => {
        if (err) {
          rj(err)
        } else {
          rv(fd)
        }
      })
  })

  return new Promise((rv, rj) => {
    fs.write(fd, this.rawBody, this.start, this.length,
      (err, bytesWritten, buffer) => {
        if (err) {
          rj(err)
        } else {
          rv(filename)
        }
      })
  })
  .finally(() => {
    fs.close(fd, (err) => {})
  })

}

function getFile(name, ind=0) {
  if (!this || !this.files) return null

  if (this.files[name] === undefined) {
    return ind < 0 ? [] : null
  }

  if (ind >= this.files[name].length) {
    return null
  }

  let flist = this.files[name]

  if (ind < 0) {
    for (let i = 0; i < flist.length; i++) {
      if (flist[i].toFile === undefined) {
        flist[i].rawBody = this.rawBody
        flist[i].toFile = moveFile
      }
    }
    return flist
  }

  if (flist[ind].toFile === undefined) {
    flist[ind].rawBody = this.rawBody
    flist[ind].toFile = moveFile
  }

  return flist[ind]
}


class ToFile {

  constructor() {

  }

  mid() {
    let self = this
    return async (c, next) => {
      if (!c.isUpload) {
        return await next()
      }

      c.getFile = getFile
      await next()
    }

  }

}

module.exports = ToFile
