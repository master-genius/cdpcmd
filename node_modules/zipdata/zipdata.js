'use strict'

const zlib = require('zlib')
const fs = require('fs')

const fsp = fs.promises

let zipdata = async (pathfile, isData=false) => {

  let d

  if (isData) {
    d = pathfile
  } else {
    d = await fsp.readFile(pathfile)
  }

  return await new Promise((rv, rj) => {
      zlib.gzip(d, (err, zipdata) => {
        if (err) {
          rj (err)
        }

        rv(zipdata)
      })
  })
}

zipdata.unzip = async (pathfile, isData = false) => {
  let d
  if (isData) {
    d = pathfile
  } else {
    d = await fsp.readFile(pathfile)
  }

  return new Promise((rv, rj) => {
    zlib.unzip(d, (err, data) => {
      if (err) rj(err)

      rv(data)
    })
  })
}

module.exports = zipdata

