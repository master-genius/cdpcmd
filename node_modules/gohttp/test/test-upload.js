const hcli = require('../gohttp');

hcli.upload('https://localhost:2021/upload', {
    method: 'PUT',
    files : {
        file : [
            //'/home/wy/c/a.c',
            //'/home/wy/c/daet.c',

            '/home/wy/music/common/a.flac',
            '/home/wy/music/common/b.flac'
        ]
    }
}).then(res => {
    console.log(res.text());
}, err => {
    console.log(err);
});
