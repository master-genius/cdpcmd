'use strict';

process.chdir(__dirname);

let config_path = `${__dirname}/config`;
let loadfile = '/tmp/cdpcd-load.log';
let event_dir = '/tmp/cdpc_watch';

let euid = process.geteuid();

if (euid > 0) {
  config_path = `${process.env.HOME}/.local/cdpc/config`;
  loadfile = `${process.env.HOME}/.local/cdpc/cdpc-load.log`;
  event_dir = `${process.env.HOME}/.local/cdpc/watch`;
}

const cdpc = require('cdpc');

const cm = new cdpc({
  //notExit: true,
  loadInfoFile: loadfile,
  showColor: true,
  loadInfoType: 'json',
  config: config_path,
  eventDir: event_dir,
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
