'use strict'

module.exports = function (m = 'long') {
  let t = new Date();
  let year = t.getFullYear();
  let month = t.getMonth()+1;
  let day = t.getDate();
  let hour = t.getHours();
  let min = t.getMinutes();
  let sec = t.getSeconds();

  let mt = `${year}-${month > 9 ? '' : '0'}${month}-${day > 9 ? '' : '0'}${day}`;

  if (m === 'short') {
    return mt;
  }

  let md = `${mt}_${hour > 9 ? '' : '0'}${hour}`;
  if (m === 'middle') {
    return md;
  }

  return `${md}-${min > 9 ? '' : '0'}${min}-${sec > 9 ? '' : '0'}${sec}`;
};
