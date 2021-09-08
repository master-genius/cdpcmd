
const hcli = require('../httpcli.js');

hcli.get('unix:///tmp/http.sock').then(d => {
  console.log(d.toString());
});

hcli.post('unix:///tmp/http.sock', {
  headers : {
    'content-type' : 'text/plain'
  },
  body : {
    a : 123,
    b : 345
  }
}).then(d => {
  console.log(d.toString());
})

