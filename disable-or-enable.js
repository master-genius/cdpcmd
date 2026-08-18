'use strict'

const fs = require('fs')
const npargv = require('npargv')

let ROOT_CDPC_CONFIG_DISABLED = `${__dirname}/config/disabled`

const sockpath = require('./lib/sockpath')
const {getUser} = require('./lib/getuser.js')

let euid = process.geteuid()

let arg = npargv({}, {
  commands: [
    'disable', 'enable'
  ]
})

let namelist = arg.list
let args = arg.args

let parseName = require('./parseNameApp.js')

let cmdlist = []

for (let name of namelist) {
  let nm = parseName(name)

  if (nm[0] === '' || nm[0] === 'root') {
    cmdlist.push({
      op: arg.command,
      file: `${ROOT_CDPC_CONFIG_DISABLED}/${nm[1]}`,
      text: name,
      mode: 0o644
    })
  } else {
    try {
      // uauth 内容必须校验（C10）：原实现直接把文件内容当路径拼接，
      // 内容为空会得到 "/.cdpc/..."，带换行/空格则静默指向错误路径。
      let home_path = euid === 0
                        ? sockpath.readAuthHome(__dirname, nm[0])
                        : sockpath.currentHome()

      if (!home_path) {
        console.error(`${nm[0]}: 未授权用户或 uauth 记录损坏`)
        continue
      }

      cmdlist.push({
        op: arg.command,
        file: `${home_path}/.cdpc/config/disabled/${nm[1]}`,
        text: name,
        // C9：原来 root 替用户写这个标记用 0o666（世界可写），
        // 任何能进入该 home 的本地用户都能改写他人服务的禁用标记。
        // 统一 0644——属主目录归该用户，他仍可自行删除该文件（enable）。
        mode: 0o644,
        // root 代写时把属主归还给目标用户，与其余配置文件保持一致
        chownUser: euid === 0 ? nm[0] : ''
      })
    } catch (err) {
      console.error(err)
    }
  }
}

for (let c of cmdlist) {
  switch (c.op) {
    case 'disable':
      try {
        fs.writeFileSync(c.file, c.text||'', {
          encoding: 'utf8',
          flag: 'w',
          mode: c.mode
        })

        if (c.chownUser) {
          let u = getUser(c.chownUser)
          u && fs.chownSync(c.file, u.uid, u.gid)
        }
      } catch (err) {
        console.error(err)
      }

      break

    case 'enable':
      try {
        fs.accessSync(c.file)
        fs.unlinkSync(c.file)
      } catch (err) {
        //console.error(err)
      }
      break
  }
}
