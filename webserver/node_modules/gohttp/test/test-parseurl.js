const gohttp = require('../gohttp')

let urlarr = []

for (let i = 0; i < 100000; i++) {
  urlarr.push(`https://w3xm.cn:2022/rich/money/12000000000/success?name=wangyong&name=wangkai&ok=success&rand=${i*i}`)
}

let parseList = []

let start_time = Date.now()

for (let i = 0; i < urlarr.length; i++) {
  parseList.push(gohttp.parseUrl(urlarr[i]))
}

let end_time = Date.now()

console.log(`${end_time - start_time} ms`)
