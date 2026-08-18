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
}, {
  commands: [
    'show', 'add', 'remove'
  ]
})

let args = arg.args
let userlist = arg.list

// 控制通道改为 sock（文件通道已移除）：auth 需要通知 root daemon
// 加载/移除"用户 daemon"这个受管服务，走 sock 的 load / remove op。
const sockpath = require('./lib/sockpath')
const sock = require('./lib/sockclient')

const ROOT_SOCK = sockpath.cliSock(__dirname, 0, '')

// 授权动作是同步流程，这里只发起请求并汇报结果，不阻塞后续用户处理
function notifyDaemon(op, extra, desc) {
  sock.query(ROOT_SOCK, op, extra).then(r => {
    if (r.ok) return

    console.error(`${desc} 失败: ${r.message}`)
    console.error('（cdpcd 未运行时可稍后执行 cdpc reload 使其生效）')

    // 退出码必须体现失败：uauth 已写入但 daemon 没加载，
    // 退出码 0 会让脚本化调用误判为完全成功。
    // 用 exitCode 而非 process.exit，避免截断其他用户的处理。
    process.exitCode = 1
  })
}

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
  
  // 授权用户的配置文件用 user@<用户名> 命名，便于和普通服务配置区分。
  // 服务名仍是 cdpcd-<用户名>（由配置内的 name 字段显式指定）。
  let ucfgpath = `${__dirname}/config/user@${au.user}.js`;
  // 旧格式（升级前为 config/<用户名>.js），迁移时清理，避免与新文件同 name 冲突。
  let oldcfgpath = `${__dirname}/config/${au.user}.js`;
  
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
  
        // 清理可能存在的旧格式配置文件，避免与新文件同 name 冲突。
        try { fs.unlinkSync(oldcfgpath) } catch (err) {}

        fs.writeFileSync(ucfgpath, ucfg, {encoding: 'utf8'});

        notifyDaemon('load', {path: ucfgpath}, `通知 cdpcd 加载 ${au.user} 的 daemon 配置`);
  
      } catch (err) {
        console.error(err)
        return false
      }
      
      break;
  
    case 'remove':
      try {
        fs.unlinkSync(`./uauth/${au.user}`)
        // 新旧两种格式的配置文件都尝试清理（文件不存在则忽略）。
        try { fs.unlinkSync(ucfgpath) } catch (e) {}
        try { fs.unlinkSync(oldcfgpath) } catch (e) {}
        notifyDaemon('remove', {name: `cdpcd-${au.user}`}, `通知 cdpcd 移除服务 cdpcd-${au.user}`)
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
