'use strict';

/**
 * 未授权用户不能直接运行此脚本，这可能会导致一些冲突。
 * 并且未授权的用户本来就不具备运行并管理服务的权限。
 * 因此，脚本启动必须要检测是否已经授权。
 */

process.chdir(__dirname);

const npargv = require('npargv');
const cdpc = require('cdpc');
const cdpclog = require('./lib/cdpclog.js');
const {getUserTable} = require('./lib/getuser.js');
const fs = require('fs');


let arg = npargv({
  '--debug': {
    name: 'debug',
    default: false,
    type: 'boolean'
  },

  '--uid': {
    name: 'uid',
    default: 0,
    type: 'int',
    min: 0
  },

  '--user': {
    name: 'string',
    default: ''
  }

})

let args = arg.args

function try_mkdir(dname) {
  let dst = true

  try {
    fs.accessSync(dname)
  } catch (err) {
    dst = false
  }

  if (dst) return;

  try {
    fs.mkdirSync(dname)
  } catch (err) {
    fs.writeFile('/tmp/cdpcd-temp.log', err.message, err => {});
  }

}

let config_path = `${__dirname}/config`;
let config_disabled_path = `${config_path}/disabled`;
// loadInfoFile 已不是任何内部组件的依赖（CLI 走 sock），
// 仅作单向导出：daemon 崩溃后的事后取证 + 第三方零依赖集成。
let loadfile = '/tmp/cdpcd-load.log';
let logfile = `${__dirname}/logs/cdpcd.log`;
let pidfile = __dirname + '/logs/cdpcd-pid';
let logdir = __dirname + '/logs';

let euid = process.geteuid();

// ~/.cdpcd_env 的加载结果，待日志组件就绪后再输出（见下方 flush）
let userEnvResult = null;

let {idtable, nametable} = getUserTable()
let username = 'root'

if (euid > 0) {
  let cur_user = idtable[euid]
  if (!cur_user) {
    console.error(`用户 uid:${euid} 不存在，请先创建该用户。`)
    process.exit(1)
  }

  username = cur_user.user

  try {
    fs.accessSync(`${__dirname}/uauth/${username}`)
  } catch (err) {
    console.error(`用户 ${username} 没有被授权。`)
    process.exit(1)
  }
}

if (euid > 0) {
  // HOME 缺失时（空环境启动）按 euid 查 passwd 兜底：
  // 配置路径与 sock 路径必须同源，否则会出现"配置在 A、通道在 B"的错位。
  let user_home = process.env.HOME || require('./lib/sockpath').currentHome();
  let local_path = `${user_home}/.cdpc`;

  config_path = `${local_path}/config`;
  config_disabled_path = `${config_path}/disabled`;
  logdir = `${local_path}/logs`;
  
  loadfile = `${local_path}/cdpcd-load.log`;

  logfile = `${logdir}/cdpcd.log`;

  pidfile = `${local_path}/cdpcd-pid`;

  try_mkdir(local_path)
  try_mkdir(config_path)
  try_mkdir(config_disabled_path)
  try_mkdir(logdir)
  process.chdir(local_path)

  /**
   * 用户自定义环境变量：~/.cdpcd_env
   *
   * 由**用户自己身份的进程**加载（此处 euid 就是该用户），root 全程不碰这个
   * 文件——读文件的进程本身就是文件属主，不存在权限跨越，也就不需要
   * O_NOFOLLOW / 属主校验之类的跨权限防护。
   *
   * 注意：保护 ~/.cdpc 路径一致性的是 envfile 的 FORBIDDEN_KEYS（禁止覆盖
   * HOME/USER/LOGNAME），**不是**这里的调用顺序——sockfile 的推导在本块之后，
   * 顺序本身挡不住任何东西。要放宽那份禁止清单前先想清楚这一点。
   *
   * 改动 process.env 之后，cdpc 的 cfg.env 是"以 process.env 为底叠加"的语义，
   * 未显式配 env 的服务也直接继承，因此用户不必逐个服务配置。
   * 用户改完文件重启自己的 daemon 即生效，无需 root 重跑 cdpc auth。
   */
  userEnvResult = require('./lib/envfile.js').loadUserEnv(`${user_home}/.cdpcd_env`)
}

/**
 * sock 控制通道：唯一的对外管理入口（文件通道已从 cdpc 库整体移除）。
 * 路径推导统一走 lib/sockpath.js —— daemon 与 CLI 共用同一份逻辑，
 * 避免本项目既有的"路径常量多份硬编码 → 漂移"问题。
 */
const sockpath = require('./lib/sockpath');

let sockfile = sockpath.daemonSock(__dirname, euid, sockpath.currentHome());

