const gohttp = require('../gohttp.js');

let hcli = new gohttp()

let h = hcli.connect('https://localhost:2021/api')

h.setHeader('x-ok', 'rich')
.setHeader({
  'access-token': 'df023rsdfhlk'
})

for(let i=0; i<10; i++) {
    h.get({
        path: '/test',
        timeout:5000,
        family: 4,
        query: {name: 'ty'}
      })
    .then(res => {
        console.log(res.text());
    }, err => {
        throw err; 
    })
    .catch(err => {
        console.log(err);
    });

    h.post({
        path : '/test',
        body : {user : 'brave'},
        family: 6,
        query: {key: 12309}
    })
    .then(res => {
        console.log(res.text());
    }, err => {
        throw err;
    })
    .catch(err => {
        console.log(err);
    });
}
