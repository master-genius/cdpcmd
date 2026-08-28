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
 *   node sockop.js reloadForce <user:name|name> ... 强制重载（停止后按配置重建）
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
  console.error('用法: sockop.js <op> <name...> | sockop.js load --path <file> | sockop.js reload | sockop.js reloadForce <name...>')
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

/**
 * 强制重载单个服务：safeRemove → load 该服务的配置文件 → 等待重建。
 *
 * 为什么需要这条路径：cdpc 的 chk（运行态记录）在服务存活期间缓存着 spawn
 * 用的 options，而 reload 的变更检测只看 command/args 指纹（ck）。
 * env / options / cgroup 这些**只在 spawn 那一刻被读**的字段改掉之后：
 *   · reload  —— ck 未变，判定"无变化"，原样保留旧 chk；
 *   · restart —— 从同一份旧 chk 重新 spawn，读到的还是旧值。
 * 也就是说改完永远不生效，而不是"下次重启才生效"。唯一能让它生效的办法是
 * 让 chk 彻底从注册表消失，再由配置文件重建 —— 即本函数。
 *
 * 关键顺序：必须等到 has 返回空（chk 真的没了）再发 load。
 * safeRemove 的注册表清理落在 daemon 的 setTimeout 里，早发的 load 会撞上
 * _validateConfig 的"应用名称冲突"被跳过，命令看着成功、实际什么也没重载。
 *
 * @param {SockClient} cli 已连接到目标 daemon 的客户端
 * @param {string} name 服务名（已由 groupTargets 去掉 user: 前缀）
 * @returns {{ok: boolean, message: string}}
 */
async function forceOne(cli, name) {
  let ins = await cli.request('inspect', {name})

  if (!ins.ok) {
    return {
      ok: false,
      message: ins.error === 'not-found' ? '服务不存在' : (ins.error || 'unknown')
    }
  }

  let cfgPath = (ins.data && ins.data.configPath) || ''

  /**
   * configPath 为空 = 程序化添加、不随配置目录同步的服务（daemon 内置的
   * web server 就是这类，带 lockReload）。这种服务被 remove 之后没有任何
   * 文件能把它重建回来，强制重载对它等同于**永久删除**，必须在动手之前挡住。
   */
  if (!cfgPath) {
    return {
      ok: false,
      message: '该服务不是由配置文件加载的（无 configPath），强制重载后无法重建，已拒绝'
    }
  }

  let rm = await cli.control('safeRemove', name, 'REMOVED')

  if (!rm.ok) {
    /**
     * 注意措辞：safeRemove 请求**已经发出去了**，超时只说明服务没在等待窗口内
     * 从注册表消失，不等于"什么都没发生"——它很可能正在停止。
     * 这里唯一能确定的是没有继续往下走（没发 load），必须如实说。
     */
    return {
      ok: false,
      message: rm.error === 'wait-timeout'
        ? `停止请求已下发，但服务未在超时内消失（当前 ${rm.state || '未知'}），`
          + `已中止重载。用 cdpc status 确认它是否仍在停止中`
        : `停止失败: ${rm.error || 'unknown'}，已中止重载`
    }
  }

  let ld = await cli.request('load', {path: cfgPath})

  if (!ld.ok) {
    let msg = {
      'invalid-path': '配置文件路径不合法',
      'path-not-readable': '配置文件不存在或不可读（是不是改名或删掉了？）'
    }[ld.error] || ld.error || 'unknown'

    /**
     * 走到这里服务**已经停止且未重建**。只报一句"失败"会让用户完全不知道
     * 现场是什么样子，必须把状态和恢复办法一起说出来。
     */
    return {
      ok: false,
      message: `${msg}：${cfgPath}\n`
        + `    服务已停止且未重建。修好该文件后执行 cdpc load 恢复。`
    }
  }

  let st = await cli.waitState(name, 'RUNNING')

  if (st.ok) return {ok: true, message: `RUNNING (${st.ms}ms)`}

  /**
   * disabled 的服务重建后按用户意愿停在 EXIT（startChild 遇到 disabled 直接
   * 返回）。配置确实已经按新内容重载了，这是成功而不是失败。
   */
  if (st.error === 'disabled') {
    return {ok: true, message: '已按新配置重载（服务处于 disable 状态，未启动）'}
  }

  if (st.error !== 'wait-timeout') {
    return {ok: false, message: st.error || 'unknown'}
  }

  /**
   * 超时的三种含义完全不同，不能合并成一句话：
   *
   *   state === null  —— 服务自始至终没出现，配置多半被拒了；
   *   state PREPARE   —— chk 已重建，但配了 after 且依赖还没起来，
   *                      tryMakeChild 记下依赖关系后就返回、不调 startChild，
   *                      服务会一直停在 PREPARE 等着。这是**正常行为**，
   *                      报成"配置被拒"会把人送到 config errors 里白找一遍；
   *   其他（EXIT 等） —— chk 重建了、也试着启动了，但没跑起来。
   *
   * 正常启动的服务在这 10 秒里早就到 RUNNING 提前返回了，所以走到这里
   * 还是 PREPARE，就确实是卡在依赖上，不会误判启动过程中的瞬时 PREPARE。
   */
  if (st.state === null) {
    return {
      ok: false,
      message: `配置已下发但服务未能在超时内出现：${cfgPath}\n`
        + `    多半是该配置被拒，用 cdpc config errors 查看加载报告。`
    }
  }

  if (st.state === 'PREPARE') {
    return {
      ok: true,
      message: '已按新配置重建，正在等待 after 依赖的服务先启动（当前 PREPARE）'
    }
  }

  return {
    ok: false,
    message: `已按新配置重建，但服务未能启动（当前 ${st.state}），`
      + `用 cdpc log ${name} 查看它的输出`
  }
}

/**
 * 强制重载：必须显式给出服务名（可多个）。
 * 刻意不支持"全部"——它等同于逐个重启所有服务，风险与一次手滑不成比例。
 */
async function runReloadForce() {
  let names = argv.filter(x => x && x[0] !== '-')

  if (names.length === 0) {
    console.error('reloadForce: 缺少服务名')
    process.exit(1)
  }

  let {groups, errors} = groupTargets(names)
  let failed = errors.length

  for (let e of errors) console.error(e)

  for (let g of groups) {
    let cli = new SockClient(g.sock)

    try {
      await cli.connect()
    } catch (err) {
      let kind = classify(err)
      console.error(`${g.user}: ${describe(kind, g.sock, err)}`)
      failed += g.names.length
      continue
    }

    // 串行：每个服务都要经历"停止 → 重建"，并发只会让多个服务同时不可用
    for (let name of g.names) {
      try {
        let r = await forceOne(cli, name)

        if (r.ok) {
          console.log(`${g.user} ${name} ${r.message}`)
        } else {
          console.error(`${g.user} ${name}: ${r.message}`)
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

;(async () => {
  try {
    if (op === 'load') return await runLoad()
    if (op === 'reload') return await runReload()
    if (op === 'reloadForce') return await runReloadForce()

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