if (!sockfile) {
  console.error('无法建立 sock 控制通道：候选目录都不可用（属主/权限不符或无法创建）。');
  console.error(`root 候选: ${sockpath.rootCandidates(__dirname).join(' , ')}`);
  process.exit(1);
}

// pid 文件（detached 接管恢复用）与 sock 同目录，两者生命周期一致
let statedir = sockpath.stateDirOf(sockfile);

/**
 * cgroup 子树初始化：
 * 从 /proc/self/cgroup 推导 cdpcd 自身所在的 cgroup 路径，
 * 把自身挪入叶子组 cdpcd-main（cgroup v2 "no internal processes" 规则），
 * 返回该路径作为 cgroupBaseDir 传给 CDPC，使 limit 组建在 cdpcd.service 子树下，
 * 不再逃逸到 cgroup 根。失败时回退 undefined（cgroup.js 回退到 /sys/fs/cgroup）。
 */
function initCgroupBaseDir() {
  if (euid !== 0) return undefined

  try {
    let line = fs.readFileSync('/proc/self/cgroup', {encoding: 'utf8'}).trim()
    // cgroup v2 格式：0::/system.slice/cdpcd.service
    let cgroupPath = line.split(':').pop()
    if (!cgroupPath || cgroupPath === '/') return undefined

    let selfCgroupDir = '/sys/fs/cgroup' + cgroupPath

    // 确认目录存在
    fs.accessSync(selfCgroupDir)

    // cgroup v2 "no internal processes"：有子组的 cgroup 不能直接放进程。
    // 先创建叶子目录，再把 cdpcd 自身挪进去，清空父 cgroup.procs，
    // 这样后续 cgroup.create() 写入 subtree_control 才不会 EBUSY。
    let leafDir = selfCgroupDir + '/cdpcd-main'
    try {
      fs.mkdirSync(leafDir)
    } catch (err) {
      // 目录已存在则忽略
      if (err.code !== 'EEXIST') throw err
    }

    try {
      fs.writeFileSync(leafDir + '/cgroup.procs', `${process.pid}`, {encoding: 'utf8'})
    } catch (err) {
      // 挪移失败（如 Delegate=yes 未设、权限不足）：回退到 cgroup 根，
      // 行为等同现状——limit 组建在 /sys/fs/cgroup 下。
      args.debug && console.error(`[cgroup] 自身挪入叶子组失败，回退到 cgroup 根: ${err.message}`)
      return undefined
    }

    return selfCgroupDir
  } catch (err) {
    // 非 systemd 环境 或 /proc/self/cgroup 不存在：回退
    args.debug && console.error(`[cgroup] 推导 cgroup 路径失败: ${err.message}`)
    return undefined
  }
}

let cgroupBaseDir = initCgroupBaseDir()

try {
  fs.writeFileSync(pidfile, `${process.pid}`, {encoding: 'utf8'});
} catch (err) {

}

const clog = new cdpclog(logfile);

clog.init().catch(err => {
  fs.writeFile('/tmp/cdpcd-temp.log', err.message, err => {});
});

/**
 * ~/.cdpcd_env 的加载结果落日志：生效了哪些键、忽略了什么以及原因。
 * 环境变量会被继承到该用户全部被托管服务，没有这行记录排障只能靠猜。
 */
if (userEnvResult) {
  if (userEnvResult.loaded) {
    clog.log({
      type: 'log',
      logname: 'USER-ENV',
      message: `~/.cdpcd_env 已加载：生效 ${userEnvResult.applied.length} 项`,
      other: userEnvResult.applied.join(',') || '-'
    });
  }

  for (let w of userEnvResult.warnings) {
    clog.log({type: 'log', logname: 'USER-ENV', message: w, other: 'warn'});
  }
}

let disabledApp = {
  time: 0,
  list: []
}

function getDisabledApp() {
  let tm = Date.now()
  if (tm - disabledApp.time < 10000) {
    return disabledApp.list
  }

  disabledApp.time = tm

  try {
    disabledApp.list = fs.readdirSync(config_disabled_path, {withFileTypes: true})
                            .filter(d => d.isFile())
                            .map(d => d.name)
  } catch (err) {
    disabledApp.list = []
  }

  return disabledApp.list
}

/**
 * 检测并设定某个用户的应用的内存限制。
 *
 * 单位：maxrss / rssOffset 是 **KB**（cdpc 侧轮询判定），maxRestart 是次数。
 * 跟 cgroup 的 memory（字节、内核强制）不是一套机制，别混。
 *
 * maxRestart 之前漏在列表外，导致配置文件里写了也不会被采纳 —— 而它是
 * cdpc 里真正会被读取的限额键（超过次数就转为停止，不再无限重启）。
 * maxtime / frequency / maxdaylimit 保留在列表里只为兼容老配置，
 * cdpc 当前并不读取它们。
 */
