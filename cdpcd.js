'use strict';

/**
 * 未授权用户不能直接运行此脚本，这可能会导致一些冲突。
 * 并且未授权的用户本来就不具备运行并管理服务的权限。
 * 因此，脚本启动必须要检测是否已经授权。
 */

process.chdir(__dirname);

const npargv = require('npargv');
const cdpc = require('cdpc');
const cdpclog = require('./lib/cdpclog.js');
const {getUserTable} = require('./lib/getuser.js');
const fs = require('fs');

const fsp = fs.promises

let arg = npargv({
  '--debug': {
    name: 'debug',
    default: false,
    type: 'boolean'
  },

  '--uid': {
    name: 'uid',
    default: 0,
    type: 'int',
    min: 0
  },

  '--user': {
    name: 'string',
    default: ''
  }

})

let args = arg.args

function try_mkdir(dname) {
  let dst = true

  try {
    fs.accessSync(dname)
  } catch (err) {
    dst = false
  }

  if (dst) return;

  try {
    fs.mkdirSync(dname)
  } catch (err) {
    fs.writeFile('/tmp/cdpcd-temp.log', err.message, err => {});
  }

}

let config_path = `${__dirname}/config`;
let config_disabled_path = `${config_path}/disabled`;
let loadfile = '/tmp/cdpcd-load.log';
let event_dir = '/tmp/cdpcd_watch';
let logfile = `${__dirname}/logs/cdpcd.log`;
let pidfile = __dirname + '/logs/cdpcd-pid';
let logdir = __dirname + '/logs';

let preg = /node.*\/usr\/local\/cdpc\/cdpcd\.js/i;

let euid = process.geteuid();

let {idtable, nametable} = getUserTable()
let username = 'root'

if (euid > 0) {
  let cur_user = idtable[euid]
  if (!cur_user) {
    console.error(`用户 uid:${euid} 不存在，请先创建该用户。`)
    process.exit(1)
  }

  username = cur_user.user

  try {
    fs.accessSync(`${__dirname}/uauth/${username}`)
  } catch (err) {
    console.error(`用户 ${username} 没有被授权。`)
    process.exit(1)
  }
}

if (euid > 0) {
  let local_path = `${process.env.HOME}/.cdpc`;

  config_path = `${local_path}/config`;
  config_disabled_path = `${config_path}/disabled`;
  logdir = `${local_path}/logs`;
  
  loadfile = `${local_path}/cdpcd-load.log`;
  event_dir = `${local_path}/watch`;

  logfile = `${logdir}/cdpcd.log`;

  pidfile = `${local_path}/cdpcd-pid`;

  preg = new RegExp(`node.*\/usr\/local\/cdpc\/cdpcd\.js.*--uid.*${euid}`);

  try_mkdir(local_path)
  try_mkdir(config_path)
  try_mkdir(config_disabled_path)
  try_mkdir(event_dir)
  try_mkdir(logdir)
  process.chdir(local_path)
}

try {
  let cur_pid = fs.readFileSync(pidfile, {encoding: 'utf8'});
  cur_pid = parseInt(cur_pid);

  let pid = process.pid;
  if (cur_pid !== pid) {
    try {
      fs.accessSync(`/proc/${cur_pid}`);
      let data = fs.readFileSync(`/proc/${cur_pid}/cmdline`, {encoding: 'utf8'});

      if ( preg.test(data) ) {
          if (euid === 0) {
              console.error('服务已经运行。');
              process.exit(1);
          }
      }

    } catch (err) {
      //console.error(err);
    }
  }

} catch (err) {
  console.error(err);
  fs.writeFileSync('./logs/cdpcd-init-error.log', `${err.message}\n${err.stack}\n`)
}

try {
  fs.writeFileSync(pidfile, `${process.pid}`, {encoding: 'utf8'});
} catch (err) {

}

const clog = new cdpclog(logfile);

