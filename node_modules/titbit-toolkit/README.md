# titbit框架工具集

主要包括：跨域、静态资源处理、反向代理、解析代理模式真实IP、计时统计测试、cookie、session、参数自动检测、可读流返回文件数据等。

目前所有扩展组件都是中间件形式，初始化后运行mid()返回中间件，所以通用的使用形式如下：

``` JavaScript

let t = new timing()
app.use( t.mid() )

```

**从titbit-v22.2.1开始，支持加载具有mid属性或者middleware属性作为中间件，要求：**

- mid是一个普通函数，运行此函数要返回一个真正的中间件函数。

- middleware则应该是一个完整的中间件函数，会自动进行this绑定（箭头函数无法绑定this）。

**titbit会先检测mid属性，不满足条件才会检测middleware，但是如果mid的返回值不满足条件会抛出错误。**

所以从titbit-v22.2.1之后，可以直接使用以下方式加载：

```javascript

const titbit = require('titbit')
const {pipe} = require('titbit-toolkit')

const app = new titbit()

app.use( new pipe() )

```

一些扩展因为要做的工作比较多，会提供init方法，这时候，通常是以这样的方式启用扩展：

```javascript

//t是扩展模块的实例。
t.init(app)

```

这种方式要看具体扩展的文档描述。


## 导出示例

``` JavaScript
const {timing,resource,tofile} = require('titbit-toolkit')
```

## timing(耗时统计)

计时中间件，默认会计算GET、POST、PUT、DELETE请求类型的耗时，并在test选项为true时，输出每个请求的平均耗时和当前时间消耗。主要用于测试和统计。

## cookie和session

这两个扩展是为了测试和教学使用而设计的，cookie组件运行后会在请求上下文中添加cookie属性是一个对象保存了cookie值。session基于cookie实现，利用文件保存数据，**但是这两个扩展不建议用在生产环境**，你应该使用更好的方案来进行会话处理，比如自己生成token或者是利用jwt。

使用：

``` JavaScript

let ck = new cookie()

app.use( ck.mid() )

let sess = new session()

app.use( sess.mid() )


```

## resource(静态资源处理)

静态资源处理，主要用于js、css、图片、音频、短视频的处理，最主要的还是用于站点的js、css、图片等数据量不大的静态资源。

对于大视频来说，需要分片处理，会比较麻烦。

使用：

``` JavaScript

let st = new resource({
    //设定静态资源所在目录
    staticPath: './public'
})

//只对分组为static执行中间件。
app.use(st, {group: 'static'})

//添加静态资源路由
app.get('/static/*', async c => {

    //请求分组为static
}, '@static')

/**
 * 比如目录public存在css/a.css
 * 在之前的示例中，请求/static/css/a.css即可获取资源。
 * /

```

快速示例：

``` JavaScript

let st = new resource({
    
    //设定静态资源所在目录
    staticPath: './public',

    //默认就是/static/*，添加的路由，前端必须以/static/ 开头，后面是./public目录下的文件路径。
    routePath : '/static/*',

    routeGroup: '_static',

    //默认不会把路径进行base64解码，所以要支持对中文路径的识别，需要开启此选项。

    decodePath: true,

    // 前缀路径，默认为空字符串。
    // 如果设置为xyz，会自动修正为/xyz。
    //prepath : ''

})

st.init(app)

//添加到_static分组，之后，在public目录中的存在favicon.ico文件，
//通过此请求既可以获取到。
//浏览器会自动发起此请求获取tab标签的图标。
app.get('/favicon.ico', async c => {}, {group: '_static'})

```

#### 关于prepath选项

有时候你会面临这样的需求，静态资源目录为public，但是里面不是所有的资源都是静态资源，而且是以目录独立存放的。比如，对于前端来说，只需要引入/static/css/a.css即可，但是后台默认会读取/public/x/css/a.css文件返回数据，此时的prepath为x，某一时刻，配置更改prepath为y，这时候前端引入资源的路径不变，而服务端，Node.js无需重启，各个对象无需重新实例化，只需要更改prepath配置即可实现资源所在目录的更改。

此功能有一个很重要的应用，就是为自动切换前端应用主题资源提供支持。


## tofile(上传文件)

按照面向对象的风格保存上传的文件：

``` JavaScript

let {tofile} = require('titbit-toolkit')

app.use( new tofile() )

app.post('/upload', async c => {
    let f = c.getFile('image')

    if (f === null) {
        c.status(400)
        return
    }

    //把文件移动到images目录，此目录可能需要手动创建。
    //可以使用第二个参数指定文件名，默认会根据时间戳和随机数生成唯一文件名。
    let fname = await f.toFile('./images')

    //返回上传的文件名
    c.res.body = fname

})

```

