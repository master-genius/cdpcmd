const hcli = require('../gohttp.js');

for(let i=0; i<1000; i++) {
    hcli.get('https://localhost:2021/test',{timeout:1500})
    .then(res => {
        console.log(res.text());
    }, err => {
        throw err; 
    })
    .catch(err => {
        console.log(err);
    });

    hcli.post('https://localhost:2021/test', {
        body : {user : 'brave'}
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
