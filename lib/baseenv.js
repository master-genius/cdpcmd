'use strict'

/**
 * 授权用户 daemon 的**基线环境变量**构建器（root 侧）。
 *
 * 设计要点：
 *
 * 1. Linux 上不存在"某个用户的环境变量"这种静态实体——它是登录那一刻由
 *    pam_env → /etc/environment → /etc/profile(.d) → ~/.profile 现场构造的。
 *    想"全部拿到"只能模拟一次登录（su -/runuser -l），而那条路被否决：
 *      - 值会变成用户可控，而生成的 config/user@X.js 是 **root require 的**，
 *        一个单引号就是提权；
 *      - 生成的配置用 stdio ['ignore','ignore','ignore','ipc']，IPC 通道是承重的，
 *        经 su exec 一层 NODE_CHANNEL_FD 传不过去，监管链会断；
 *      - 快照语义在用户改 profile 后不生效，更难排障。
 *    因此这里只读 **root 可信来源**：/etc/passwd、/etc/environment、locale 配置。
 *    用户自定义的部分交给 ~/.cdpcd_env，由用户自己身份的 cdpcd 加载
 *    （见 lib/envfile.js 的 loadUserEnv）。
 *
 * 2. 本模块由生成的配置在 **load 时** 调用，而不是 auth 时快照。
 *    管理员改了系统 locale 或 /etc/environment，重新 load 即生效，
 *    不需要为每个用户重跑 cdpc auth；同时 auth.js 里彻底没有 env 代码生成，
 *    注入面归零。这与该文件里已有的"配置在 load 时重新 getUser() 解析 uid"
 *    是同一套路。
 *
 * 3. 优先级（高 → 低）：
 *      身份类（HOME/USER/LOGNAME/SHELL）> PATH > locale > /etc/environment 其余项
 *    身份类永远不允许被 /etc/environment 覆盖。
 */

const fs = require('fs')
const {execFileSync} = require('child_process')
const {getUserTable} = require('./getuser.js')
const {parse, sanitizePath} = require('./envfile.js')

/** /etc/environment 缺 PATH 时的兜底（Debian/Ubuntu 传统值） */
const DEFAULT_SYS_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

/** locale 配置文件：Debian/Ubuntu、systemd(RHEL/Arch)、老 RHEL */
const LOCALE_FILES = ['/etc/default/locale', '/etc/locale.conf', '/etc/sysconfig/i18n']

/**
 * LC_ALL 故意不采纳：它会压过所有分类，下游再想按分类调整就没救了。
 * LANGUAGE 是 gettext 的语言优先级列表（形如 en_US:en），不是 locale 名，
 * 因此不参与 locale -a 校验。
 */
const LOCALE_KEY_RE = /^(LANG|LANGUAGE|LC_[A-Z]+)$/

/**
 * 兜底 locale 用 C.UTF-8 而不是 en_US.UTF-8：
 * C.UTF-8 内建于 glibc >= 2.26，一定存在；en_US.UTF-8 需要系统实际生成过，
 * 没生成就会让所有程序刷 "cannot change locale" 告警。
 * 规范格式是 language[_TERRITORY][.codeset][@modifier]，分隔符是 '.' 不是 '-'。
 */
const FALLBACK_LANG = 'C.UTF-8'

