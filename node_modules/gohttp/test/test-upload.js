const hcli = require('../gohttp');

hcli.upload('https://localhost:2021/upload', {
    method: 'PUT',
    files : {
        file : [
            //'/home/wy/c/a.c',
            //'/home/wy/c/daet.c',

            '/home/wy/music/common/关山酒-炎雪.flac',
            '/home/wy/music/common/来去无意 - 任然.flac'
        ]
    }
}).then(res => {
    console.log(res.text());
}, err => {
    console.log(err);
});
