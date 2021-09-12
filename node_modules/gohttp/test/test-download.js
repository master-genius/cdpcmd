const gohttp = require('../httpcli');

gohttp.download('https://localhost:2021/download', {
  dir: process.env.HOME + '/download/'
}).then(d => {
    console.log(d || '');
}).catch(err => {
    console.log(err);
});