## cors(跨域)

跨域支持：

``` JavaScript

let {cors} = require('titbit-toolkit')

let cr = new cors({
    //默认为*表示全部开启跨域，
    //若要指定要支持的域名则需要传递一个数组。
    //注意：这里指定的是用于访问接口的应用页面所在域。
    allow : [
        'https://a.com',
        'https://www.a.com',
        //...
    ],

    //默认只有content-type
    allowHeaders : 'authorization,content-type',

    //OPTIONS请求缓存60秒，此期间浏览器请求会先去读取缓存。
    optionsCache: 60,

    //默认为null，可以设置自定义的消息头。
    //如果要在前端使用authorization传递会话验证的token则需要以下选项。
    headers : {
        'access-control-request-headers' : '*'
    }

})

app.use(cr.mid())

//支持OPTIONS请求，因为浏览器在处理一些POST和PUT请求以及DELETE请求时会先发送OPTIONS预检请求。
//如果没有OPTIONS请求，则跨域支持不完整。
app.options('/*', async c => {

})

```

## realip(解析真实IP)

在代理模式下，获取真实的客户端IP地址，常见的比如使用nginx作为反向代理，或者使用node自身作为代理，这时候后端的服务是代理服务请求并转发的，获取的IP地址永远都是代理服务的，而不是真实的客户端IP地址。

这时候，代理服务为了能够让后端的服务知道真实的IP地址，会在请求转发时，设置消息头，常见的两个消息头：

```
x-real-ip
x-forwarded-for
```

Nginx通常使用x-real-ip，x-forwarded-for最早在Squid软件中使用，你可以在自己的应用中使用其他消息头，这并不是什么标准，只是使用的多而已。

> 因为使用的多了，x-forwarded-for被写入了RFC7239标准。

realip默认会检测两个消息头，顺序为：x-real-ip，x-forwarded-for。只要有一个消息头被发现，就不再继续检测，而是直接使用发现的值。

如果两个消息头都没有设置则会跳过。

使用：

``` JavaScript

app.use( (new realip()).mid() )

app.get('/*', async c => {
    c.send(c.ip)
})

app.run(1234)

```

多级代理，如果使用了多级代理，这时候根据配置不同，有可能，会从第一层代理开始，每个后续的代理都把自己的看到的客户端IP地址追加到消息头的后面，并使用 , 分隔。

此时，扩展检测到消息头信息中存在 , 则会切分成数组，第一个元素则为最开始用户请求的IP地址，并把此值赋值给请求上下文的ip属性。整个数组会挂载到c.box.realip。

``` JavaScript

app.use( (new realip()).mid() )

app.get('/*', async c => {
    let rip = {
        ip : c.ip,
        realip : c.box.realip || 'null'
    }
    c.send(rip)
})

app.run(1234)

```

## proxy(反向代理)

简单的代理服务，注意这个代理实现的是相对简单的工作，但是支持负载均衡。因为是基于titbit框架的一个扩展组件，还可以配合其他中间件完成任何你需要的复杂功能。

此扩展优势在于可控度高，和Node集成更好，可以使用titbit加上其他各种扩展完成更复杂的功能。

如果你希望在代理服务之前还需要其他验证和检测处理，可以在开启代理之前，再使用自己编写的中间件处理，这是非常灵活的，或者你仅仅是想有一个简单的代理服务，但是对性能不是极度要求的，也可以使用此扩展。

----

关于性能：其性能肯定不如Nginx，但是也足够快，能够满足大部分需求。实际测试上，更改调度策略不使用rr，而是采用none，则并发处理能力会大大提升。因为默认的，node.js的cluster模块使用master进程转发套接字的方式，而设置为none则让每个子进程去抢占。

----


**此扩展仅支持HTTP/1.1协议，如果需要HTTP/2协议的反向代理，可使用gohttp扩展提供的模块http2proxy，具体参考<a href="https://gitee.com/daoio/gohttp" target="_blank">gohttp</a>文档。**


``` JavaScript

'use strict'

const titbit = require('titbit')
const {proxy} = require('titbit-toolkit')

let hostcfg = {

    //会自动转换为数组的形式，默认path为 / 
    'a.com' : 'http://localhost:8001',

    //会自动转换为数组的形式
    'b.com' : {
        path : '/xyz',
        url : 'http://localhost:8002'
    },

    //标准形式
    'c.com' : [
        {
            path : '/name',
            url  : 'http://localhost:8003'
        },

        {
            path : '/',
            url : 'http://localhost:8004'
        }
    ]

};

const app = new titbit({
    debug: true
})

const pxy = new proxy({
    timeout: 10000,
    host : hostcfg
})

pxy.init(app)

//在Linux上，必须以root身份运行才能监听80端口。
app.daemon(80, 2)

```

