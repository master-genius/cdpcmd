'use strict';

process.chdir(__dirname);

const fs = require('fs');

function try_mkdir (dname) {
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
let loadfile = '/tmp/cdpcd-load.log';
let event_dir = '/tmp/cdpc_watch';
let logfile = `${__dirname}/logs/cdpcd.log`;
let pidfile = '/tmp/cdpcd-pid';
let logdir = __dirname + '/logs';

let preg = /node.*cdpcd\.js/i;

let euid = process.geteuid();

if (euid > 0) {
  let local_path = `${process.env.HOME}/.local/cdpc`;

  config_path = `${local_path}/config`;
  logdir = `${local_path}/logs`;
  
  loadfile = `${local_path}/cdpcd-load.log`;
  event_dir = `${local_path}/watch`;

  logfile = `${logdir}/cdpcd.log`;

  pidfile = `${local_path}/cdpcd-pid`;

  preg = new RegExp(`node.*cdpcd\.js.*--uid.*${euid}`);

  try_mkdir(local_path)
  try_mkdir(config_path)
  try_mkdir(event_dir)
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
        console.error('服务已经运行。');
        process.exit(1);
      }

    } catch (err) {
      //console.error(err);
    }
  }

} catch (err) {
  console.error(err);
}

try {
  fs.writeFileSync(pidfile, `${process.pid}`, {encoding: 'utf8'});
} catch (err) {

}

const cdpc = require('cdpc');
const cdpclog = require('./lib/cdpclog');

const clog = new cdpclog(logfile);

clog.init().catch(err => {
  fs.writeFile('/tmp/cdpcd-temp.log', err.message, err => {});
});

const cm = new cdpc({
  //notExit: true,
  loadInfoFile: loadfile,
  showColor: true,
  loadInfoType: 'json',
  config: config_path,
  eventDir: event_dir,
  debug: true,
  errorHandle: clog.errorLog.bind(clog)
});

cm.strong();

function addChildApp (msg, cm) {
  if (msg.config) {
    if (msg.config instanceof Array)
        cm.runChilds(msg.config);
    else
        cm.runChilds([ msg.config ]);
  }
}

function postLog(msg, cm) {
  clog.log(msg)
}

process.on('message', (msg, handle) => {
  if (msg.op) {
      switch (msg.op) {
        case 'restart':
        case 'start':
        case 'pause':
        case 'stop':
        case 'resume':
          msg.name && cm[msg.op](msg.name);
          break;

        //提交日志
        case 'log':
          postLog(msg, cm);
          break;

        case 'add':
          addChildApp(msg, cm);
          break;

        case 'forceRemove':
          msg.name && cm.remove(msg.name);
          break;

        case 'remove':
          msg.name && cm.safeRemove(msg.name);
          break;
      }
  }
});

if (euid === 0) {
    cm.runChilds([
        {
            name: 'cdpcd-web-server',
            file: 'webserver/app.js',
            restart: 'always',
            restartDelay: 500,
            monitor: true,
            lockReload: true,
            options: {
              stdio: ['ignore', 'ignore', 'ignore', 'ipc']
            },
        }
    ])
}

cm.loadConfig();

cm.monitorStart();
