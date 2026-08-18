'use strict'

/**
 * cdpc 控制命令下发（sock 通道）。
 *
 * 一次性替代三个旧脚本：
 *   mapnametocmd.js  —— 推导命令文件路径      → 改为 lib/sockpath.js 推导 sock
 *   noticeApp.js     —— 往 watch 目录写文件    → 改为发 sock 请求
 *   get_app_state.js —— 轮询 state 文件确认    → 改为轮询 sock has（无 readFileSync 崩溃路径）
 *
 * 用法:
 *   node sockop.js <op> <user:name|name> ...        控制类（stop/start/...）
 *   node sockop.js load --path <配置文件绝对路径>    加载配置
 *   node sockop.js reload                           重载全部配置
 *
 * 退出码: 0 全部成功 / 1 存在失败
 */

const process = require('process')
const sockpath = require('./lib/sockpath')
const {SockClient, classify, describe} = require('./lib/sockclient')
const parseName = require('./parseNameApp')

const INS_DIR = __dirname
const euid = process.geteuid()
// 同 socketpath.js：身份判断不能依赖 env（空环境下会误判身份并误拒自己的服务）
const ME = sockpath.currentUser()
const HOME = sockpath.currentHome()

// 控制类 op → 期望达成的目标状态（用于受理后的轮询确认）
const WANT_STATE = {
  start: 'RUNNING',
  restart: 'RUNNING',
  resume: 'RUNNING',
  stop: 'EXIT',
  pause: 'PAUSE',
  remove: 'REMOVED',
  safeRemove: 'REMOVED',
  disable: '',      // disable/enable 不改变运行态语义，不等待
  enable: '',
  restartCount: '',
  resetCount: ''
}

let argv = process.argv.slice(2)
let op = argv.shift()

if (!op) {
  console.error('用法: sockop.js <op> <name...> | sockop.js load --path <file> | sockop.js reload')
  process.exit(1)
}

/** 取出 --path 参数（load 用） */
function takeOption(list, flag) {
  let i = list.indexOf(flag)
  if (i < 0) return ''
  let v = list[i + 1] || ''
  list.splice(i, 2)
  return v
}

/** 自己身份对应的 sock */
function selfSock() {
  return sockpath.cliSock(INS_DIR, euid, HOME)
}

/**
 * 单个目标解析：user:name → {user, name, sock}。
 * 普通用户只能操作自己的服务；root 可通过 uauth 指定他人。
 */
function resolveTarget(raw) {
  let nm = parseName(raw)
  let user = nm[0]
  let name = nm[1]

  if (!name) return {error: `${raw}: 服务名为空`}

  if (euid !== 0) {
    if (user && user !== ME) {
      return {error: `${raw}: deny!! 普通用户只能操作自己的服务`}
    }
    return {user: ME || user, name, sock: selfSock()}
  }

  // root：不带前缀或 root: 前缀都指 root 自己的 daemon
  if (!user || user === 'root') {
    return {user: 'root', name, sock: sockpath.cliSock(INS_DIR, 0, '')}
  }

  let home = sockpath.readAuthHome(INS_DIR, user)
  if (!home) return {error: `${user}: 未授权用户或 uauth 记录损坏`}

  return {user, name, sock: sockpath.userSock(home)}
}

/** 按 sock 分组，保证每个 daemon 只建一条连接（id 配对支持多请求复用） */
function groupTargets(names) {
  let groups = new Map()
  let errors = []

  for (let raw of names) {
    let t = resolveTarget(raw)

    if (t.error) {
      errors.push(t.error)
      continue
    }

    if (!groups.has(t.sock)) {
      groups.set(t.sock, {user: t.user, sock: t.sock, names: []})
    }

    groups.get(t.sock).names.push(t.name)
  }

  return {groups: [...groups.values()], errors}
}

async function runControl() {
  let names = argv.filter(x => x && x[0] !== '-')

  if (names.length === 0) {
    console.error(`${op}: 缺少服务名`)
    process.exit(1)
  }

  let {groups, errors} = groupTargets(names)
  let failed = errors.length

  for (let e of errors) console.error(e)

  let want = WANT_STATE[op]

  for (let g of groups) {
    let cli = new SockClient(g.sock)

    try {
      await cli.connect()
    } catch (err) {
      // 四分类明确报错，绝不静默（C1/C3）
      let kind = classify(err)
      console.error(`${g.user}: ${describe(kind, g.sock, err)}`)
      failed += g.names.length
      continue
    }

    for (let name of g.names) {
      try {
        let r = await cli.control(op, name, want)

        if (r.ok) {
          let st = r.state ? r.state : 'accepted'
          console.log(`${g.user} ${name} ${st}${r.ms !== undefined ? ` (${r.ms}ms)` : ''}`)
        } else if (r.error === 'wait-timeout') {
          // C7：原实现轮询超时后静默退出，这里必须说清楚
          let extra = []
          if (r.state) extra.push(`当前 ${r.state}`)
          if (r.disabled) extra.push('服务已被 disable')
          console.error(`${g.user} ${name}: 等待状态 ${r.want} 超时`
            + (extra.length ? `（${extra.join('，')}）` : ''))
          failed += 1
        } else if (r.error === 'disabled') {
          console.error(`${g.user} ${name}: 服务已被 disable，无法启动（先执行 cdpc enable ${name}）`)
          failed += 1
        } else if (r.error === 'not-found') {
          console.error(`${g.user} ${name}: 服务不存在`)
          failed += 1
        } else {
          console.error(`${g.user} ${name}: ${r.error || 'unknown'}`)
          failed += 1
        }
      } catch (err) {
        console.error(`${g.user} ${name}: ${err.message}`)
        failed += 1
      }
    }

    cli.close()
  }

  process.exit(failed > 0 ? 1 : 0)
}

async function runLoad() {
  let cfgPath = takeOption(argv, '--path') || argv[0] || ''

  if (!cfgPath || cfgPath[0] !== '/') {
    console.error('load: 需要配置文件的绝对路径（--path <file>）')
    process.exit(1)
  }

  let sock = selfSock()
  let cli = new SockClient(sock)

  try {
    await cli.connect()
  } catch (err) {
    let kind = classify(err)
    console.error(describe(kind, sock, err))
    process.exit(1)
  }

  let r = await cli.request('load', {path: cfgPath})
  cli.close()

  if (!r.ok) {
    let msg = {
      'invalid-path': '配置文件路径不合法',
      'path-not-readable': '配置文件不存在或不可读'
    }[r.error] || r.error
    console.error(`load 失败: ${msg} (${cfgPath})`)
    process.exit(1)
  }

  console.log(`load 已受理: ${cfgPath}`)
}

async function runReload() {
  let sock = selfSock()
  let cli = new SockClient(sock)

  try {
    await cli.connect()
  } catch (err) {
    let kind = classify(err)
    console.error(describe(kind, sock, err))
    process.exit(1)
  }

  let r = await cli.request('reload')
  cli.close()

  if (!r.ok) {
    console.error(`reload 失败: ${r.error}`)
    process.exit(1)
  }

  console.log('reload 已受理')
}

;(async () => {
  try {
    if (op === 'load') return await runLoad()
    if (op === 'reload') return await runReload()

    if (WANT_STATE[op] === undefined) {
      console.error(`未知操作: ${op}`)
      process.exit(1)
    }

    return await runControl()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
})()
