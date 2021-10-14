
![](images/gohttp.png)

# gohttp

针对HTTP/1.1和HTTP/2封装的客户端请求库，从4.0版本开始，支持HTTP/2，之前的版本只支持http1。除了客户端请求，也提供了一个基于http2连接池的反向代理。

基于Promise实现，可以通过then接收返回结果，或者配合async/await使用。

## 安装

```
npm i gohttp
```

**以下是3.x版本的http1请求过程，从4.0开始，接口不变，但是导出方式发生了变化。因为包含http1和http2的客户端请求，这两个协议在不使用ALPN支持，并且没有兼容接口的时候，是无法自动适应的。这里给出的封装就是基于http/https模块封装了HTTP/1.1的请求，基于http2模块封装了HTTP/2的请求。**

## HTTP/1.1协议的请求

> 从4.0开始，导出方式：
> **const {httpcli} = require('gohttp')**

> 接口使用方式不变

### GET请求

``` JavaScript

const {httpcli} = require('gohttp');

httpcli.get('http://localhost:2020/')
        .then(res => {
            console.log(res.headers, res.status);
            return res.text();
        })
        .then(result => {
            console.log(result);
        });

```

### POST请求

``` JavaScript

const {httpcli} = require('gohttp');

httpcli.post('http://localhost:2020/p', {
            body : {
                user: 'wang'
            }
        })
        .then(res => {
            return res.text();
        })
        .then(result => {
            console.log(result);
        });

```

### PUT请求

``` Javascript
const {httpcli} = require('gohttp');

httpcli.put('http://localhost:2020/p', {
            body : {
                user: 'wang'
            }
        })
        .then(res => {
            return res.text();
        })
        .then(result => {
            console.log(result);
        });
```

### DELETE请求

``` JavaScript

const {httpcli} = require('gohttp');

httpcli.delete('http://localhost:2020/p/123')
        .then(res => {
            return res.text();
        })
        .then(result => {
            console.log(result);
        });

```


### 上传文件

``` JavaScript

const {httpcli} = require('gohttp');

httpcli.upload('http://localhost:2020/upload', {
            files: {
                image: [
                    'pictures/a.jpg',
                    'pictures/b.png'
                ],
                video: [
                    'videos/a.mp4',
                    'videos/b.mp4'
                ]
            },
            //要携带表单数据需要form选项
            //form : {}
        })
        .then(res => {
            return res.text();
        })
        .then(result => {
            console.log(result);
        });

```

### 简单上传

基于httpcli.upload封装的up函数参数更加简单：

``` JavaScript

httpcli.up('http://localhost:1234/upload', {
    name : 'image'
    file : 'images/123.jpg'
}).then(res => {
    return res.text();
}).then(d => {
    console.log(d);
});

```

### 下载文件

``` JavaScript

const {httpcli} = require('gohttp');

httpcli.download('https://localhost:2021/download', {
  dir: process.env.HOME + '/download/',
  //输出进度提示
  progress: true
}).then(d => {
    console.log(d || '');
}).catch(err => {
    console.error(err);
});

```

## 请求返回值（res）

请求的返回值包括以下属性：

**ok**
true或false，表示请求是否成功。

**status**
状态码，若是请求连接都没有成功则为0。

**error**
初始值为null，若是出错则为具体的Error实例。

**headers**
响应头信息。

**timeout**
初始值为false，若是为true则表示请求超时。

**blob**
函数，返回响应数据的原始Buffer。

**text**
函数，以字符串的形式返回响应数据。

**json**
函数，以JS对象的形式返回响应数据。就是对text返回的值做一次JSON.parse。

**length**
返回数据的总长度，单位是字节。

> **HTTP/2客户端返回的res也包括这些属性。**


## HTTP/2 请求

### 连接

```javascript

const {http2cli} = require('gohttp')

//返回值是包装了http2Session实例的一个对象，并提供了常用请求和request方法。
hsession = http2cli.connect('http://localhost:1234')


```

### 连接选项

```javascript

const {http2cli} = require('gohttp')

//返回值是包装了http2Session实例的一个对象，并提供了常用请求和request方法。
let hsession = http2cli.connect('http://localhost:1234', {
    //请求空闲10秒则超时。
    timeout: 10000,
    //此时，断开连接会自动重新连接。
    keepalive: true
})


```

### 连接池

```javascript

const {http2cli} = require('gohttp')

//此时连接选项keepalive自动被设置为true。
let hs = http2cli.connectPool('http://localhost:1234', {
    //最大连接数量
    max: 5
})

//hs能使用的接口和connect返回的hsession一致。
//自动从连接池选择一个进行请求。
hs.get({
    path : '/'
})
.then(res => {
    console.log(res.text())
})

```

### 请求