这个时候，要访问真正运行在8001端口的后端服务，可以按照以下形式：

```
http://a.com/
```

访问运行在8002端口的服务：

```
http://b.com/xyz/
```

### 负载均衡处理

首先，使用代理作为负载均衡，对代理服务的配置要求是比较高的，对带宽的要求也很高，这样才可以支撑业务，属于应用层负载均衡。

实际场景下，负载均衡往往是综合利用多种方案实现的。无论如何，这个扩展也实现了一个比较完整的负载均衡支持：

- 多域名、多路径负载均衡。

- 定时检测后端服务是否存活。

- 通过权重值控制不同后端的服务器配置获取不同的流量。

使用proxy扩展开启负载均衡非常简单，只需要配置多个相同host和路径作为一个数组即可：

``` JavaScript

let load_balance_cfg = {

    'a.com' : [
        {
            path : '/',
            url : 'http://localhost:1234',

            //每3秒钟检测服务是否运行
            aliveCheckInterval : 3,

            //检测服务运行的路径，根据请求状况和返回状态码来动态设定此服务是否运行。
            //实际上，此路径在后端服务有没有都可以，即使返回404也说明服务是存在的。
            aliveCheckPath : '/alive-check',

            //表示权重，必须是整数，数字越大权重越高。
            //默认为1。
            weight: 3
        },

        {
            path : '/',
            url : 'http://localhost:1235',
            aliveCheckInterval : 3,
            
            aliveCheckPath : '/ok',

            weight: 2
        },

        {
            path : '/',
            url : 'http://localhost:1236',
            aliveCheckInterval : 2,

            //此超时会覆盖整体配置的超时
            timeout : 5000
        },

    ]
}

const app = new titbit({
    debug: true
})

const pxy = new proxy({

    //针对每一项设置的超时会覆盖此值，这样每一项都可以有自己的超时，默认则使用全局超时设定。
    timeout: 10000,

    //如果开启此选项，会把代理路径后面的字符串作为路径转发，否则会转发整个路径
    starPath : true,

    host : load_balance_cfg
})

pxy.init(app)

app.daemon(1234, 2)

```

**注意：不同的路径是不作为负载均衡项的。**

**关于weight**

这个值用于控制不同配置的机器获取对应的请求量，用于平衡不同配置的差异，高配置的可以使用高一些的权重值，默认都为1，一旦检测到有大于1的值，则表示开启权重计算功能，而默认的，则仅仅是简单的轮转。

weight无法做到十分精确的控制，可以维持一个大概的比例，请求越多越密集，分配比例越准确，而在并发不高时，任何一个后端服务处理都可以。

**path属性和顺序**

如果在数组中，同一个host下的多个路径，/开头是会覆盖其他路径的，这时候如果要同时启用 /xyz 和 / ，则需要把path为 /xyz的配置放在前面。


## mixlogger(混合日志)

混合日志支持，此扩展可以自定义日志处理函数，并在返回false时，直接返回，这可以实现对日志记录的过滤操作。这个扩展对日志的处理是和titbit默认的日志处理共存的，先处理此扩展设定的函数。

> 全局日志的设计是经过大量实践验证的，不要认为中间件的方式更好，在Node.js中，如果你要启用cluster，则很多问题凸显，titbit框架已经解决了这个问题，无论是否使用cluster，全局日志都能让你更轻松的记录请求。并且，在框架层面，你仍然可以使用中间件做更精细的日志处理。

### 使用

```javascript

const titbit = require('titbit')
const {mixlogger} = require('titbit-toolkit')

const app = new titbit({
    debug: true,
    //日志输出到终端
    logType: 'stdio',

    globalLog: true,

})

let mlog = new mixlogger({
    logHandle: (w, msg, handle) => {
        //不记录204状态码的请求
        if (msg.status == 204) {
            return false
        }
        return true
    }
})

mlog.init(app)

//使用一个worker处理请求
app.daemon(1234, 1)

```

## sendtype

针对html、css、js、text、xml、json、javascript几种文本类型做了快速返回处理，你不需要再通过c.setHeader设置消息头content-type。

### 使用