clog.init().catch(err => {
  fs.writeFile('/tmp/cdpcd-temp.log', err.message, err => {});
});

let disabledApp = {
  time: 0,
  list: []
}

function getDisabledApp() {
  let tm = Date.now()
  if (tm - disabledApp.time < 10000) {
    return disabledApp.list
  }

  disabledApp.time = tm

  try {
    disabledApp.list = fs.readdirSync(config_disabled_path, {withFileTypes: true})
                            .filter(d => d.isFile())
                            .map(d => d.name)
  } catch (err) {
    disabledApp.list = []
  }

  return disabledApp.list
}

//检测并设定某个用户的应用的内存限制
function checkAndSetLimit(chk, limitobj) {
  let limit_keys = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']

  let common_limit = {}
  for (let k of limit_keys) {
    if (limitobj[k] !== undefined && typeof limitobj[k] === 'number' && !isNaN(limitobj[k])) {
      common_limit[k] = limitobj[k]
    }
  }

  //如果存在通用的则采用通用的，否则采用精确的app控制。
  let lm = common_limit
  if (limitobj.app && limitobj.app[chk.name] && typeof limitobj.app[chk.name] === 'object') {
    lm = limitobj.app[chk.name]

    for (let k in common_limit) {
      if (lm[k] === undefined) {
        lm[k] = common_limit[k]
      }
    }
  }

  if (Object.keys(lm).length <= 0) return false;

  for (let x of limit_keys) {
    !chk.limit && (chk.limit = {});

    if ( (lm[x] !== undefined) && (typeof lm[x] === 'number') && !isNaN(lm[x]) ) {
      ;((chk.limit[x] === undefined) || (chk.limit[x] > lm[x]))
        &&
      (chk.limit[x] = lm[x]);
    }
  }

  return lm
}

/**
 * cdpc会监听signals配置的信号，notExit用于控制是否在收到信号以后退出。
 * notExitButSpread设置为true，可以在不退出的情况下扩散信号。
 */
const cm = new cdpc({
  //notExit: true,
  loadInfoFile: loadfile,
  showColor: true,
  loadInfoType: 'json',
  config: config_path,
  eventDir: event_dir,
  debug: args.debug,
  childDetached: euid === 0 ? false : true,
  errorHandle: clog.errorLog.bind(clog),
  beforeStartCallback: (chk) => {
    let real_list = getDisabledApp()
    if (real_list.includes(chk.name)) {
      chk.disabled = true
    }

    //检测并设定相关limit
    try {
      let limit_path = __dirname + '/limit/' + username + '.js'
      fs.accessSync(limit_path)
      let limitobj = require(limit_path)
      limitobj && typeof limitobj === 'object' && checkAndSetLimit(chk, limitobj)
    } catch (err) {
      args.debug && err.code !== 'ENOENT' && console.error(err);
      err.code !== 'ENOENT' && clog.errorLog(err, '--ERR-SET-LIMIT--')
    }
  }
})

if (euid === 0) {
  let os = require('os')
  let totalmem = os.totalmem()
  let totalCPU = os.cpus().length

  let maxPids = 'max'
  if (totalCPU <= 2) {
    maxPids = 200
  } else {
    maxPids = 128 * (totalCPU - 1)
  }

  cm.cgroup.create('cdpcd-user-auth-limit', {
    cpu: [98500, 100000],
    memory: parseInt(totalmem * 0.85),
    pids: maxPids
  })
  
  cm.cgroup.create('cdpcd-85-limit', {
    cpu: [86500, 100000],
    memory: parseInt(totalmem * 0.75),
    pids: parseInt(maxPids * 0.75)
  })

  cm.cgroup.create('cdpcd-80-limit', {
    cpu: [80000, 100000],
    memory: parseInt(totalmem * 0.65),
    pids: parseInt(maxPids * 0.7)
  })
  
  cm.cgroup.create('cdpcd-70-limit', {
    cpu: [70000, 100000],
    memory: parseInt(totalmem * 0.55),
    pids: parseInt(maxPids * 0.6)
  })

  cm.cgroup.create('cdpcd-50-limit', {
    cpu: [50000, 100000],
    memory: parseInt(totalmem * 0.4),
    pids: parseInt(maxPids / 2)
  })
  
  cm.cgroup.create('cdpcd-25-limit', {
    cpu: [25000, 100000],
    memory: parseInt(totalmem * 0.25),
    pids: 25
  })
}

