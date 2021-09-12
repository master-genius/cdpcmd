'use strict';

const fs = require('fs');

/**
 * 路由映射方式：
 *  文件名就是路由，支持目录作为分组或者说是模块的名称，目录中的子目录则不会再加载。
 *  这样如果目录api中存在文件content.js，则路由为/api/content。
 * 一个控制器可以是一个function或 => 函数，也可以是一个class形式的闭包。
 * 总之，一个路由对应一个控制器，就是回调函数，而class需要实例化。
 * 因为class本质上也是function，并且即使function声明的函数，也是有可能需要实例化的，
 * 并且有可能会有使用prototype，而不是class，所以需要在类中声明类型，如果文件中仅仅是
 * 一个需要引入的函数文件，则只需要在文件最开头加上_
 * 规则：
 *  RESTFul模式，实例化以后使用RESTFul模式对应的方法加载。
 * 
 * 不导出模块或类： 
 *  如果不想导出目录或者某一个文件，则需要在文件名称开头加上!。
 * 
 * 路由分组名称：
 *  默认情况，如果是在目录中的文件，则表示全部属于按照目录名称作为分组，
 *  而如果在类中提供了groupName属性，则使用groupName的值。
 * 
 * 路由命名：
 *  默认情况，路由的名称是[目录-文件-方法名称]。
 */

let outWarning = (text) => {
  setTimeout(() => {
    console.error(`    \x1b[2;47;31;7m Warning: ${text} \x1b[0m\n`);
  }, 1280);
};

class loader {

  constructor (options = {}) {
    //let appDir = __dirname + '.';
    let appDir = '.';
    
    this.globalMidTable = {};
    this.groupMidTable = {};
    this.fileMidTable = {};

    if (typeof options !== 'object') {
      options = {};
    }
    
    if (options.appPath !== undefined && typeof options.appPath === 'string') {
      appDir = options.appPath;
    }

    if (appDir.length > 0 && appDir[0] !== '/') {
      appDir = fs.realpathSync(appDir);
    }

    this.config = {
      //当作为模块引入时，根据路径关系，
      //可能的位置是node_modules/titbit-loader/loader.js，
      //所以默认在父级目录两层和node_modules同级。
      appPath     : appDir,
      controllerPath  : appDir+'/controller',
      modelPath     : appDir+'/model',
      midwarePath   : appDir+'/middleware',
      loadModel     : true,
      midwareDesc   : appDir+'midware.js',

      deep : 1,
      mname : 'model',

      //model直接挂载到service上，不在model子对象上。
      directModel: false,

      //如果作为数组则会去加载指定的子目录
      subgroup : null,

      postArgs : false,

      transmitApp : true,

      homeFile: 'home.js'

    };

    //在加载Model时可能需要传递参数
    this.mdb = null;

    //如果你要在初始化controller时传递参数可以设置此变量，但是目前这个功能还没有开启。
    this.cargs = null;

    this.routepreg = /^[a-z\d\-\_]+$/i;

    for (let k in options) {
      
      if (k == 'appPath') { continue; }

      if (k == 'loadModel') {
        this.config.loadModel = options.loadModel;
        continue;
      } else if (k === 'mname') {
        this.config.mname = options.mname;
        continue;
      } else if (k === 'subgroup') {
        if (options[k] instanceof Array) {
          this.config.subgroup = options[k];
        }
        continue;
      } else if (k === 'postArgs' || k === 'transmitApp' || k === 'directModel') {
        this.config[k] = options[k];
        continue;
      } else if (k === 'homeFile' && typeof options[k] === 'string') {
        this.config[k] = options[k];
        continue;
      }

      switch (k) {
        case 'controllerPath':
        case 'modelPath':
        case 'midwarePath':
          if (options[k][0] !== '/') {
            this.config[k] = `${this.config.appPath}/${options[k]}`;
          }
          break;

        default:;
      }
    }

    try {
      fs.accessSync(this.config.controllerPath, fs.constants.F_OK);
    } catch (err) {
      if (this.config.controllerPath.length > 0) {
        fs.mkdirSync(this.config.controllerPath);
      }
    }

    try {
      fs.accessSync(this.config.midwarePath, fs.constants.F_OK);
    } catch (err) {
      if (this.config.midwarePath.length > 0) {
        fs.mkdirSync(this.config.midwarePath);
      }
    }

    try {
      fs.accessSync(this.config.modelPath, fs.constants.F_OK);
    } catch (err) {
      if (this.config.modelPath.length > 0) {
        fs.mkdirSync(this.config.modelPath);
      }
    }

    if (options.mdb !== undefined && this.config.loadModel) {
      this.mdb = options.mdb;
    }
    
  }

