'use strict'

const fs = require('fs')

module.exports = function parseuser (username, userfile = '/etc/passwd') {
  try {
    let data = fs.readFileSync(userfile, {encoding: 'utf8'})

    let dlines = data.split('\n')
                    .filter(p => p.length > 0)
                    .map(a => {
                      return a.split(':')
                    });

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
