'use strict'

process.chdir(__dirname)

if (process.geteuid() > 0) {
  process.exit(1)
}

const fs = require('fs')
const getuser = require('./lib/getuser.js')
const npargv = require('npargv')

let cgrouplist = [
  'cdpcd-user-auth-limit', 'cdpcd-85-limit', 'cdpcd-80-limit', 'cdcpd-70-limit', 'cdpcd-50-limit',
  'cdpcd-25-limit'
]

let arg = npargv({
  '@command': [
    'show', 'add', 'remove'
  ],

  '--cgroup': {
    name: 'cgroup',
    default: cgrouplist[0],
    callback: (d) => {
      if (['85', '80', '70', '50', '25'].indexOf(d) >= 0) {
        return `cdpcd-${d}-limit`
      }

      return cgrouplist.indexOf(d) >= 0 ? d : cgrouplist[0]
    }
  }
})

let args = arg.args
let userlist = arg.list

let watchPath = '/tmp/cdpcd_watch'

try {
  fs.accessSync('./uauth')
} catch (err) {
  fs.mkdirSync('./uauth', {
    mode: 0o755
  })
}

if (process.argv.length < 4) {
  console.error('less arguments: [show|add|remove] [USER]')
  process.exit(1)
}

let op = arg.command

if (['show', 'add', 'remove'].indexOf(op) < 0) {
  console.error(`unknow command ${op}`)
  process.exit(1)
}

if (op === 'show') {
  let flist = fs.readdirSync('./uauth');

  for (let f of flist)
      console.log(f);

  process.exit(0);
}

function authUser(uname, cgroup) {

  let au = getuser(uname)

  if (!au || !au.home || au.home === '/') {
    return false
  }
  
  let ucfgpath = `${__dirname}/config/${au.user}.js`;
  
  let env_path = [
    `${au.home}/bin`, '/usr/local/sbin', '/usr/local/bin',
    '/usr/sbin', '/usr/bin', '/sbin', '/bin'
  ]

  switch (op) {
  
    case 'add':
      try {
        fs.writeFileSync(`./uauth/${au.user}`, au.home, {encoding: 'utf8'})
        
        let ucfg = `'use strict'\nmodule.exports = {
          name : 'cdpcd-${au.user}',
          args: ['--uid', ${au.uid}],
          file : '${__dirname}/cdpcd.js',
          cgroup: '${cgroup}',
          options: {
            uid: ${au.uid},
            gid: ${au.gid},
            env : {
              SHELL: '${process.env.SHELL}',
              USER: '${au.user}',
              PATH: '${env_path.join(':')}',
              HOME:'${au.home}',
              LANG: '${process.env.LANG}',
            },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc']
          },
          monitor: true,
          callback: (ch, cm) => {
            ch.on('error', err => {
              cm.errorHandle(err, '--CHILD--')
            })
          }
        };`
  
        fs.writeFileSync(ucfgpath, ucfg, {encoding: 'utf8'});
  
        fs.writeFileSync(`${watchPath}/load`, ucfgpath, {encoding: 'utf8'});
  
      } catch (err) {
        console.error(err)
        return false
      }
      
      break;
  
    case 'remove':
      try {
        fs.unlinkSync(`./uauth/${au.user}`)
        fs.unlinkSync(ucfgpath)
        fs.writeFileSync(`${watchPath}/remove/cdpcd-${au.user}`, `${Date.now()}`)
      } catch (err) {
        console.error(err)
        return false
      }
      break;
  }
  
}

for (let u of userlist) {
  authUser(u, args.cgroup)
}
