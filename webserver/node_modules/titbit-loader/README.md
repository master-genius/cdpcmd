# titbit-loader

针对titbit框架的自动加载工具，用于自动创建并加载controller以及middleware的场景。也可以自动加载model。

基于此可实现MVC或类MVC的结构，并可以快速开发接口，生成RESTFul风格的API，路由映射文件等操作。

默认情况，会在当前目录创建controller、middleware、model目录。之后就可以在controller中编写class。

> titbit-loader只是做了应该手动设定路由和安排中间件的部分，把这部分自动化了，在服务运行后，titbit-loader的作用就结束了。

> 此扩展从一开始，不是为了开发单体复杂的软件准备的，只是为了解决在中小规模的应用上，可以方便组织代码结构。但是，做到上百个Model、几百个路由、上百个中间件组装成一个复杂的应用也没有问题。

**注意：使用全局__mid.js加载中间件，可以指定group选项，但是要注意因此导致的OPTIONS请求错误导致的跨域问题，这时候，要求OPTIONS也要针对不同分组添加对应的OPTIONS请求**

示例：

全局__mid.js文件：

```javascript

module.exports = [
  {
    name : 'cors',
    group: ['abc', 'xyz']
  }

]

```

```javascript

const titbit = require('titbit')
const tbloader = require('titbit-loader')

let tbl = new tbloader()

const app = new titbit()

app.options('/xyz/*', async c => {}, {group:'xyz'})

app.options('/abc/*', async c => {}, {group:'abc'})

/**
 * ....
 * */

app.run(1234)

```


使用titbit-loader需要先安装titbit框架：

``` JavaScript
const titbit = require('titbit');
const tbloader = require('titbit-loader');

var app = new titbit({
  debug: true        
});

var tbl = new tbloader();

tbl.init(app);

app.run(2022);

```

controller目录中class示例：

``` JavaScript
//假设存在文件test.js，那么路径就是/test开头。

'use strict';

class test {
  
  constructor () {
    //默认参数是this.param = '/:id'。
    //可以通过设置this.param来指定参数。
    //this.param = '/:name/:key';

    //this.param = '';表示不带参数。
  }

  /*
    对应HTTP请求类型，有同名小写的方法名称处理请求，可以不写，需要哪些请求就写哪些。
    这里只使用了GET、POST、DELETE请求。
  */

  async get(c) {
    c.res.body = 'test ok:' + c.param.id;
  }

  //注意POST请求表示创建资源，默认加载时是不带参数的，也就是发起POST请求对应的路由是/test。
  async post(c) {
    c.res.body = c.body;
  }

  async delete(c) {
    c.res.body = 'delete ok';
  }

}

module.exports = test;

```

## 加载model

默认加载的model的名字就是文件名，没有.js。并且都在app.service.model对象中。但是你可以传递mname选项更改model的名字，或者设置选项directModel为true让model文件直接挂载到app.service上。

**controller中不要写太复杂的业务逻辑，这部分你应该放在model中，对于model，如何封装，是否再分层都可以自定义。titbit-loader只是加载并放在app.service中，仅此而已。**

``` JavaScript
const titbit = require('titbit');
const tbloader = require('titbit-loader');
const dbconfig = require('./dbconfig');

//postgresql数据库的扩展
const pg = require('pg');

var app = new titbit({
  debug: true        
});


var tbl = new tbloader({
  //默认就是true，默认通过app.service.model可以获取。
  loadModel: true, 
  //设置了mdb，在你的model文件中初始化时会传递此参数。
  mdb: new pg.Pool(dbconfig),
  //设置了mname，则要通过app.service.m获取。
  mname: 'm'
});

tbl.init(app);

app.run(2022);

```

## 直接把model挂载到app.service

开启directModel选项，则会在初始化model时候把实例直接挂载到app.service。而在请求上下文中，则可以通过c.service访问，c.service指向app.service。这种依赖注入方式在titbit框架的文档中有说明。

