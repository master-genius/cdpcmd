'use strict';

const fs = require('fs')

let files = fs.readdirSync(`${__dirname}/extends/`, {withFileTypes: true})

for (let i = 0; i < files.length; i++) {

  if (! files[i].isFile()) continue

  if (files[i].name.indexOf('.js') < 0) continue

  if (files[i].name.substring(files[i].name.length - 3) !== '.js') continue

  if (files[i].name[0] === '_' || files[i].name[0] === '!') continue

  let modname = files[i].name.substring(0, files[i].name.length-3)

  exports[modname] = require('./extends/'+files[i].name)

}
