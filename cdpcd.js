'use strict';

process.chdir(__dirname);

const npargv = require('npargv');
const cdpc = require('cdpc');
const cdpclog = require('./lib/cdpclog.js');
const fs = require('fs');
const fsp = fs.promises

let arg = npargv({
  '--debug': {
    name: 'debug',
    default: false,
    type: 'boolean'
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

if (euid > 0) {
  let local_path = `${process.env.HOME}/.local/cdpc`;

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

/**
 * cdpc会监听signals配置的信号，notExit用于控制是否在收到信号以后退出。
 */
const cm = new cdpc({
  //notExit: true,
  loadInfoFile: loadfile,
  showColor: true,
  loadInfoType: 'json',
  config: config_path,
  eventDir: event_dir,
  debug: true,
  childDetached: euid === 0 ? false : true,
  errorHandle: clog.errorLog.bind(clog)
});

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
    memory: parseInt(totalmem * 0.9),
    pids: maxPids
  })
  
  cm.cgroup.create('cdpcd-85-limit', {
    cpu: [86500, 100000],
    memory: parseInt(totalmem * 0.75),
    pids: parseInt(maxPids * 0.75)
  })

  cm.cgroup.create('cdpcd-80-limit', {
    cpu: [80000, 100000],
    memory: parseInt(totalmem * 0.7),
    pids: parseInt(maxPids * 0.7)
  })
  
  cm.cgroup.create('cdpcd-70-limit', {
    cpu: [70000, 100000],
    memory: parseInt(totalmem * 0.6),
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

if (euid === 0) {
  setTimeout(() => {
    cm.runChilds([webServer]);
    cm.loadConfig();
    cm.monitorStart();
  }, 235);
} else {
  cm.loadConfig();
  cm.monitorStart();
}