``` JavaScript

const titbit = require('titbit');
const tbloader = require('titbit-loader');
const dbconfig = require('./dbconfig');

//postgresql数据库的扩展
const pg = require('pg');

var app = new titbit({
  debug: true        
});

var tbl = new tbloader({
  //默认就是true，默认通过app.service.model可以获取。
  loadModel: true, 
  mdb: new pg.Pool(dbconfig),
  //直接挂载到app.service
  directModel: true
});

tbl.init(app);

app.run(2022);

```

## 指定主页文件

你应该已经注意到了，因为文件要映射路径，所以，对于主页来说，需要添加的/路径是不能在文件名中体现的，所以需要指定一个文件，并添加get方法作为主页。默认为home.js。

``` JavaScript

const titbit = require('titbit')
const tbloader = require('titbit-loader')

var app = new titbit({
  debug: true
})

var tbl = new tbloader({
  //默认是home.js，并且只有GET请求，主页不允许其他请求
  homeFile : 'home.js',

  //如果要指定子目录的文件，则要使用这样的形式
  //homeFile : 'user/home.js'
});

tbl.init(app)

app.run(2022)

```

如果你不想让homeFile起作用，则只需要给一个空字符串。

## 指定加载目录

``` JavaScript
const titbit = require('titbit');
const tbloader = require('titbit-loader');

var app = new titbit({
  debug: true
});

var tbl = new tbloader({
  //相对于程序所在目录，相对路径会自动计算转换为绝对路径。
  //如果指定目录下没有对应目录，会自动创建controller、model、middleware
  appPath : 'app1'
});

tbl.init(app);

app.run(2022);

```

## POST请求的路由参数

默认在处理路由映射时，POST请求不会带有参数，如果需要传递参数，可以通过选项postArgs开启。

``` JavaScript
const titbit = require('titbit');
const tbloader = require('titbit-loader');

var app = new titbit({
  debug: true
});

var tbl = new tbloader({
  postArgs: true
});

tbl.init(app);

app.run(2022);

```

## 加载中间件

middleware目录存放的是中间件模块，但是不会每个都加载，需要你在controller中进行设置，配置文件为__mid.js。注意controller中的__mid.js表示对全局开启中间件，controller中的子目录中存在__mid.js表示只对当前目录分组启用，所见即所得，简洁直观高效。

之所以能够按照分组加载执行，其本质不在于titbit-loader本身，而是titbit提供的中间件分组执行机制。因为titbit提供了路由分组功能，并且可以指定中间件严格匹配请求方法和路由名称，所以基于此开发扩展就变得很方便。

``` JavaScript
controller/:
    __mid.js    //对全局开启
    
    test.js

    api/:
      __mid.js  //只对/api分组启用
      ...

    user/:
      __mid.js  //只对/user分组启用
      ...

    ...

```

__mid.js示例：

``` JavaScript
//导出的必须是数组，数组中的顺序就是执行顺序，name是middleware目录中文件的名字，不需要带.js
module.exports = [
  {
    name : 'cors',
    //表示要在接收body数据之前执行
    pre: true
  },
  {
    name : 'apilimit'
  }
];

```

#### 加载中间件类

如果你的中间件模块是需要new操作的，不是一个直接执行的中间件函数，则可以使用@指定，同时要提供一个middleware函数。

``` JavaScript
module.exports = [
  {
    //@开头表示模块是类，需要初始化，并且要提供middleware方法，
    //这时候加载时会自动初始化并加载middleware函数作为中间件，
    //并且会绑定this，你可以在中间件模块的middleware函数中比较放心的使用this。
    name : '@apilimit'
  }

];

```

#### 直接指定中间件

在 v21.3.0版本开始，可以通过middleware属性直接指定中间件。

``` JavaScript

//文件__mid.js

let mt = async (c, next) => {
  console.log(`mt run ${(new Date()).toLocaleString()}`)
  await next()
}

module.exports = [
  {
    middleware: mt
  }
]

```

## 只加载model并指定model路径

可以通过modelPath设定model所在目录，并通过loadModel加载。

``` JavaScript

const titbit = require('titbit')
const tbloader = require('titbit-loader')

const app = new titbit({
  debug: true
})

var tbl = new tbloader({
  modelPath : 'dbmodel',
  //指定挂载到app.service.dm上，这会创建dm对象并进行挂载。
  mname : 'dm',
})

//只是加载model类。
tbl.loadModel(app)

app.run(1234)

```