```javascript

const {sendtype} = require('titbit-toolkit')

const app = new titbit()

app.use( (new sendtype).mid() )

app.get('/', async c => {
    c.sendhtml(`<h1>Success</h1>`)
})

app.run(1234)

```

之后，可以使用的快速调用：

- sendjs
- sendjson
- sendcss
- sendhtml
- sendtext
- sendxml

参数和titbit框架在请求上下文提供的send一致。

## setfinal

设置最终要添加的中间件，titbit会添加一个最终的中间件用于返回c.res.body的数据。此扩展可以让你自定义这个最终的中间件。

```javascript

const titbit = require('titbit')
const {setfinal} = require('titbit-toolkit')

const app = new titbit({
    debug: true
})

let fn = new setfinal({
    http1Final : async (c, next) => {
        await next()
        //...
    },

    http2Final : async (c, next) => {
        await next()
        //...
    }
})

fn.init(app)

//your code

app.run(1234)


```

## pipe


创建可读流返回文件内容。对于稍大的文件，使用fs.createReadStream创建可读流会更好。此扩展就是对此功能的封装：

```javascript

const titbit = require('titbit')
const {pipe} = require('titbit-toolkit')

app.use( new pipe() )

let filepath = './images/a.jpg'

app.get('/image', async c => {
  //中间件扩展启用后，会在box属性上挂载pipe函数。
  await c.box.pipe(filepath, c.reply)
})

app.run(1234)


```

## paramcheck(参数检测)

此扩展非常有利于一些需要路由和查询字符串类型和数值验证的场景。比如，支持查询字符串pagesize和offset，而这两个参数可以没有，也可以任意携带，但是必须是>=0的数字。在复杂的程序里，会涉及到很多这种场景，在处理逻辑的代码中就要不断的编写类型验证的代码保证数据的安全。

此扩展通过声明的方式，告诉程序如何验证数据，如果不符合要求则会返回400错误。

使用：

```javascript

const {paramcheck} = require('titbit-toolkit')
const titbit = require('titbit')

const app = new titbit({
  debug: true
})

let pck = new paramcheck({
  //支持query或param，对应于请求上下文的ctx.query和ctx.param。
  key: 'query',

  //要验证的数据，key值即为属性名称，验证规则可以是string|number|object。
  //string会严格判等，number仅仅数据判等，object是最强大的功能。
  data : {
    say: 'hello',
    ok : 123,
    offset: {
      //如果c.query.offset是undefined，则会赋值为0。
      default: 0,
      //要转换的类型，只能是int或float
      to: 'int',
      //最小值，>=
      min: 0,
      //最大值，<=
      max: 100
    },
  }

})

let paramck = new paramcheck({
  //支持query或param，对应于请求上下文的ctx.query和ctx.param。
  key: 'param',

  //要验证的数据，key值即为属性名称，验证规则可以是string|number|object。
  //string会严格判等，number仅仅数据判等，object是最强大的功能。
  data : {
    name: {
      //obj是c.query或c.param，k是属性名称
      callback: (obj, k) => {
        if (obj[k].length < 2 || obj[k].length > 8) {
          return false
        }
        return true
      }
    },

    age : {
      to: 'int',
      min: 12,
      max: 65
    },
    
    mobile: {
      //利用callback，可以实现完全自主的自定义规则。
      callback: (obj, k) => {
        let preg = /^(12|13|15|16|17|18|19)[0-9]{9}$/
        if (!preg.test(obj[k])) {
          return false
        }
        return true
      }
    }
  }

})

app.use(pck).use(paramck)

app.get('/user/:name/:age/:mobile', async c => {
  c.send({
    query: c.query,
    param: c.param
  })
})

app.run(1234)

```

这看起来很复杂，但是这样做的好处是可以复用规则。在多个复杂的应用处理上，很多参数的验证规则是一致的。


## http2limit(http2限流)

```javascript

const {http2limit} = require('titbit-toolkit')

const titbit = require('titbit')

const app = new titbit({
    //启用请求频率限制
    useLimit: true,
    //最大并发连接
    maxConn: 1000,
    //每个IP地址单位时间内可以最大次数。
    maxIPRequest: 100
});

//以上限制在http2模式下很难起作用，因为协议特点，单个连接可以不断请求，频繁请求。

let h2m = new http2limit({
  //时间片5000毫秒
  timeSlice: 5000,

  //每个IP:PORT timeSlice 限制时间片内可以访问10次数。
  maxRequest: 10,

  //套接字生命期限：10分钟（毫秒单位），无论请求是否结束，超时即关闭。
  socketLife: 600000
});

h2m.init(app);

app.daemon(1234, 2);

```