```javascript

const {http2cli} = require('gohttp')

let hs = http2cli.connect('http://localhost:1234')

//针对GET、POST、DELETE、PUT、OPTIONS提供了快速调用的同名小写方法。
//本质上都是调用了request。

hs.get({
    path : '/test',
})
.then(ret => {
    //ret是包含了headers, ok, status, error, data, text, json, blob属性的对象。
    console.log(ret.headers, ret.text())
})

//如果body是
hs.post({
    path : '/data',
    body : {
        name : 'Wang',
        id : '1001'
    }
})
.then(ret => {
    console.log(ret.headers, ret.text())
})

hs.request({
    method : 'PUT',
    path : '/content',
    headers : {
        'content-type' : 'text/plain'
    },
    body : {
        id : '1001',
        nickname : 'unix-great'
    }
})
.then(ret => {
    console.log(ret.headers, ret.text())
})

```

### 上传文件

```javascript

const {http2cli} = require('gohttp')

//返回值是包装了http2Session实例的一个对象，并提供了常用请求和request方法。
let hs = http2cli.connect('http://localhost:1234', {
    //此时，断开连接会自动重新连接。
    keepalive: true
})

hs.upload({
    path : '/upload',
    files : {
        //键值 即为 上传名
      image : [
        process.env.HOME + '/tmp/images/123.jpg',
        process.env.HOME + '/tmp/images/space2.jpg',
      ],
      video : [
          process.env.HOME + '/tmp/images/a.mp4',
      ]
    },
    //可以使用form携带其他表单项
    form : {
        id : '1001'
    }
})
.then(ret => {
    console.log(ret.error)
    console.log(ret.status, ret.text())
})

```

### 简易上传

简易上传仅支持单个上传名，是对upload的封装。

```javascript

const {http2cli} = require('gohttp')

//返回值是包装了http2Session实例的一个对象，并提供了常用请求和request方法。
let hs = http2cli.connect('http://localhost:1234')

hs.up({
    path : '/upload',
    name : 'image',
    file : [
        process.env.HOME + '/tmp/images/123.jpg',
        process.env.HOME + '/tmp/images/space2.jpg',
    ]
})
.then(ret => {
    console.log(ret.error)
    console.log(ret.status, ret.text())
})

```

### 持久连接

使用http2作为持久连接，一个连接可以发送多个请求，可以使用HTTP/2协议作为查询服务，基于协议的强大特性，可以完成比较复杂的功能。并且方便实现RPC，这方面其实已经有先例。HTTP/2协议本身并不要求一定要使用HTTPS，但是浏览器在实现上，要求必须启用HTTPS。在Node.js中，使用http2可以不启用https完成通信，在内网通信时，可以处理更快。

### close 和 destroy

提供了close和destroy接口，不过没有参数，就是在内部调用了http2Session的close和destroy。

### 完整选项

| 选项 | 说明 |
|----|----|
| debug | 调式模式，true或false，开启会输出错误信息。 |
| keepalive | 是否保持连接，开启后，断开会自动重连。 |
| max | 使用connectPool指定最大多少个连接。 |
| reconnDelay | 重连延迟，毫秒值，默认为500毫秒。 |


----

## 反向代理

基于对http2的封装以及连接池的处理，实现了基于http2连接池模式的反向代理。这可能是目前唯一一个支持HTTP/2协议以及连接池和自动重连并且支持负载均衡的反向代理。

使用示例：

```javascript

'use strict'

const {http2proxy} = require('gohttp')
const titbit = require('titbit')

const app = new titbit({
  debug: true,
  http2: true,
  //这里应该换成你自己的证书和密钥文件路径
  key : './rsa/localhost.key',
  cert : './rsa/localhost.cert'
})

let hxy = new http2proxy({
  config: {
    'a.com' : [
      {
        url: 'http://localhost:2022',
        weight: 10,
        path : '/',
        reconnDelay: 5000,
        //请求后端服务时，附加的头部信息。
        headers : {
          'x-test-key' : `${Date.now()}-${Math.random()}`
        }
      },
      {
        url: 'http://localhost:2023',
        weight: 5,
        path : '/',
        reconnDelay: 1000
      }
    ]
  },
  //调式模式输出错误信息。
  debug: true
})

hxy.init(app)

app.run(1234)

```

配置中，host对应的数组中每一项元素都对应一个后端服务，相同的path存在多个就表示自然地启用负载均衡功能。

对应后端服务：

```javascript
'use strict'

const titbit = require('titbit')

/**
 * 基于Node.js实现的http2服务端和客户端请求可以不使用https模式。
*/

const app = new titbit({
  debug: true,
  http2: true,
  loadInfoFile: '/tmp/loadinfo.log',
  globalLog: true,
  monitorTimeSlice: 512,
  timeout: 0
})

app.use(async (c, next) => {
  c.setHeader('x-set-key', `${Math.random()}|${Date.now()}`)
  await next()
})

app.get('/header', async c => {
  c.send(c.headers)
})

app.get('/', async c => {
  c.send(Math.random())
})

app.get('/:name/:age/:mobile/:info', async c => {
  c.send(c.param)
})

app.post('/p', async c => {
  c.send(c.body)
})

let port = 2022
let port_ind = process.argv.indexOf('--port')

if (port_ind > 0 && port_ind < process.argv.length - 1) {
  port = parseInt(process.argv[port_ind + 1])

  if (typeof port !== 'number') port = 2022
}

app.run(port)

```