function checkAndSetLimit(chk, limitobj) {
  let limit_keys = ['maxrss', 'rssOffset', 'maxRestart', 'maxtime', 'frequency', 'maxdaylimit']

  let common_limit = {}
  for (let k of limit_keys) {
    if (limitobj[k] !== undefined && typeof limitobj[k] === 'number' && !isNaN(limitobj[k])) {
      common_limit[k] = limitobj[k]
    }
  }

  //如果存在通用的则采用通用的，否则采用精确的app控制。
  let lm = common_limit
  if (limitobj.app && limitobj.app[chk.name] && typeof limitobj.app[chk.name] === 'object') {
    lm = limitobj.app[chk.name]

    for (let k in common_limit) {
      if (lm[k] === undefined) {
        lm[k] = common_limit[k]
      }
    }
  }

  if (Object.keys(lm).length <= 0) return false;

  /**
   * 取更严格的那个（数值更小者胜出）。
   *
   * 但 maxrss 与 maxRestart 的 0 是「不限制」的哨兵值，不是「最严」——
   * 按数值比较的话，通用限额里写个 0 会把某个服务原本 maxrss 60000 的限制
   * 直接放开，方向正好反了。这两个键的 0 一律当作「未设置」跳过。
   * rssOffset 的 0 是真正的最严（不留宽容量），照常参与比较。
   */
  const UNLIMITED_ZERO = ['maxrss', 'maxRestart']

  for (let x of limit_keys) {
    !chk.limit && (chk.limit = {});

    if ( (lm[x] !== undefined) && (typeof lm[x] === 'number') && !isNaN(lm[x]) ) {
      if (lm[x] === 0 && UNLIMITED_ZERO.indexOf(x) >= 0) continue;

      ;((chk.limit[x] === undefined) || (chk.limit[x] > lm[x]))
        &&
      (chk.limit[x] = lm[x]);
    }
  }

  return lm
}

/**
 * [包A] 把 loadConfig 的结构化结果写成快照到 config-errors.log。
 * 覆盖式：每次加载反映当前配置目录的真实状态，便于 `cdpc config errors` 查看。
 */
let config_errors_file = `${logdir}/config-errors.log`

// [包C] 每应用 stdout/stderr 日志目录
let apps_logdir = `${logdir}/apps`
try_mkdir(apps_logdir)

/**
 * [包C] 应用日志：logs/apps/<name>.log 不只是 stdout/stderr 的转储，
 * 而是**这个服务的全部可观测信息**——启动、退出码/信号、spawn 失败原因。
 *
 * 之所以必须这样：spawn 失败（命令不存在等）时 Node 只发 'error'，
 * **不发 'exit'**，子进程的 stdout/stderr 虽然存在但永远没有数据。
 * 原实现只采集 stdout/stderr，于是"命令写错了"在应用日志里表现为
 * 一行 `pid=undefined 启动` 之后彻底安静——用户看不到任何有效信息。
 *
 * 写入流按**服务名**持有（不是按每次 spawn），原因有二：
 *   1. 重启循环下按 spawn 建流会churn fd，且 written 计数每次归零，轮转失效；
 *   2. 退出后仍需能写"退出/失败"记录，流不能随子进程一起关。
 */
const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024

// name -> {file, max, stream, written, lastLine, repeat}
const appLogSinks = new Map()

/**
 * 服务名直接拼进日志文件路径，所以**必须**先过一遍命名规则再用。
 * 这里的来源包括被 cdpc 拒绝的配置（比如 name 非法、含 / 或 ..），
 * 不校验就等于让配置文件决定往哪写文件。
 * 规则与 cdpc 的 _checkAppName 一致：字母或数字开头，仅含字母数字下划线减号，
 * 长度不超过 50（外加 @，与 CLI 的 check_config_filename 保持一致）。
 */
function isSafeAppName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_@-]{0,49}$/.test(name)
}

function openAppLogStream(file) {
  let s = fs.createWriteStream(file, {flags: 'a', mode: 0o644})
  s.on('error', err => clog.errorLog(err, '--ERR-APPLOG--'))
  return s
}

