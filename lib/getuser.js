'use strict'

const fs = require('fs')

function parseLines(userfile) {
  let data = fs.readFileSync(userfile, {encoding: 'utf8'})

  return data.split('\n').filter(p => p.length > 0).map(a => { return a.split(':') })
}

module.exports = {
  getUserByUID: function (uid, userfile='/etc/passwd') {
    let dlines = parseLines(userfile)
    for (let d of dlines) {
      if (parseInt(d[2]) === uid) return d[0]
    }
  },

  getUserTable: function (userfile = '/etc/passwd') {
    let dlines = parseLines(userfile)
    let utable = {}
    let idtable = {}
    for (let d of dlines) {
      idtable[d[2]] = utable[d[0]] = {
        user: d[0],
        home: d[d.length - 2],
        shell: d[d.length - 1],
        uid: parseInt(d[2]),
        gid: parseInt(d[3])
      }
    }

    return {
      nametable: utable,
      idtable: idtable
    }
  },

  getUser: function parseuser(username, userfile = '/etc/passwd') {
    try {
      let dlines = parseLines(userfile)

      for (let d of dlines) {
        if (d[0] === username) {
          return {
            user: d[0],
            home: d[d.length - 2],
            shell: d[d.length - 1],
            uid: parseInt(d[2]),
            gid: parseInt(d[3])
          }
        }
      }
      
    } catch (err) {
      return null
    }

  }
}