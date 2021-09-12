const {proxy} = require('../index')

const dp = new proxy({
  host : {
    'a.com' : [
      {
        path: '/xyz',
        url : 'http://localhost:2021'
      },
      {
        path : '/abc',
        url : 'http://localhost:1234',
        timeout : 12000
      }
    ]
  }
})

console.log(dp.hostProxy)

for (let k in dp.hostProxy) {
  for (let p in dp.hostProxy[k]) {
    console.log(k,p,dp.hostProxy[k][p].urlobj)
  }
}
