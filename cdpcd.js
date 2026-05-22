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

const fsp = fs.promises

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
let loadfile = '/tmp/cdpcd-load.log';
let event_dir = '/tmp/cdpcd_watch';
let logfile = `${__dirname}/logs/cdpcd.log`;
let pidfile = __dirname + '/logs/cdpcd-pid';
let logdir = __dirname + '/logs';

let euid = process.geteuid();

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
  let local_path = `${process.env.HOME}/.cdpc`;

  config_path = `${local_path}/config`;
  config_disabled_path = `${config_path}/disabled`;
  logdir = `${local_path}/logs`;
  
  loadfile = `${local_path}/cdpcd-load.log`;
  event_dir = `${local_path}/watch`;

  logfile = `${logdir}/cdpcd.log`;

  pidfile = `${local_path}/cdpcd-pid`;

  try_mkdir(local_path)
  try_mkdir(config_path)
  try_mkdir(config_disabled_path)
  try_mkdir(event_dir)
  try_mkdir(logdir)
  process.chdir(local_path)
}

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

//检测并设定某个用户的应用的内存限制
function checkAndSetLimit(chk, limitobj) {
  let limit_keys = ['maxrss', 'rssOffset', 'maxtime', 'frequency', 'maxdaylimit']

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

  for (let x of limit_keys) {
    !chk.limit && (chk.limit = {});

    if ( (lm[x] !== undefined) && (typeof lm[x] === 'number') && !isNaN(lm[x]) ) {
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
 * [包C] 应用日志：把子进程 stdout/stderr 采集到 logs/apps/<name>.log。
 *
 * 子进程一律非 detached（与 cdpcd 同生死），所以 cdpcd 始终在写入路径上：
 * 由 cdpcd 持有写入流，按累计字节数轮转（rename→reopen，单备份 .1）。
 * cdpc 不参与日志，capture 全在此处，通过 cdpc 现成的 callback 钩子挂载。
 */
const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024

function attachAppLog(ch, name, maxBytes) {
  if (!ch || !ch.stdout || !ch.stderr) return

  let file = `${apps_logdir}/${name}.log`
  let max = (typeof maxBytes === 'number' && maxBytes > 0) ? maxBytes : DEFAULT_MAX_LOG_BYTES

  let stream = fs.createWriteStream(file, {flags: 'a', mode: 0o644})
  stream.on('error', err => clog.errorLog(err, '--ERR-APPLOG--'))
  stream.write(`\n===== [${(new Date()).toLocaleString()}] ${name} pid=${ch.pid} 启动 =====\n`)

  let written = 0

  // 轮转：当前文件改名为 .1（覆盖旧备份），原写入流的残留缓冲随 inode 落到 .1，
  // 新建写入流接管 logs/apps/<name>.log。cdpcd 独占该文件 fd，rename 安全无竞态。
  function rotate() {
    let old = stream
    try {
      fs.renameSync(file, file + '.1')
    } catch (err) {}
    stream = fs.createWriteStream(file, {flags: 'a', mode: 0o644})
    stream.on('error', err => clog.errorLog(err, '--ERR-APPLOG--'))
    written = 0
    try { old.end() } catch (err) {}
  }

  // 写入前判断轮转：保证当前 logs/apps/<name>.log 始终留有最新输出，
  // 不会出现"刚轮转完当前文件为空、applog 看不到东西"。
  function onData(chunk) {
    if (!stream) return
    if (written >= max) rotate()
    stream.write(chunk)
    written += chunk.length
  }

  ch.stdout.on('data', onData)
  ch.stderr.on('data', onData)

  let closed = false
  function closeStream() {
    if (closed) return
    closed = true
    let s = stream
    stream = null
    // 延迟一点，让管道里残留数据落盘后再关闭
    s && setTimeout(() => { try { s.end() } catch (err) {} }, 200)
  }

  ch.on('exit', closeStream)
  ch.on('error', closeStream)
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
  eventDir: event_dir,
  debug: args.debug,
  errorHandle: clog.errorLog.bind(clog),
  onLoadConfig: writeConfigErrors,
  cgroupBaseDir: cgroupBaseDir,
  beforeStartCallback: (chk) => {
    let real_list = getDisabledApp()
    if (real_list.includes(chk.name)) {
      chk.disabled = true
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
      let prevCb = chk.callback
      chk.callback = (ch, cm, c) => {
        attachAppLog(ch, logName, logMax)
        typeof prevCb === 'function' && prevCb(ch, cm, c)
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
      err.code !== 'ENOENT' && clog.errorLog(err, '--ERR-SET-LIMIT--')
    }
  }
})

if (euid === 0) {
  let os = require('os')
  let totalmem = os.totalmem()
  let totalCPU = os.cpus().length

  let maxPids = 'max'
  if (totalCPU <= 2) {
    maxPids = 200
  } else {
    maxPids = 128 * (totalCPU - 1)
  }

  cm.cgroup.create('cdpcd-user-auth-limit', {
    cpu: [98600, 100000],
    memory: parseInt(totalmem * 0.85),
    pids: maxPids
  })
  
  //提高CPU占用，但是内存限制比较低
  cm.cgroup.create('cdpcd-hclm-limit', {
    cpu: [98500, 100000],
    memory: parseInt(totalmem * 0.42),
    pids: parseInt(maxPids * 0.42),
    cpus: '%90'
  })

  //为了限制内存占用爆满导致系统崩溃
  cm.cgroup.create('cdpcd-mem-limit', {
    cpu: [89000, 100000],
    memory: parseInt(totalmem * 0.36),
    pids: parseInt(maxPids * 0.36),
    cpus: '%80'
  })

  cm.cgroup.create('cdpcd-cpu-limit', {
    cpu: [35000, 100000],
    memory: parseInt(totalmem * 0.35),
    pids: parseInt(maxPids * 0.35),
    cpus: '%35'
  })
  
  cm.cgroup.create('cdpcd-85-limit', {
    cpu: [86500, 100000],
    memory: parseInt(totalmem * 0.72),
    pids: parseInt(maxPids * 0.7)
  })

  cm.cgroup.create('cdpcd-80-limit', {
    cpu: [80000, 100000],
    memory: parseInt(totalmem * 0.65),
    pids: parseInt(maxPids * 0.7)
  })
  
  cm.cgroup.create('cdpcd-70-limit', {
    cpu: [70000, 100000],
    memory: parseInt(totalmem * 0.55),
    pids: parseInt(maxPids * 0.6)
  })

  cm.cgroup.create('cdpcd-50-limit', {
    cpu: [50000, 100000],
    memory: parseInt(totalmem * 0.4),
    pids: parseInt(maxPids / 2),
    cpus: '%50+'
  })
  
  cm.cgroup.create('cdpcd-25-limit', {
    cpu: [25000, 100000],
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

function addChildApp(msg, cm) {
  if (msg.config) {
    if (Array.isArray(msg.config))
        cm.runChilds(msg.config);
    else
        cm.runChilds([ msg.config ]);
  }
}

function postLog(msg, cm) {
  clog.log(msg)
}

async function set_disabled_state(op, name) {
  let dfile = config_disabled_path + '/' + name

  if (op === 'disable' || op === 'disabled') {
    await fsp.access(dfile)
            .catch(err => {
              fsp.writeFile(dfile, (new Date).toLocaleString(), {encoding: 'utf8'})
                  .catch(err => {
                    err && clog.log({
                      type: 'error',
                      ...err,
                      errname: '--ERR-DISABLED-APP--'
                    })
                  })
            })
  } else {
    await fsp.access(dfile)
            .then(async () => {
              await fsp.unlink(dfile)
                        .catch(err => {
                          return fsp.unlink(dfile)
                        })
                        .catch(err => {
                          err && clog.log({
                            type: 'error',
                            ...err,
                            errname: '--ERR-ENABLE-APP--'
                          })
                        })
            })
            .catch(err => {})
  }
}

function webServerMessage(ch) {
  ch.on('message', (msg, handle) => {
    if (msg.op) {
        switch (msg.op) {
          case 'disable':
          case 'enable':
            set_disabled_state(msg.op, msg.name);
  
          case 'restart':
          case 'start':
          case 'pause':
          case 'stop':
          case 'resume':
          case 'remove':
            msg.name && cm[msg.op](msg.name);
            break;
  
          //提交日志
          case 'log':
            postLog(msg, cm);
            break;
  
          case 'add':
            addChildApp(msg, cm);
            break;
  
          case 'saveRemove':
            msg.name && cm.safeRemove(msg.name);
            break;
  
          case 'remove':
            msg.name && cm.remove(msg.name);
            break;
        }
    }
  });
}

let webServer = {
  name: 'cdpcd-web-server',
  file: __dirname + '/webserver/app.js',
  restart: 'always',
  restartDelay: 1000,
  monitor: true,
  lockReload: true,
  monitorNetData: true,
  cgroup: 'cdpcd-50-limit',
  options: {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  },
  callback: webServerMessage
}

process.on('exit', code => {
  try {
    fs.unlinkSync(loadfile)
  } catch (err) {}
})

/**
 * 避免同身份用户的子进程发送信号导致主服务进程退出
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
  process.on('SIGTERM', sig => {})
  euid === 0 && process.on('SIGINT', sig => {})
}

if (euid === 0) {
  setTimeout(() => {
    cm.runChilds([webServer])
    cm.loadConfig()
    cm.monitorStart()
  }, 235)
} else {
  cm.loadConfig()
  cm.monitorStart()
}
