'use strict'

module.exports = function parseName(name) {
 let ind = name.indexOf(':')
 if (ind > 0) {
   return [
     name.substring(0, ind),
     name.substring(ind+1)
   ]
 }

 return [
   '',
   name
 ]
}