  init (app) {
    this.loadController(app);
    this.loadMidware(app);
    if (this.config.loadModel) {
      this.loadModel(app);
    }
  }

  loadController (app) {
    var cfiles = {};
    this.readControllers(this.config.controllerPath, cfiles);
    let cob = null;
    for (let k in cfiles) {
      try {
        cob = require(k);
        /* if (this.config.transmitApp) {
          cob = new cob(app);
        } else {
          cob = new cob();
        } */
        cob = new cob();
        this.setRouter(app, cob, cfiles[k]);
        cob = null;
      } catch (err) {
        console.error('Error: load router => ', err.message, k);
      }
    }

    return cfiles;
  }

  setRouter (app, cob, cf) {
    if (cob.mode === undefined) {
      cob.mode = 'restful';
    }

    var group = cf.dirgroup;
    let npre = cf.filegroup;

    let routeParam = '/:id';

    if (cob.param !== undefined && cob.param !== null && typeof cob.param === 'string') {
      
      routeParam = cob.param.trim();

      if (routeParam.length > 0 && routeParam[0] !== '/') {
        routeParam = `/${routeParam}`;
      }

    }

    if (cob.post !== undefined && typeof cob.post === 'function') {
      app.router.post(
        `${cf.filegroup}${this.config.postArgs ? routeParam : ''}`,
        cob.post.bind(cob),
        {
          name: `${npre}/post`,
          group: group
        }
      );
    }

    if (cob.delete !== undefined && typeof cob.delete === 'function') {
      app.router.delete(
        `${cf.filegroup}${routeParam}`,
        cob.delete.bind(cob),
        {
          name: `${npre}/delete`,
          group: group
        }
      );
    }

    if (cob.put !== undefined && typeof cob.put === 'function') {
      app.router.put(
        `${cf.filegroup}${routeParam}`,
        cob.put.bind(cob),
        {
          name: `${npre}/put`,
          group: group
        }
      );
    }

    if (cob.get !== undefined && typeof cob.get === 'function') {
      app.router.get(
        `${cf.filegroup}${routeParam}`,
        cob.get.bind(cob),
        {
          name: `${npre}/get`,
          group: group
        }
      );
      //主页只支持GET请求
      if (this.config.homeFile === cf.pathname) {
        app.router.get('/', cob.get.bind(cob), {
          name: 'home',
          group: group
        });
      }
    }

    if (cob.list !== undefined && typeof cob.list === 'function') {
      app.router.get(`${cf.filegroup}`, cob.list.bind(cob),{
        name: `${npre}/list`,
        group: group
      });
    }

    if (cob.patch !== undefined && typeof cob.patch === 'function') {
      app.router.patch(`${cf.filegroup}`, cob.patch.bind(cob),{
        name: `${npre}/patch`,
        group: group
      });
    }

    if (cob.options !== undefined && typeof cob.options === 'function') {
      app.router.options(`${cf.filegroup}${routeParam}`, cob.options.bind(cob),{
        name: `${npre}/options`,
        group: group
      });
    }

    if (cob.head !== undefined && typeof cob.head === 'function') {
      app.router.head(`${cf.filegroup}${routeParam}`, cob.head.bind(cob),{
        name: `${npre}/head`,
        group: group
      });
    }

    if (cob.__mid && typeof cob.__mid === 'function') {
      var mid = cob.__mid();
      if (mid && (mid instanceof Array) ) {
        this.fileMidTable[cf.filegroup] = {
          group : group,
          mid   : mid
        };
      }
    }
  }

