'use strict'

/**
 * sock 路径查询（供 bash 脚本调用）—— 只做推导与枚举，不做任何连接。
 *
 * 用法:
 *   node socketpath.js                自己身份对应的 sock 路径
 *   node socketpath.js --targets      聚合目标列表，每行 "<user>\t<sock>"
 *                                     root: 自己 + 全部授权用户；普通用户: 只有自己
 *   node socketpath.js --user <name>  指定用户的 sock（仅 root）
 *   node socketpath.js --check [user...]
 *                                     逐目标探活，只打印有问题的目标；
 *                                     不带用户名则检查全部目标；
 *                                     全部可达则退出码 0，否则 1
 *
 * 推导逻辑全部来自 lib/sockpath.js（唯一实现）。
 */

const sockpath = require('./lib/sockpath')
const sock = require('./lib/sockclient')

const INS_DIR = __dirname
const euid = process.geteuid()
// 身份与 home 取自 os.userInfo()（按 euid 查 passwd），不依赖 env：
// cron / systemd 等空环境下 USER 与 HOME 都不存在，
// 依赖 env 会把普通用户误判成 root、并推导出错误的 sock 路径。
const home = sockpath.currentHome()
const me = sockpath.currentUser()

let mode = process.argv[2] || ''

main()

function main() {

function selfSock() {
  return sockpath.cliSock(INS_DIR, euid, home)
}

if (mode === '--targets') {
  let lines = [`${me || 'root'}\t${selfSock()}`]

  if (euid === 0) {
    for (let u of sockpath.listAuthUsers(INS_DIR)) {
      if (u.broken) {
        // C10：uauth 记录损坏（内容为空/多行/非绝对路径）必须报出来，不能静默拼错路径
        console.error(`uauth 记录损坏，已跳过：${u.user}`)
        continue
      }
      lines.push(`${u.user}\t${u.sock}`)
    }
  }

  console.log(lines.join('\n'))
  process.exit(0)
}

if (mode === '--check') {
  /**
   * 探活：让上层能区分"服务不存在"与"daemon 不可达"（C3）。
   * 只输出有问题的目标，便于 bash 直接判空。
   */
  ;(async () => {
    // 可选的用户名白名单：调用方（如 handle_app）只关心与本次目标相关的 daemon，
    // 否则某个无关用户的 daemon 挂掉会让每条命令都报"无法确认"。
    let only = process.argv.slice(3).filter(x => x && x[0] !== '-')
    let wanted = only.length > 0 ? new Set(only) : null

    let targets = []

    if (!wanted || wanted.has(me) || (euid === 0 && wanted.has('root'))) {
      targets.push({user: me || 'root', sock: selfSock()})
    }

    if (euid === 0) {
      for (let u of sockpath.listAuthUsers(INS_DIR)) {
        if (wanted && !wanted.has(u.user)) continue

        if (u.broken) {
          console.log(`${u.user}\tuauth 记录损坏`)
          continue
        }
        targets.push({user: u.user, sock: u.sock})
      }
    }

    let bad = 0

    for (let t of targets) {
      let r = await sock.query(t.sock, 'ping')
      if (!r.ok) {
        bad += 1
        console.log(`${t.user}\t${r.message}`)
      }
    }

    process.exit(bad > 0 ? 1 : 0)
  })()

  return
}

if (mode === '--user') {
  let user = process.argv[3] || ''

  if (!user) {
    console.error('用法: socketpath.js --user <name>')
    process.exit(1)
  }

  // 非 root 只能问自己；问别人（含 root）一律拒绝，
  // 不能回落到自己的 sock——那会把"越权"表现成"服务不存在"。
  if (euid !== 0) {
    if (user !== me) {
      console.error('deny!! 普通用户只能查看自己的服务。')
      process.exit(1)
    }
    console.log(selfSock())
    process.exit(0)
  }

  if (user === 'root' || user === me) {
    console.log(selfSock())
    process.exit(0)
  }

  let h = sockpath.readAuthHome(INS_DIR, user)

  if (!h) {
    console.error(`${user} : 未授权用户或 uauth 记录损坏`)
    process.exit(1)
  }

  console.log(sockpath.userSock(h))
  process.exit(0)
}

console.log(selfSock())
}
