'use strict'

process.chdir(__dirname)

const config_path = `${__dirname}/config`

const cdpc = require('cdpc')

const cm = new cdpc({
  notExit: true,
  loadInfoFile: '/tmp/cdpcd-load.log',
  showColor: true,
  loadInfoType: 'json',
  config: config_path
})

cm.strong()

process.on('message', (msg, handle) => {
  if (msg.name && msg.op) {
      switch (msg.op) {
        case 'restart':
        case 'start':
        case 'pause':
        case 'stop':
        case 'resume':
          cm[msg.op](msg.name);
          break;

        case 'query':
          break;
        
        case 'add':
          break;
        
        case 'remove':
          break;
      }
  }
});

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

cm.loadConfig()
