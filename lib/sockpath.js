'use strict'

/**
 * cdpcd sock 路径推导 —— 全项目唯一一份实现。
 *
 * daemon（cdpcd.js）与 CLI（cdpc / sockop.js / outstatus.js ...）必须都从这里取路径。
 * 本项目既有前车之鉴：负载文件路径散布 5 处硬编码，已经出现漂移。
 *
 * 定稿（见 tmp/cdpc-sock-design.md §4.0c）：
 *   root   : /run/cdpcd/cdpcd.sock          回退 <安装目录>/run/cdpcd.sock
 *   用户   : $HOME/.cdpc/cdpcd.sock
 * 用户级不用 $XDG_RUNTIME_DIR：依赖 linger、目录归 systemd 管、自愈 mkdir 越权，
 * 且 uauth/<user> 存的就是 home，用 home 推导零额外查表。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const RUN_DIR = '/run/cdpcd'
const SOCK_NAME = 'cdpcd.sock'

/**
 * 当前身份的用户名。
 * **不要依赖 process.env.USER**：cron、systemd 等空环境下它不存在，
 * 那时普通用户会被误判成 root（实测 `env -i node` 下 env.USER 为 undefined）。
 * os.userInfo() 按 euid 查 passwd，是权威来源。
 */
function currentUser() {
  try {
    return os.userInfo().username
  } catch (err) {
    // 极端情况（passwd 中无该 uid）才回落到环境变量
    return process.env.USER || (typeof process.geteuid === 'function' && process.geteuid() === 0 ? 'root' : '')
  }
}

/** 当前身份的 home 目录，同样不依赖 process.env.HOME */
function currentHome() {
  try {
    let h = os.userInfo().homedir
    if (h) return h
  } catch (err) {}

  return process.env.HOME || ''
}

/** root 身份的候选路径（顺序即优先级），daemon 与 CLI 共用这一个列表 */
function rootCandidates(insDir) {
  return [
    `${RUN_DIR}/${SOCK_NAME}`,
    `${path.resolve(insDir)}/run/${SOCK_NAME}`
  ]
}

/** 用户身份的 sock 路径 */
function userSock(home) {
  if (!home || typeof home !== 'string') return ''
  return `${home.trim()}/.cdpc/${SOCK_NAME}`
}

/**
 * 目录存在或可创建，且属主为当前 euid、他人不可写（与库层 listen 前置检查同口径）。
 *
 * 权限过宽时的处理：如果目录属主就是我们自己，**收紧它**而不是拒绝。
 * 这一点很关键——在 umask 002 的系统上（启用每用户私有组的发行版很常见），
 * `~/.cdpc` 会被创建成 0775，若直接拒绝就等于用户级 daemon 起不来。
 * 目录是我们自己的运行时/配置目录，去掉 group/other 的写位是安全且预期的。
 */
function dirUsable(dir) {
  try {
    fs.mkdirSync(dir, {recursive: true, mode: 0o755})
  } catch (err) {
    // 已存在时 mkdir recursive 不报错；真报错说明建不了
    return false
  }

  try {
    let st = fs.statSync(dir)

    if (!st.isDirectory()) return false

    let euid = typeof process.geteuid === 'function' ? process.geteuid() : st.uid

    if (st.uid !== euid) return false

    if ((st.mode & 0o022) !== 0) {
      // 自己的目录：收紧后复核；他人的目录一律不碰
      fs.chmodSync(dir, (st.mode & 0o7777) & ~0o022)

      let st2 = fs.statSync(dir)
      if ((st2.mode & 0o022) !== 0) return false
    }

    return true
  } catch (err) {
    return false
  }
}

/**
 * daemon 侧：决定自己要监听的 sock 路径（会按需创建父目录）。
 * @param {string} insDir 安装目录
 * @param {number} euid
 * @param {string} home 非 root 时的 home 路径
 * @returns {string} 空字符串表示无可用路径
 */
function daemonSock(insDir, euid, home) {
  if (euid === 0) {
    for (let c of rootCandidates(insDir)) {
      if (dirUsable(path.dirname(c))) return c
    }
    return ''
  }

  let s = userSock(home)
  if (!s) return ''

  return dirUsable(path.dirname(s)) ? s : ''
}

/**
 * CLI 侧：推导要连接的 sock 路径（不创建任何目录）。
 * root 取第一个真实存在的候选；都不存在时返回首选，让上层报"未运行"。
 */
function cliSock(insDir, euid, home) {
  if (euid === 0) {
    let cands = rootCandidates(insDir)
    for (let c of cands) {
      try {
        if (fs.lstatSync(c).isSocket()) return c
      } catch (err) {}
    }
    return cands[0]
  }

  return userSock(home)
}

/**
 * 读取 uauth 记录里的 home 路径并校验（C10：原先内容零校验直接拼路径）。
 * @returns {string} 空字符串表示记录损坏
 */
function readAuthHome(insDir, user) {
  try {
    let raw = fs.readFileSync(`${path.resolve(insDir)}/uauth/${user}`, {encoding: 'utf8'})
    let home = raw.trim()

    // 必须是单行绝对路径
    if (!home || home.indexOf('\n') >= 0 || home[0] !== '/') return ''

    return home
  } catch (err) {
    return ''
  }
}

/**
 * 枚举所有被授权用户及其 sock 路径（root 聚合用）。
 * @returns {Array<{user: string, home: string, sock: string, broken: boolean}>}
 */
function listAuthUsers(insDir) {
  let out = []
  let dir = `${path.resolve(insDir)}/uauth`

  let files = []
  try {
    files = fs.readdirSync(dir)
  } catch (err) {
    return out
  }

  for (let user of files.sort()) {
    let home = readAuthHome(insDir, user)
    out.push({
      user,
      home,
      sock: home ? userSock(home) : '',
      broken: !home
    })
  }

  return out
}

/**
 * 半升级状态的诊断线索：新 CLI 只会说 sock，遇到仍在运行的旧版 daemon 时
 * 只能得到"连不上"，文案会误导（daemon 明明在跑）。
 * 旧版 daemon 会创建 watch 事件目录，它的存在 + sock 缺失 = 尚未重启完成升级。
 * @returns {string} 空字符串表示没有旧版痕迹
 */
function legacyHint(euid, home) {
  let dirs = euid === 0
    ? ['/tmp/cdpcd_watch']
    : [`${(home || '').trim()}/.cdpc/watch`]

  for (let d of dirs) {
    if (!d || d === '/.cdpc/watch') continue

    try {
      if (fs.statSync(d).isDirectory()) {
        return `检测到旧版文件通道目录 ${d}：如果 cdpcd 仍在运行，`
          + `说明升级后尚未重启，请执行 cdpc service-restart（或 systemctl restart cdpcd.service）`
      }
    } catch (err) {}
  }

  return ''
}

/** stateDir（pid 文件目录的父级）：与 sock 同目录，保证两者生命周期一致 */
function stateDirOf(sockFile) {
  return sockFile ? path.dirname(path.resolve(sockFile)) : ''
}

module.exports = {
  RUN_DIR,
  SOCK_NAME,
  currentUser,
  currentHome,
  rootCandidates,
  userSock,
  dirUsable,
  daemonSock,
  cliSock,
  readAuthHome,
  listAuthUsers,
  legacyHint,
  stateDirOf
}
