const hcli = require('../gohttp');

hcli.up('https://localhost:2021/upload', {
    file : [
        '/home/wy/music/common/关山酒-炎雪.flac',
        '/home/wy/music/common/来去无意 - 任然.flac'
    ],
    name : 'file',
    method: 'PUT'
}).then(res => {
    console.log(res.text());
}, err => {
    console.log(err);
});
