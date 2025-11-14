'use strict'

process.chdir(__dirname)

if (process.geteuid() > 0) {
  process.exit(1)
}

const fs = require('fs')
const getuser = require('./lib/getuser.js').getUser
const npargv = require('npargv')

let cgrouplist = [
  'cdpcd-user-auth-limit', 'cdpcd-85-limit', 'cdpcd-80-limit', 'cdcpd-70-limit', 'cdpcd-50-limit',
  'cdpcd-25-limit',
  'cdpcd-mem-limit',
  'cdpcd-cpu-limit'
]

let arg = npargv({
  '@command': [
    'show', 'add', 'remove'
  ],

  '--cgroup': {
    name: 'cgroup',
    default: cgrouplist[0],
    callback: (d) => {
      if (['85', '80', '70', '50', '25', 'mem', 'cpu'].indexOf(d) >= 0) {
        return `cdpcd-${d}-limit`
      }

      return cgrouplist.indexOf(d) >= 0 ? d : cgrouplist[1]
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

if (process.argv.length < 3) {
  console.error('less arguments: [show|add|remove] [USER]')
  process.exit(1)
}

let op = arg.command

if (['show', 'add', 'remove'].indexOf(op) < 0) {
  console.error(`unknow command ${op}`)
  process.exit(1)
}

if (op === 'show') {
  let flist = fs.readdirSync('./uauth')

  console.log(flist.join('  '))

  process.exit(0)
}

if (userlist.length <= 0) {
  console.error('less arguemnts: users')
  process.exit(1)
}

function authUser(uname, cgroup) {

  let au = getuser(uname)

  if (!au || !au.home || au.home === '/') {
    console.error(`${uname} not found`)
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
        
        let ucfg = `'use strict'
        let uid = ${au.uid}
        let gid = ${au.gid}
        //防止用户更改id，重新获取
        const {getUser} = require('../lib/getuser.js')
        let real_user = getUser('${au.user}')
        real_user && (uid = real_user.uid)

        module.exports = {
          name : 'cdpcd-${au.user}',
          args: ['--uid', uid],
          file : '${__dirname}/cdpcd.js',
          cgroup: '${cgroup}',
          options: {
            uid: uid,
            gid: gid,
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