//捕获所有异常，保证服务稳定运行。但是不会做信号监听处理。
cm.strong();

/**
 * cdpc默认已经对SIGTERM、SIGALRM、SIGABRT、SIGQUIT、SIGINT进行了处理。
 * notExit开启，会直接忽略这些信号。
 */
cm.dynamicStep = 2
cm.setStepSlice(100)
cm.setMaxStep(10, 28)

function addChildApp(msg, cm) {
  if (msg.config) {
    if (Array.isArray(msg.config))
        cm.runChilds(msg.config);
    else
        cm.runChilds([ msg.config ]);
  }
}

function postLog(msg, cm) {
  clog.log(msg)
}

async function set_disabled_state(op, name) {
  let dfile = config_disabled_path + '/' + msg.name

  if (op === 'disable' || op === 'disabled') {
    await fsp.access(dfile)
            .catch(err => {
              fsp.writeFile(dfile, (new Date).toLocaleString(), {encoding: 'utf8'})
                  .catch(err => {
                    err && clog.log({
                      type: 'error',
                      ...err,
                      errname: '--ERR-DISABLED-APP--'
                    })
                  })
            })
  } else {
    await fsp.access(dfile)
            .then(async () => {
              await fsp.unlink(dfile)
                        .catch(err => {
                          return fsp.unlink(dfile)
                        })
                        .catch(err => {
                          err && clog.log({
                            type: 'error',
                            ...err,
                            errname: '--ERR-ENABLE-APP--'
                          })
                        })
            })
            .catch(err => {})
  }
}

function webServerMessage(ch) {
  ch.on('message', (msg, handle) => {
    if (msg.op) {
        switch (msg.op) {
          case 'disable':
          case 'enable':
            set_disabled_state(msg.op, msg.name);
  
          case 'restart':
          case 'start':
          case 'pause':
          case 'stop':
          case 'resume':
          case 'remove':
            msg.name && cm[msg.op](msg.name);
            break;
  
          //提交日志
          case 'log':
            postLog(msg, cm);
            break;
  
          case 'add':
            addChildApp(msg, cm);
            break;
  
          case 'saveRemove':
            msg.name && cm.safeRemove(msg.name);
            break;
  
          case 'remove':
            msg.name && cm.remove(msg.name);
            break;
        }
    }
  });
}

let webServer = {
  name: 'cdpcd-web-server',
  file: __dirname + '/webserver/app.js',
  restart: 'always',
  restartDelay: 1000,
  monitor: true,
  lockReload: true,
  monitorNetData: true,
  cgroup: 'cdpcd-50-limit',
  options: {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  },
  callback: webServerMessage
}

process.on('exit', code => {
  try {
    fs.unlinkSync(loadfile)
  } catch (err) {}
})

/**
 * 避免同身份用户的子进程发送信号导致主服务进程退出
 */
if (args.debug) {
  process.on('SIGTERM', sig => {
    console.error('Debug：收到信号 SIGTERM')
    process.exit(0)
  })

  process.on('SIGINT', sig => {
    console.error('Debug：收到信号 SIGINT')
    process.exit(0)
  })
} else {
  process.on('SIGTERM', sig => {})
  euid === 0 && process.on('SIGINT', sig => {})
}

if (euid === 0) {
  setTimeout(() => {
    cm.runChilds([webServer])
    cm.loadConfig()
    cm.monitorStart()
  }, 235)
} else {
  cm.loadConfig()
  cm.monitorStart()
}
