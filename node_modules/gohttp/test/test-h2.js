'use strict'

const hiio = require('../hiio')

let hii = new hiio()

let h = hii.connect('https://localhost:2021/api', {
  headers: {
    'authorization': 'sdfh2934u0hsdafkhj'
  }
})

//h.prefix = ''
h.setHeader({
  'access-token': 'sdkfh93hr98ikhddsf',
  'x-key': '2139078'
})
.setHeader('x-ok', 'rich')

for (let i = 0; i < 10; i++) {
  h.get({
    path: '/test',
    query: {n: 234}
  })
  .then(ret => {
      console.log(ret.ok, ret.status, ret.text())
  })
  .catch (err => { console.error(err) })
  
  h.post({
    path: '/test?x=3244',
    body: {name: 'rich', key: 12309012839990},
    query: 'y=123'
  })
  .then(ret => {
    console.log(ret.ok, ret.status, ret.text())
  })
  .catch (err => { console.error(err) })
}

setTimeout(() => {
  h.close()
}, 5000);