  /**
   * 加载中间件，仅仅是通过一个js文件，
   * 中间件不宜过度使用，否则容易混乱。
   */
  loadMidware (app) {
    for (let i=0; i<this.globalMidTable.length; i++) {
      this.loadGlobalMidware(app, this.globalMidTable[i]);
    }
    //加载组，此时组已经确定
    for (let k in this.groupMidTable) {
      for (let i=0; i<this.groupMidTable[k].length; i++) {
        this.loadGroupMidware(app, this.groupMidTable[k][i], k);
      }
    }

    for(let k in this.fileMidTable) {
      for (let i=0; i<this.fileMidTable[k].mid.length; i++) {
        this.loadFileMidware( app, 
          this.fileMidTable[k].mid[i],
          k, 
          this.fileMidTable[k].group
        );
      }
    }

  }

  getMidwareInstance(m) {
    if (m.middleware !== undefined 
      && typeof m.middleware === 'function' 
      && m.middleware.constructor.name === 'AsyncFunction')
    {
      return m.middleware;
    }

    if (typeof m.name !== 'string' || m.name.trim() === '') {
      console.error(`--Middleware Error--: less name.`, m);
      return null;
    }

    var mt = null;
    let tmp = null;
    if (m.name[0] == '@') {
      tmp = require(this.config.midwarePath+'/'+m.name.substring(1));
      if (m.args === undefined) {
        mt = new tmp();
      } else {
        mt = new tmp(m.args);
      }

      return mt.middleware.bind(mt);

    } else {
      mt = require(this.config.midwarePath+'/'+m.name);
    }
    return mt;
  }

  _checkMidwareMode (app, m) {
    if (m.mode !== undefined) {
      if (m.mode === 'test' || m.mode === 'dev') {
        if (app.service.TEST || app.service.DEV) {
          return true;
        }
        return false;
      } else if (m.mode === 'online' || m.mode === 'product') {
        //只在正式环境加载
        if (app.service.TEST || app.service.DEV) {
          //console.log(`测试环境不加载中间件`, m);
          return false;
        }
        return true;
      }
    }
    //console.log('加载···', m);
    return true;
  }

  loadGlobalMidware (app, m) {
    //检测是否是开发环境，并确定是否加载中间件。
    if (this._checkMidwareMode(app, m) === false) {
      return;
    }
    
    let opts = null;

    var makeOpts = (groupname = null) => {
      let op = {};
      if (m.method !== undefined) {
        op.method = m.method;
      }
      if (groupname) {
        op.group = groupname[0] === '/' ? groupname : `/${groupname}`;
      }

      if (m.pre) {
        op.pre = true;
      }
      return op;
    };

    let mobj;

    if (m.group !== undefined) {
      if (m.group instanceof Array) {
        for (let i=0; i<m.group.length; i++) {
          mobj = this.getMidwareInstance(m);
          if (mobj !== null) {
            app.use(mobj, makeOpts(m.group[i]));
          }
        }
        return ;
      }
    }
    
    opts = makeOpts(m.group || null);

    mobj = this.getMidwareInstance(m);
    if (mobj) {
      app.use(mobj, opts);
    }
  }

  loadGroupMidware(app, m, group) {
    
    if (this._checkMidwareMode(app, m) === false) {
      return;
    }

    if ((!m.name || m.name === '') && !m.middleware) {
      return;
    }
    let opts = {
      group: group,
    };
    if (m.method !== undefined) {
      opts.method = m.method;
    }
    if (m.pre) {
      opts.pre = true;
    }

    let mobj = this.getMidwareInstance(m);
    if (mobj) {
      app.use(mobj, opts);
    }
  }

  loadFileMidware (app, m, f, group) {
    
    if (this._checkMidwareMode(app, m) === false) {
      return;
    }

    let opts = {
      group: group,
      name:[],
    };

    if (m.path === undefined) {
      opts.name = [
        `${f}/get`, `${f}/list`, `${f}/post`, `${f}/put`, `${f}/delete`,

        `${f}/options`, `${f}/patch`, `${f}/head`
      ];
    } else {
      if (typeof m.path === 'string') {
        m.path = [ m.path ];
      }
      for(let i=0; i<m.path.length; i++) {
        opts.name.push(`${f}/${m.path[i]}`);
      }
      
    }

    if (m.pre) {
      opts.pre = true;
    }

    let mobj = this.getMidwareInstance(m);
    if (mobj) {
      app.use(mobj, opts);
    }
  }

