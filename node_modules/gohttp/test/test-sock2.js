
const hcli = require('../httpcli.js');

hcli.get({socketPath:'/tmp/http.sock'}).then(d => {
  console.log(d.toString());
});

hcli.upload({socketPath:'/tmp/http.sock'}, {
  headers : {
    'content-type' : 'text/plain'
  },
  body : {
    form : {
      a : 123,
      b : 345
    },
    files : {
      file : [
        process.env.HOME + '/c/daet.c',
        process.env.HOME + '/c/sigtest.c'
      ]
    }
  },
}).then(d => {
  console.log(d.toString());
})