/** 这些键的值由 passwd 决定，不接受任何外部文件覆盖 */
const IDENTITY_KEYS = new Set(['HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'OLDPWD', 'SHLVL', '_'])

/** 读取 KEY=VALUE 形式的系统文件（pam_env 格式，不做变量展开），失败返回 {} */
function readSysFile(file) {
  try {
    let text = fs.readFileSync(file, {encoding: 'utf8'})
    return parse(text, {expand: false}).env
  } catch (err) {
    return {}
  }
}

/**
 * locale 名归一化，仅用于与 locale -a 的输出比对。
 * locale -a 输出的是规范化形式（en_US.utf8 / C.utf8），
 * 而配置文件里写的是 en_US.UTF-8，直接字符串比对必然失配。
 * 归一化规则：整体小写，codeset 段去掉非字母数字字符。
 * 注意：**比对用归一化形式，写进环境变量的仍是配置文件里的原始拼写**。
 */
function normalizeLocale(name) {
  let s = String(name).trim().toLowerCase()

  let at = s.indexOf('@')
  let mod = at >= 0 ? s.slice(at) : ''
  if (at >= 0) s = s.slice(0, at)

  let dot = s.indexOf('.')
  if (dot >= 0) {
    s = s.slice(0, dot) + '.' + s.slice(dot + 1).replace(/[^a-z0-9]/g, '')
  }

  return s + mod
}

/**
 * 系统已生成的 locale 集合（归一化后），**按进程生命周期缓存**。
 *
 * 必须缓存：loadConfig 对每个配置文件都 delete require.cache 后重新 require，
 * 所以每次 load/reload 每个授权用户都会走一遍 build()。不缓存就是
 * "授权用户数 × 每次 reload" 次同步 spawn 卡在 root daemon 的事件循环上，
 * locale 慢（NFS 上的 /usr、超大 locale-archive）时会放大成数十秒的停顿。
 *
 * 代价：locale-gen 新增 locale 后，要等 daemon 重启才会被校验认可。
 * 这个方向是对的——已生成 locale 集合只在有人跑 locale-gen 时变，
 * 而 locale 配置文件是手改的（那部分不缓存，reload 即生效）。
 *
 * 拿不到（没有 locale 命令、执行失败）返回 null —— 校验必须**失败开放**：
 * 因为缺个二进制就把所有人降级到 C.UTF-8，比不校验更糟。
 */
let _localeCache
let _localeCached = false

function availableLocales() {
  if (_localeCached) return _localeCache

  _localeCached = true
  _localeCache = _readAvailableLocales()

  return _localeCache
}

function _readAvailableLocales() {
  try {
    let out = execFileSync('locale', ['-a'], {encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore']})
    let set = new Set()
    for (let l of out.split('\n')) {
      l = l.trim()
      if (l) set.add(normalizeLocale(l))
    }
    return set.size > 0 ? set : null
  } catch (err) {
    return null
  }
}

/**
 * 解析系统 locale 配置。
 * @returns {{vars:object, fallback:string|null}} fallback 为 null 表示系统连
 *          C.UTF-8 都没有，此时宁可不设 LANG。
 */
function resolveLocale() {
  let picked = {}

  for (let f of LOCALE_FILES) {
    let e = readSysFile(f)
    let got = {}

    for (let k in e) {
      if (!LOCALE_KEY_RE.test(k)) continue
      if (k === 'LC_ALL') continue
      if (!e[k]) continue          // LANG= 这种空值等于没配
      got[k] = e[k]
    }

    if (Object.keys(got).length > 0) {
      picked = got
      break
    }
  }

  let avail = availableLocales()
  let vars = {}

  for (let k in picked) {
    // LANGUAGE 不是 locale 名，跳过校验
    if (k !== 'LANGUAGE' && avail && !avail.has(normalizeLocale(picked[k]))) continue
    vars[k] = picked[k]
  }

  let fallback = (!avail || avail.has(normalizeLocale(FALLBACK_LANG))) ? FALLBACK_LANG : null

  return {vars, fallback}
}

/**
 * 构建指定 uid 的基线环境。
 * @param {number} uid
 * @returns {object} 供 spawn 的 options.env 使用（整体替换语义）
 */
function build(uid) {
  let {idtable} = getUserTable()
  let u = idtable[String(uid)]

  if (!u || !u.home || u.home === '/') {
    throw new Error(`baseenv: uid ${uid} 在 /etc/passwd 中不存在，或主目录无效`)
  }

  let etc = readSysFile('/etc/environment')
  let env = {}

  // 最低优先级：/etc/environment 的其余变量铺底
  for (let k in etc) {
    if (k === 'PATH' || IDENTITY_KEYS.has(k)) continue
    env[k] = etc[k]
  }

  // locale：比 /etc/environment 更专门，覆盖之
  let loc = resolveLocale()
  Object.assign(env, loc.vars)
  if (!env.LANG && loc.fallback) env.LANG = loc.fallback

  // 身份类：最高优先级，只认 passwd
  env.HOME = u.home
  env.USER = u.user
  env.LOGNAME = u.user
  env.SHELL = u.shell || '/bin/sh'

  /**
   * PATH：系统段优先用 /etc/environment 的值（比硬编码列表准确，
   * 通常还带 /snap/bin、/usr/games 之类本机实际存在的目录），
   * 再前置用户级 bin 目录。
   * ~/.local/bin 必须在：pip install --user、pipx、cargo 装的东西都在那儿，
   * 顺序按 Debian/Fedora 的 ~/.profile 惯例排在 ~/bin 之前。
   */
  let sysPath = etc.PATH || DEFAULT_SYS_PATH
  env.PATH = sanitizePath(`${u.home}/.local/bin:${u.home}/bin:${sysPath}`).path

  return env
}

module.exports = {
  build,
  resolveLocale,
  normalizeLocale,
  DEFAULT_SYS_PATH,
  FALLBACK_LANG
}
