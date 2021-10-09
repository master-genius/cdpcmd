'use strict';

process.chdir(__dirname);

const fs = require('fs');

let config_path = `${__dirname}/config`;
let loadfile = '/tmp/cdpcd-load.log';
let event_dir = '/tmp/cdpc_watch';
let logfile = '/tmp/cdpcd.log';
let pidfile = '/tmp/cdpcd-pid';
let preg = /node.*cdpcd\.js/i;

let euid = process.geteuid();

if (euid > 0) {
  let local_path = `${process.env.HOME}/.local/cdpc`;

  config_path = `${local_path}/config`;
  loadfile = `${local_path}/cdpc-load.log`;
  event_dir = `${local_path}/watch`;
  logfile = `${local_path}/cdpcd.log`;

  pidfile = `${local_path}/cdpcd-pid`;

  preg = new RegExp(`node.*cdpcd\.js.*--uid.*${euid}`);
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
const cdpclog = require('./cdpclog');

const clog = new cdpclog(logfile);

const cm = new cdpc({
  //notExit: true,
  loadInfoFile: loadfile,
  showColor: true,
  loadInfoType: 'json',
  config: config_path,
  eventDir: event_dir,
  debug: true,
  errorHandle: clog.errorLog
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

        case 'log':
          break;

        case 'add':
          addChildApp(msg, cm);
          break;
        
        case 'remove':
          msg.name && cm.safeRemove(msg, msg.name);
          break;
      }
  }
});

if (euid === 0) {
    cm.runChilds([
        {
            name: 'cdpc-web-server',
            file: 'webserver/app.js',
            restart: 'always',
            restartDelay: 500,
            monitor: true,
            lockReload: true,
            options: {
              stdio: ['ignore', 'ignore', 'ignore', 'ipc']
            }
        }
    ])
}

cm.loadConfig();