## 指定中间件的加载环境

如果要区分开发模式还是发布模式，并根据不同情况加载中间件，可以使用mode属性，这个功能在v21.4.0开始支持。

mode有2个可选的值：test | dev。都表示在对应的开发环境才会加载。没有mode，则会直接加载，不做任何区分。

mode为 online 则表示只有在生产环境才会加载执行，开发测试模式不会加载。

这个属性只是指定了加载条件，而对于条件的检测，是titbit框架的实例的service.TEST 或者 service.DEV属性是否存在并为true。

``` JavaScript

//文件__mid.js 

let mt = async (c, next) => {
  console.log('dev test -- ', c.method, c.path, c.routepath)
  await next()
}

module.exports = [
  {
    name : 'api-log',
    mode : 'test'
  },

  {
    middleware : mt,
    mode : 'dev'
  },

  {
    name : 'api-limit',
    mode : 'online'
  }

]

```


这个功能是具备开发性质的，就是这需要你在titbit服务中，只要设置了以下配置：

``` JavaScript
const app = new titbit()

//相当于app.service.TEST = true
app.addService('TEST', true)

```

这就表示，会开启测试模式（开发模式）。这个时候，不仅titbit-loader会检测并确定是否加载中间件，还可以在请求上下文中知道应用运行在开发模式。


## 高级功能

这部分功能相对要麻烦点，但是可以应对比较复杂的情况。

### 分组的名称

如果通过输出测试可以看到中间件分组，只是比较麻烦，在titbit-loader加载时，采用了非常简单的机制，controller所在目录，即为根分组，名字是：/。其他都是目录名字作为分组名称，但是都以/开头。

比如以下目录结构：

```
controller/:
  a.js
  ...
  api/:
    user.js
    ...
  admin/:
    user.js
    ...
```

a.js所在分组是/。user.js所在分组是/api，这样，不通过titbit-loader加载的中间件，也可以指定分组，可以对相关分组生效。


### 加载中间件时传递参数

对于中间件是class的情况，有时还需要传递参数，这时候，可以通过__mid.js中的args属性来指定：

```
module.exports = [
  {
    name : '@apilimit',
    args : {
      maxLimit: 100,
      timeout: 56000
    }
  }

]
```

这在初始化apilimit实例时，会传递args参数。

### 加载全局中间件时指定分组

注意：只有在全局的__mid.js中才会有效，其他都会忽略。因为除了全局中间件，其他的目录下都已经确定了分组。

```
module.exports = [
  {
    name : '@apilimit',
    group: ['/api', '/call', '/']
  }
]
```

**别忘了指定分组时，开头的/。**

### 只对文件中的某些请求启用中间件

比如，有controller/a.js文件，只对其中的post和put请求启用限制body大小的中间件，则可以在class中提供__mid函数：

``` JavaScript

class a {

  constructor () {

  }

  async get (c) {
    //...
  }

  async post (c) {
    //...
  }

  async put (c) {
    //...
  }

  __mid () {
    return [
      {
        name : 'setMaxBody',
        pre: true,
        //只对post和put函数启用，而且只有请求/a路径时才会生效。
        path : ['post', 'put']
      }
    ]
  }

}

```

### 不导出controller和model

在controller和model目录中的文件，如果不想导出，则可以命名文件开头加上!（英文符号）。这时候会忽略此文件。

### 导出controller中的某些分组

通过subgroup选项可以指定要加载哪些目录下的路由文件，注意这对在controller目录中的文件无效，这些文件是一定会加载的，只有在controller中的子目录才会有效，比如在controller中存在三个目录和文件：

```
abc/ bcd/ xyz/ a.js
```

如果只想加载xyz则可以这样做：

``` JavaScript

var app = new titbit({
  debug: true
});

var tbl = new tbloader({
  subgroup: ['xyz']
});

tbl.init(app);

```

这时候会加载xyz目录中的文件以及a.js。

> 对于大规模应用来说，你最好是进行服务拆分，不过不是微服务，根据业务进行拆分是个比较好的选择。这个时候，titbit+titbit-loader组成一个服务处理业务，然后再把多个这样的应用组合完成更大规模的处理。
