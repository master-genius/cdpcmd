'use strict'

module.exports = function (obj) {
  let qstr = [];

  for (let k in obj) {
    qstr.push(`${k}=${encodeURIComponent(obj[k])}`);
  }

  return qstr.join('&');

};