function getAppLogSink(name, maxBytes) {
  if (!isSafeAppName(name)) return null

  let sink = appLogSinks.get(name)
  if (sink) {
    // maxLogBytes 可能随 reload 变化，取最新的一次配置
    if (typeof maxBytes === 'number' && maxBytes > 0) sink.max = maxBytes
    return sink
  }

  let file = `${apps_logdir}/${name}.log`

  // written 从**文件实际大小**起算：daemon 重启后若从 0 起算，
  // 已经很大的文件会一直不轮转，直到再写满一个 max 才轮转。
  let written = 0
  try {
    written = fs.statSync(file).size
  } catch (err) {}

  sink = {
    file,
    max: (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : DEFAULT_MAX_LOG_BYTES,
    stream: openAppLogStream(file),
    written,
    lastLine: '',
    repeat: 0
  }

  appLogSinks.set(name, sink)

  return sink
}

// 轮转：当前文件改名为 .1（覆盖旧备份），原写入流的残留缓冲随 inode 落到 .1，
// 新建写入流接管 logs/apps/<name>.log。cdpcd 独占该文件 fd，rename 安全无竞态。
function rotateAppLog(sink) {
  let old = sink.stream
  try {
    fs.renameSync(sink.file, sink.file + '.1')
  } catch (err) {}
  sink.stream = openAppLogStream(sink.file)
  sink.written = 0
  try { old.end() } catch (err) {}
}

// 写入前判断轮转：保证当前 logs/apps/<name>.log 始终留有最新输出，
// 不会出现"刚轮转完当前文件为空、cdpc log 看不到东西"。
function appLogWrite(sink, chunk) {
  if (!sink || !sink.stream) return

  if (sink.written >= sink.max) {
    // `cdpc log --clear` 用 truncate 清空文件（不能 rm，流还开着），
    // 此时 written 是过时的高值。不核对真实大小就会把刚清空的文件
    // 轮转成 .1，白白毁掉上一份备份。
    let real = sink.written
    try {
      real = fs.statSync(sink.file).size
    } catch (err) {}

    if (real >= sink.max) {
      rotateAppLog(sink)
    } else {
      sink.written = real
    }
  }

  sink.stream.write(chunk)
  // 字符串的 .length 是 UTF-16 码元数，不是字节数：中文事件行会少算一半以上，
  // 轮转阈值随之失准（stdout/stderr 来的是 Buffer，.length 本就是字节）。
  sink.written += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
}

/**
 * 事件行（启动/退出/失败）统一格式，并折叠连续重复：
 * 重启循环里同一条失败信息每秒一遍会把真正的输出淹掉。
 */
function appLogEvent(sink, mark, text) {
  if (!sink) return

  let line = `${mark} [${(new Date()).toLocaleString()}] ${text}`

  if (line.substring(line.indexOf(']') + 1) === sink.lastLine) {
    sink.repeat += 1
    // 1,2,4,8... 次时才落一行，避免刷屏又不丢失"还在持续发生"的事实
    if ((sink.repeat & (sink.repeat - 1)) !== 0) return
    appLogWrite(sink, `${line}   （同样的记录已重复 ${sink.repeat} 次）\n`)
    return
  }

  sink.lastLine = line.substring(line.indexOf(']') + 1)
  sink.repeat = 0
  appLogWrite(sink, line + '\n')
}

/**
 * 供 cdpc 库以外的路径（beforeStartCallback 里的限额读取失败等）
 * 把带服务名的错误同时落到该服务自己的日志里。
 */
function appLogNotice(name, text) {
  // 名字不合法时没有对应的 <name>.log 可写，也不该凭它造文件；
  // 这类情况 clog 那条记录已经覆盖，直接跳过。
  appLogEvent(getAppLogSink(name), '!!', text)
}

/**
 * @param {object} ch    子进程句柄
 * @param {string} name  服务名
 * @param {number} maxBytes 单文件轮转阈值
 * @param {object} cm    CDPC 实例；退出时要回读 childs[name].cause
 */
function attachAppLog(ch, name, maxBytes, cm) {
  if (!ch) return

  let sink = getAppLogSink(name, maxBytes)
  if (!sink) return

  // spawn 失败时 ch.pid 是 undefined，直接打印会得到误导性的 `pid=undefined`
  appLogEvent(sink, '==', ch.pid
    ? `${name} 启动  pid=${ch.pid}`
    : `${name} 启动中（尚未拿到 pid）`)

  function onData(chunk) {
    appLogWrite(sink, chunk)
  }

  ch.stdout && ch.stdout.on('data', onData)
  ch.stderr && ch.stderr.on('data', onData)

  /**
   * prependListener 而不是 on：cdpc 自己的 exit 监听器是在 spawn 之后、
   * 调 callback（也就是本函数）之前挂上的，会排在前面先执行；而它在
   * restartDelay <= 0 时会**同步**调用 startChild，那里第一件事就是把
   * chk.cause 清空。排到它前面才读得到本次退出真正的 cause。
   */
  ch.prependListener('exit', (code, sig) => {
   /**
    * 整个函数体必须包在 try 里。排到 cdpc 的监听器前面之后，这里同步抛出
    * 会中断整条监听链，cdpc 自己那个设置 state=EXIT、释放 lockForStart、
    * 安排重启的处理器就不会执行——服务会静悄悄脱离托管。
    * 记日志的代价绝不能是把状态机打断，写日志失败就算了。
    */
   try {
    let parts = []
    if (code !== null && code !== undefined) parts.push(`code=${code}`)
    if (sig) parts.push(`signal=${sig}`)

    /**
     * cause 是 cdpc 内部对"为什么会走到这一步"的记录（'maxrss|restart|…'、
     * 'SIBLING-CONFLICT|…' 等）。它只写进 chk、不走 errorHandle，所以被内存
     * 限额打死的服务在日志里跟被人手动 kill 长得一模一样——都是一行
     * signal=SIGTERM。限额判定是**先设 cause 再触发 kill**，此刻那个值已经在了，
     * 顺手读出来拼进退出行即可，不必改动 cdpc 库。
     */
    let cur = cm && cm.childs && cm.childs[name]
    let cause = cur && cur.cause ? `  cause=${cur.cause}` : ''

    appLogEvent(sink, '==',
      `${name} 退出  ${parts.join('  ') || '（无退出码与信号）'}${cause}`)
   } catch (err) {}
  })

  // spawn 失败只有 error、没有 exit：这条是"命令不存在/无权限"唯一的现场
  ch.on('error', err => {
    appLogEvent(sink, '!!', `${name} 启动失败  ${err.code || 'ERROR'}: ${err.message}`)
  })
}

function writeConfigErrors(result) {
  let lines = []
  let ts = (new Date()).toLocaleString()

  lines.push(`# 配置加载报告 ${ts}`)
  lines.push(`# loaded: ${result.loaded.length}  skipped: ${result.skipped.length}  removed: ${result.removed.length}`)

  if (result.loaded.length > 0) {
    lines.push(`# 已加载: ${result.loaded.join(', ')}`)
  }
  if (result.removed.length > 0) {
    lines.push(`# 已移除: ${result.removed.join(', ')}`)
  }

  lines.push('')

  if (result.skipped.length === 0) {
    lines.push('（无配置错误）')
  } else {
    for (let s of result.skipped) {
      let loc = s.file || s.name || '-'
      if (s.index !== undefined) loc += ` [数组第 ${s.index} 项]`
      lines.push(`! [${s.code}] ${loc}`)
      lines.push(`    ${s.message}`)
    }
  }

  fs.writeFile(config_errors_file, lines.join('\n') + '\n', err => {
    err && clog.errorLog(err, '--ERR-WRITE-CONFIG-ERRORS--')
  })

  /**
   * config-errors.log 是覆盖式快照，只有主动 `cdpc config errors` 才看得到；
   * 配置被拒这件事本身必须留在时间序列日志里，否则"我明明加了配置却没这个服务"
   * 在 cdpcd.log 中完全没有痕迹。
   */
  for (let s of result.skipped) {
    let loc = s.file || s.name || '-'
    if (s.index !== undefined) loc += ` [数组第 ${s.index} 项]`

    clog.log({
      type: 'log',
      logname: 'CONFIG-SKIP',
      message: `[${s.code}] ${loc} : ${s.message}`,
      other: s.name || '-'
    })

    // 配置里写了服务名的，把原因也落到该服务自己的日志：
    // 用户排障的第一反应是 `cdpc log <名字>`，那里必须能看见"根本没被加载"。
    s.name && appLogNotice(s.name, `配置被拒绝，服务未加载：[${s.code}] ${s.message}`)
  }
}

/**
 * 进程树明细列表的上限。
 *
 * 库层默认 20 偏保守：`cdpc status <名字> -l` 稍微多几个 worker 就有一截看不到，
 * 而这个命令的用途恰恰是看清某一个服务。取多少是**策略**，归上层决定，
 * 库层只提供 setMaxTree 这个机制——跟 cgroup 限额那次的处置一致
 * （库层不再强加配额，策略归上层）。
 *
 * 允许用环境变量 CDPCD_MAX_TREE 覆盖。root 与普通用户的 daemon 跑的是同一份
 * cdpcd.js、读的是同一个 process.env，所以两边都生效；区别只在各自从哪儿拿到
 * 这个变量：
 *   · root daemon    —— systemd unit 的 EnvironmentFile（默认 /etc/cdpcd.env）
 *   · 用户 daemon    —— /etc/environment（root 写一次，对所有授权用户生效，
 *                        经 lib/baseenv.js 进入用户 daemon 的环境）
 *   · 用户 daemon    —— ~/.cdpcd_env（用户自己覆盖，优先级最高）
 *
 * 范围 [10, 200] 比库层的 [10, 10000] 窄：这是按真实场景收的口径——
 * 上限再高，每次采集就要多读同样数量的 /proc/<pid>/cmdline，而几百个进程的
 * 列表本身也早就超出"看得过来"的范畴了。采集有 800ms 节流，200 可接受。
 *
 * 合计（cpuTotal / memTotal / procCount）按整棵树求和，不受此值影响。
 */
const MAX_TREE_DEFAULT = 50
const MAX_TREE_MIN = 10
const MAX_TREE_MAX = 200

/**
 * 环境变量取值与校验。
 *
 * 非法值**退回默认并出声**，不抛——这跟 CDPC.setMaxTree 的抛出策略并不矛盾：
 * 那边的输入是程序员写死的调用，写错就该当场炸；这边的输入来自环境变量，
 * 一个笔误不该让整个 daemon 起不来。但也绝不能静默吞掉，否则就成了
 * "我明明设了却没生效"这类最难查的问题。
 */
function resolveMaxTree() {
  let raw = process.env.CDPCD_MAX_TREE

  if (raw === undefined || String(raw).trim() === '') {
    return {value: MAX_TREE_DEFAULT, source: ''}
  }

  let text = String(raw).trim()

  // 只认十进制整数：0x32 / 5e1 / +50 这类写法在环境变量里不该被"聪明地"接受
  if (!/^[0-9]+$/.test(text)) {
    return {
      value: MAX_TREE_DEFAULT,
      source: '',
      warn: `CDPCD_MAX_TREE=${text} 不是十进制整数，已忽略，仍用默认值 ${MAX_TREE_DEFAULT}`
    }
  }

  let n = parseInt(text, 10)

  if (n < MAX_TREE_MIN || n > MAX_TREE_MAX) {
    return {
      value: MAX_TREE_DEFAULT,
      source: '',
      warn: `CDPCD_MAX_TREE=${n} 超出允许范围 [${MAX_TREE_MIN}, ${MAX_TREE_MAX}]，`
        + `已忽略，仍用默认值 ${MAX_TREE_DEFAULT}`
    }
  }

  return {value: n, source: 'CDPCD_MAX_TREE'}
}

let maxTree = resolveMaxTree()

if (maxTree.warn) {
  clog.log({type: 'log', logname: 'MAX-TREE', message: maxTree.warn, other: 'warn'})
}

// 值域 [10,200] 完整落在 setMaxTree 的 [10,10000] 内，这里不可能抛
cdpc.setMaxTree(maxTree.value)

// 用了默认值就不记：那不是"设置"，记了只是噪音。被环境变量改过才值得留痕。
if (maxTree.source) {
  clog.log({
    type: 'log',
    logname: 'MAX-TREE',
    message: `进程树明细列表上限设为 ${maxTree.value}`,
    other: maxTree.source
  })
}

/**
 * cdpc会监听signals配置的信号，notExit用于控制是否在收到信号以后退出。
 * notExitButSpread设置为true，可以在不退出的情况下扩散信号。
 */
const cm = new cdpc({
  //notExit: true,
  loadInfoFile: loadfile,
  showColor: true,
  loadInfoType: 'json',
  config: config_path,
  sockFile: sockfile,
  stateDir: statedir,
  debug: args.debug,
  errorHandle: clog.errorLog.bind(clog),
  onLoadConfig: writeConfigErrors,
  cgroupBaseDir: cgroupBaseDir,
  beforeStartCallback: (chk) => {
    let real_list = getDisabledApp()
    if (real_list.includes(chk.name)) {
      chk.disabled = true
    }

    /**
     * cdpc 的 checkConfig 只在配了 file 时才强制 command：既没有 file、
     * 也没有 command 的配置会被**接受**——服务注册进去却永远停在 PREPARE，
     * cause 为空、没有进程、没有日志，排障时完全无从下手。
     * cdpc 版本已锁定在 6.1.2，护栏补在这里，至少要出声。
     */
    if (chk.name && !chk.command && !chk.file) {
      let msg = `${chk.name}: 配置里既没有 command 也没有 file，`
        + `该服务无法启动，会一直停在 PREPARE。`

      clog.log({
        type: 'log',
        logname: 'CONFIG-INVALID',
        message: msg,
        other: chk.configPath || '-'
      })

      appLogNotice(chk.name, msg)
    }

    // [包C] 应用日志：stdout/stderr 改 pipe，并把采集挂到 cdpc 的 callback 钩子上。
    //   stdio 是常量配置，设一次即可；callback 每次 spawn 都会被调用（含重启）。
    if (chk.name) {
      chk.options = chk.options || {}
      let stdio = Array.isArray(chk.options.stdio)
        ? chk.options.stdio.slice()
        : ['ignore', 'ignore', 'ignore']
      stdio[1] = 'pipe'
      stdio[2] = 'pipe'
      chk.options.stdio = stdio

      let logName = chk.name
      let logMax = chk.maxLogBytes

      // 幂等包装：beforeStartCallback 在每次 add/load 都会跑一遍，
      // 不打标记的话包装会层层叠加，同一次 spawn 挂上 N 份采集器 → 日志重复 N 份。
      let prevCb = chk.callback
      if (!prevCb || prevCb.__applogWrapped !== true) {
        let wrapped = (ch, cm, c) => {
          attachAppLog(ch, logName, logMax, cm)
          typeof prevCb === 'function' && prevCb(ch, cm, c)
        }
        wrapped.__applogWrapped = true
        chk.callback = wrapped
      }

      /**
       * cdpc 的 errorHandle 收到的 spawn 错误（如 `spawn xxx ENOENT`）
       * **不带服务名**，落到 cdpcd.log 里是一条无主的错误，现场无从定位。
       * onError 是 cdpc 提供的每服务错误钩子，名字就在闭包里。
       */
      let prevOnError = chk.onError
      if (!prevOnError || prevOnError.__applogWrapped !== true) {
        let onErr = (err) => {
          clog.errorLog(err, `--ERR-CHILD--[${logName}]`)
          typeof prevOnError === 'function' && prevOnError(err)
        }
        onErr.__applogWrapped = true
        chk.onError = onErr
      }
    }

    //检测并设定相关limit
    try {
      let limit_path = __dirname + '/limit/' + username + '.js'
      fs.accessSync(limit_path)
      let limitobj = require(limit_path)
      limitobj && typeof limitobj === 'object' && checkAndSetLimit(chk, limitobj)
    } catch (err) {
      args.debug && err.code !== 'ENOENT' && console.error(err);
      if (err.code !== 'ENOENT') {
        clog.errorLog(err, '--ERR-SET-LIMIT--')
        // 限额没读进来，服务却照跑——这属于"静默失效"，必须落到该服务自己的日志
        appLogNotice(chk.name, `限额配置读取失败，本服务当前未应用 limit：${err.message}`)
      }
    }
  }
})

if (euid === 0) {
  let os = require('os')
  let totalmem = os.totalmem()
  let totalCPU = os.cpus().length

  /**
   * 这些 create 是异步的且不能在 CJS 顶层 await。失败时（典型是
   * subtree_control 写入 EBUSY、cgroup v1 系统、权限不足）必须记下来 ——
   * 否则 groupTable 里没有这个组，后面所有配了 cgroup 的服务都入不了组，
   * 而现场只能看到一堆 --WARN-CGROUP-ATTACH-- 却不知道根因在这里。
   *
   * memory / pids 的单位：memory 是**字节**（cgroup v2 memory.max），
   * pids 是进程数。cpu 是 [quota, period] 微秒。
   */
  const mkgrp = (name, detail) => {
    Promise.resolve(cm.cgroup.create(name, detail)).catch(err => {
      args.debug && console.error(`[cgroup] 创建 ${name} 失败: ${err.message}`)
      clog.errorLog(err, '--ERR-CGROUP-CREATE--')
    })
  }

  let maxPids = 'max'
  if (totalCPU <= 2) {
    maxPids = 200
  } else {
    maxPids = 128 * (totalCPU - 1)
  }

  /**
   * CPU 配额按核数缩放。
   *
   * cgroup v2 的 cpu.max 是 `quota period`，它表示的是**多少个 CPU**，
   * 跟机器核数无关：
   *   · 内核文档：the group may consume up to $MAX in each $PERIOD duration
   *   · systemd CPUQuota= （控制的就是 cpu.max）：the percentage specifies how much
   *     CPU time the unit shall get at maximum, relative to the total CPU time
   *     available on **one** CPU；use values > 100% for more than one CPU
   *   · Docker：--cpus=1.5 等价于 --cpu-quota=150000 --cpu-period=100000
   *
   * 所以早先写的 [86500, 100000] 并不是「全机 86.5%」，而是 **0.865 个 CPU** ——
   * 组名叫 85-limit，在 16 核机器上实际只给到全机 5%；user-auth-limit 写
   * 98600 本意是「几乎不限」，实际是不到一个核。
   * 同一段代码里 memory 用 totalmem * 比例、pids 用 128 * (totalCPU - 1)，
   * 都按机器规模缩放，只有 cpu 漏了乘核数。
   *
   * 现在统一用 pctCPU(百分比)：单核机器上结果与旧值一致，多核按比例放大。
   */
  const CPU_PERIOD = 100000

  const pctCPU = pct => {
    // 内核硬下限 quota >= 1000µs；这些预设值不会触碰到，兜一下防止将来改小
    let quota = Math.max(1000, Math.round(pct / 100 * totalCPU * CPU_PERIOD))
    return [quota, CPU_PERIOD]
  }

  args.debug && console.error(`[cgroup] ${totalCPU} 核，预设组 CPU 配额按核数缩放`
    + `（例：85% → ${pctCPU(85).join(' ')} = ${(pctCPU(85)[0] / CPU_PERIOD).toFixed(2)} 个 CPU）`)

  mkgrp('cdpcd-user-auth-limit', {
    cpu: pctCPU(98.6),
    memory: parseInt(totalmem * 0.85),
    pids: maxPids
  })
  
  //提高CPU占用，但是内存限制比较低
  mkgrp('cdpcd-hclm-limit', {
    cpu: pctCPU(98.5),
    memory: parseInt(totalmem * 0.42),
    pids: parseInt(maxPids * 0.42),
    cpus: '%90'
  })

  //为了限制内存占用爆满导致系统崩溃
  mkgrp('cdpcd-mem-limit', {
    cpu: pctCPU(89),
    memory: parseInt(totalmem * 0.36),
    pids: parseInt(maxPids * 0.36),
    cpus: '%80'
  })

  mkgrp('cdpcd-cpu-limit', {
    cpu: pctCPU(35),
    memory: parseInt(totalmem * 0.35),
    pids: parseInt(maxPids * 0.35),
    cpus: '%35'
  })
  
  mkgrp('cdpcd-85-limit', {
    cpu: pctCPU(86.5),
    memory: parseInt(totalmem * 0.72),
    pids: parseInt(maxPids * 0.7)
  })

  mkgrp('cdpcd-80-limit', {
    cpu: pctCPU(80),
    memory: parseInt(totalmem * 0.65),
    pids: parseInt(maxPids * 0.7)
  })
  
  mkgrp('cdpcd-70-limit', {
    cpu: pctCPU(70),
    memory: parseInt(totalmem * 0.55),
    pids: parseInt(maxPids * 0.6)
  })

  mkgrp('cdpcd-50-limit', {
    cpu: pctCPU(50),
    memory: parseInt(totalmem * 0.4),
    pids: parseInt(maxPids / 2),
    cpus: '%50+'
  })
  
  mkgrp('cdpcd-25-limit', {
    cpu: pctCPU(25),
    memory: parseInt(totalmem * 0.25),
    cpus: '%25=',
    pids: 25
  })
}

//捕获所有异常，保证服务稳定运行。但是不会做信号监听处理。
cm.strong();

/**
 * cdpc默认已经对SIGTERM、SIGALRM、SIGABRT、SIGQUIT、SIGINT进行了处理。
 * notExit开启，会直接忽略这些信号。
 */
cm.dynamicStep = 2
cm.setStepSlice(100)
cm.setMaxStep(10, 28)

process.on('exit', code => {
  try {
    fs.unlinkSync(loadfile)
  } catch (err) {}
})

/**
 * 信号处理：
 * - root cdpcd 由 systemd 托管，响应 SIGTERM 优雅退出（配合 unit 的 KillMode=mixed）。
 * - 用户级 cdpcd 不是 systemd 服务，忽略 SIGTERM，避免同身份子进程用信号杀死它，
 *   停机时由 systemd 对 cgroup 子树的 SIGKILL 收尾。
 */
if (args.debug) {
  process.on('SIGTERM', sig => {
    console.error('Debug：收到信号 SIGTERM')
    process.exit(0)
  })

  process.on('SIGINT', sig => {
    console.error('Debug：收到信号 SIGINT')
    process.exit(0)
  })
} else {
  if (euid === 0) {
    // 响应 systemctl stop 的 SIGTERM；process.exit 会触发 process.on('exit')
    // 清理与 cdpc 的 killChilds。
    process.on('SIGTERM', () => process.exit(0))
    process.on('SIGINT', sig => {})
  } else {
    process.on('SIGTERM', sig => {})
  }
}

if (euid === 0) {
  // 延迟一小段再加载：等 cgroup 子树初始化完成
  setTimeout(() => {
    cm.loadConfig()
    cm.monitorStart()
  }, 235)
} else {
  cm.loadConfig()
  cm.monitorStart()
}
