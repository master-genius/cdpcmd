'use strict'

let saltArr = [
  'a','b','c','d','e','f','g',
  'h','i','j','k','l','m','n',
  'o','p','q','r','s','t','u',
  'v','w','x','y','z','1','2',
  '3','4','5','6','7','8','9'
]

function randstring (length = 8) {

  let saltstr = ''
  let ind = 0

  for(let i = 0; i < length; i++) {
    ind = parseInt( Math.random() * saltArr.length)
    saltstr += saltArr[ ind ]
  }

  return saltstr
}

module.exports = randstring