  /**
   * 加载数据库操作接口，一个表要对应一个js文件，
   * 默认没有模型关联的支持，这需要自己编写SQL语句。
   */
  loadModel (app) {
    if (app.service[this.config.mname] === undefined) {
      app.service[this.config.mname] = {};
    }
    try {
      var mlist = fs.readdirSync(this.config.modelPath, {withFileTypes:true});
      for (let i=0; i < mlist.length; i++) {
        if (!mlist[i].isFile()) { continue; }
        if (mlist[i].name.substring(mlist[i].name.length-3) !== '.js') {
          continue;
        }

        //!开头的命名不导出
        if (mlist[i].name[0] === '!' || mlist[i].name[0] === '_') {
          continue;
        }

        this.requireModel(app, mlist[i].name);
      }
    } catch (err) {
      console.error(err);
    }
  }

  requireModel(app, mfile) {
    try {
      let m = require(this.config.modelPath+'/'+mfile);

      let mobj = this.mdb ? new m(this.mdb) : new m();

      let mname = mfile.substring(0, mfile.length-3);
      
      if (mobj.modelName && typeof mobj.modelName === 'string' && mobj.modelName.length > 0) {
        mname = mobj.modelName;
      }

      if (this.config.directModel) {
        if (app.service[mname] !== undefined) {
          outWarning(`model 冲突 ---- ${mfile}{${mname}} 已经设置。`);
        }
        app.service[mname] = mobj;
      } else {
        if (app.service[this.config.mname][mname] !== undefined) {
          outWarning(`model 冲突 ---- ${mfile}{${mname}} 已经设置。`);
        }
        app.service[this.config.mname][mname] = mobj;
      }
    } catch (err) {
      console.error(err.message, ' -- ', mfile);
    }
  }

  stripExtName (filename) {
    let sf = filename.split('.js');
    return `${sf[0]}`;
  }

  /**
   * 读取控制器目录中的文件
   * @param {string} cdir 
   * @param {object} cfiles 
   * @param {number} deep 
   * @param {string} dirgroup 
   */
  readControllers (cdir, cfiles, deep = 0, dirgroup = '') {
    let files = fs.readdirSync(cdir, {withFileTypes:true});

    let tmp = '';
    for (let i=0; i<files.length; i++) {

      if (files[i].isDirectory() && deep < 1) {

        if (files[i].name[0] == '!') {
          continue;
        }

        //检测是否启用了分组控制
        //这时候，只有在subgroup之内的才会去加载
        if (this.config.subgroup instanceof Array) {
            if (this.config.subgroup.indexOf(files[i].name) < 0) {
              continue;
            }
        }

        if (this.routepreg.test(files[i].name) === false) {
          outWarning(`${files[i].name}/ 目录不能有空格换行特殊字符等，仅支持 字母 数字 - _`);
          continue;
        }

        this.readControllers(cdir+'/'+files[i].name, 
          cfiles, deep+1,
          `${dirgroup}/${files[i].name}`
        );

      } else if (files[i].isFile()) {
        if (files[i].name[0] === '!') {
          continue;
        }

        if (files[i].name.length < 4) {
          continue;
        }

        if (files[i].name.substring(files[i].name.length-3) !== '.js') {
          continue;
        }

        if (files[i].name == '__mid.js') {
          if (deep == 0) {
            this.globalMidTable = require(cdir+'/'+files[i].name);
          } else {
            this.groupMidTable[dirgroup] = require(cdir+'/'+files[i].name);
          }
          continue;
        }

        tmp = this.stripExtName(files[i].name);

        if (this.routepreg.test(tmp) === false) {
          outWarning(`${files[i].name} 不能有空格换行特殊字符等，仅支持 字母 数字 - _`);
          continue;
        }

        cfiles[cdir+'/'+files[i].name] = {
          filegroup: dirgroup + '/' + tmp,
          dirgroup: dirgroup || '/',
          name: files[i].name,
          modname: tmp,
          pathname : `${dirgroup}${dirgroup ? '/' : ''}${files[i].name}`
        };
      }
    }
    
  }

}

module.exports = loader;
