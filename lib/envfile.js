'use strict'

/**
 * .env 风格文件解析器（自研，刻意不用 util.parseEnv）。
 *
 * 为什么不用 util.parseEnv：
 *   1. 它不做任何变量展开。`export PATH="$PATH:/opt/bin"` 会被原样解析成字面量
 *      `$PATH:/opt/bin`，整个 PATH 被毁掉且不报错——而"追加 PATH"恰恰是这个
 *      功能最主要的使用场景。
 *   2. 它剥掉引号后不再保留单/双引号信息，事后补一遍展开会把单引号里的
 *      `$VAR` 也误展开，语义是错的。
 *
 * 本解析器的语义（贴近 shell，但刻意受限）：
 *   - 支持 `export KEY=VALUE` 前缀
 *   - 单引号：完全字面量，不展开、不转义
 *   - 双引号 / 裸值：展开 $VAR 与 ${VAR}；反斜杠可转义 \$ \" \\ \` 与行尾续行
 *   - 展开的查找底座 = 传入的 lookup + 本文件中先前已定义的键（顺序相关）
 *   - 未定义的变量展开为空串（shell 语义）
 *   - **不支持命令替换**：双引号/裸值中出现未转义的 $( 或反引号，拒绝该行并告警。
 *     单引号内是纯字面量，不受此限。
 *   - 单行出错只跳过该行并记 warning，绝不中止整个文件——一个笔误静默清空
 *     用户全部环境变量是必须避免的失效模式。
 */

const fs = require('fs')

// 转义过的 $ 先替换成哨兵，展开完再还原，避免 \$ 被当成变量引用
const ESC_DOLLAR = '\u0000'

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * 这些键由 cdpcd 的启动逻辑决定，用户文件不允许覆盖：
 *   HOME  —— cdpcd.js 靠它定位 ~/.cdpc（配置与 sock 同源），改了会造成
 *            "配置在 A、通道在 B"的错位
 *   USER / LOGNAME —— 身份标识，与实际 uid 不符会误导所有被托管服务
 *   NODE_OPTIONS   —— 可以给 daemon 自身注入 --require，等同任意代码执行
 * 注意：禁止作为**赋值目标**，不禁止作为**展开来源**——
 *       `FOO="$HOME/x"` 合法，`HOME=/tmp` 被拒。
 */
const FORBIDDEN_KEYS = new Set(['HOME', 'USER', 'LOGNAME', 'NODE_OPTIONS'])

const MAX_BYTES = 64 * 1024
const MAX_KEYS = 512

/**
 * 从 start 位置开始读一段引号包裹的值，允许跨行。
 * @returns {{value:string, end:number, lineIndex:number, ok:boolean, hasCmdSub:boolean}}
 *          end 是闭合引号在当前行中的下标；ok=false 表示到文件尾都没闭合。
 */
function readQuoted(lines, lineIndex, text, start, quote) {
  let escapable = quote === '"'
  let out = ''
  let i = start
  let cur = text
  let hasCmdSub = false

  for (;;) {
    // 本行是否以反斜杠续行（续行不产生换行符，普通换行才产生）
    let cont = false

    while (i < cur.length) {
      let c = cur[i]

      if (escapable && c === '\\') {
        let n = cur[i + 1]

        if (n === undefined) {
          // 行尾续行：吃掉换行，继续读下一行
          i += 1
          cont = true
          break
        }

        if (n === '$') { out += ESC_DOLLAR; i += 2; continue }
        if (n === '"' || n === '\\' || n === '`') { out += n; i += 2; continue }

        // shell 里双引号内其余的反斜杠保持字面
        out += c
        i += 1
        continue
      }

      if (c === quote) {
        return {value: out, end: i, lineIndex, ok: true, hasCmdSub}
      }

      if (escapable) {
        if (c === '`') hasCmdSub = true
        if (c === '$' && cur[i + 1] === '(') hasCmdSub = true
      }

      out += c
      i += 1
    }

    // 当前行读完仍未闭合 → 续读下一行
    lineIndex += 1
    if (lineIndex >= lines.length) {
      return {value: out, end: -1, lineIndex, ok: false, hasCmdSub}
    }

    if (!cont) out += '\n'

    cur = lines[lineIndex]
    i = 0
  }
}

/** 处理裸值（无引号）的转义，并顺带检测命令替换 */
function unescapeBare(text) {
  let out = ''
  let hasCmdSub = false
  let i = 0

  while (i < text.length) {
    let c = text[i]

    if (c === '\\') {
      let n = text[i + 1]
      if (n === undefined) { i += 1; continue }
      out += (n === '$') ? ESC_DOLLAR : n
      i += 2
      continue
    }

    if (c === '`') hasCmdSub = true
    if (c === '$' && text[i + 1] === '(') hasCmdSub = true

    out += c
    i += 1
  }

  return {value: out, hasCmdSub}
}

function expandVars(text, lookup) {
  return text.replace(VAR_RE, (m, braced, bare) => {
    let name = braced || bare
    let v = lookup[name]
    return v === undefined ? '' : String(v)
  })
}

/**
 * 解析 .env 风格文本。
 * @param {string} text
 * @param {object} [opts] expand=false 关闭变量展开（用于 /etc/environment 这类
 *                        pam_env 格式文件）；lookup 是展开的查找底座。
 * @returns {{env:object, warnings:string[]}}
 */
function parse(text, opts = {}) {
  const expand = opts.expand !== false
  const maxKeys = opts.maxKeys || MAX_KEYS
  const lookup = Object.assign({}, opts.lookup || {})

  const env = {}
  const warnings = []

  let lines = String(text).replace(/^\uFEFF/, '').split('\n')
  let i = 0

  while (i < lines.length) {
    let lineno = i + 1
    let raw = lines[i]
    let head = raw.replace(/^[ \t]+/, '')

    i += 1

    if (head === '' || head[0] === '#') continue

    // export 前缀
    head = head.replace(/^export[ \t]+/, '')

    let eq = head.indexOf('=')
    if (eq < 0) {
      warnings.push(`第 ${lineno} 行：缺少 '='，已跳过`)
      continue
    }

    let key = head.slice(0, eq).replace(/[ \t]+$/, '')
    if (!KEY_RE.test(key)) {
      warnings.push(`第 ${lineno} 行：键名 "${key}" 不合法（须匹配 [A-Za-z_][A-Za-z0-9_]*），已跳过`)
      continue
    }

    // rest 是 raw 的后缀，用长度差换算它在原行中的起始下标，跨行读取才对得上
    let rest = head.slice(eq + 1).replace(/^[ \t]+/, '')
    let restOffset = raw.length - rest.length

    let value
    let quote = rest[0]

    if (quote === '"' || quote === "'") {
      let r = readQuoted(lines, i - 1, raw, restOffset + 1, quote)

      if (!r.ok) {
        // 无法判断值到哪里结束，只能放弃后续内容；措辞必须说清楚
        // 被丢弃的是文件剩余全部内容，而不只是这一行
        warnings.push(`第 ${lineno} 行：${key} 的引号直到文件末尾都未闭合，该行及其后所有内容均被忽略`)
        i = lines.length
        continue
      }

      // 跨行时把游标推进到闭合引号所在行的下一行
      i = r.lineIndex + 1

      let tail = lines[r.lineIndex].slice(r.end + 1).trim()
      if (tail !== '' && tail[0] !== '#') {
        warnings.push(`第 ${lineno} 行：${key} 闭合引号后有多余内容 "${tail}"，已忽略该部分`)
      }

      if (quote === "'") {
        // 单引号：纯字面量，不展开也不检查命令替换
        value = r.value
      } else {
        if (expand && r.hasCmdSub) {
          warnings.push(`第 ${lineno} 行：${key} 含命令替换（$( ) 或反引号），此处不是 shell，已跳过`)
          continue
        }
        value = expand ? expandVars(r.value, lookup) : r.value
      }

    } else {
      // 裸值：行内 " #" 起视作注释
      let bare = rest.replace(/[ \t]+#.*$/, '').replace(/[ \t]+$/, '')
      let u = unescapeBare(bare)

      if (expand && u.hasCmdSub) {
        warnings.push(`第 ${lineno} 行：${key} 含命令替换（$( ) 或反引号），此处不是 shell，已跳过`)
        continue
      }

      value = expand ? expandVars(u.value, lookup) : u.value
    }

    // 还原被转义的 $
    value = value.split(ESC_DOLLAR).join('$')

    if (!(key in env) && Object.keys(env).length >= maxKeys) {
      warnings.push(`键数量超过上限 ${maxKeys}，其余内容已忽略`)
      break
    }

    env[key] = value
    // 后续行可以引用前面已定义的键
    lookup[key] = value
  }

  return {env, warnings}
}

/**
 * PATH 规范化：丢掉空分量与重复分量。
 * 空分量（前导/尾随/连续的 ':'）在 POSIX 里等价于**当前工作目录**，
 * 会让 daemon 及其全部子服务从 cwd 解析可执行文件——这是实打实的安全隐患，
 * 而 `export PATH="$PATH:/opt/bin"` 在 PATH 未定义时正好产出这种值。
 */
function sanitizePath(value) {
  let seen = new Set()
  let out = []
  let dropped = 0

  for (let p of String(value).split(':')) {
    if (p === '' || seen.has(p)) { dropped += 1; continue }
    seen.add(p)
    out.push(p)
  }

  return {path: out.join(':'), dropped}
}

/**
 * 加载用户自定义环境变量文件（~/.cdpcd_env）并合入目标环境。
 *
 * 这个函数**只应由用户自己身份的进程调用**（cdpcd 以该用户 uid 运行时）。
 * 读文件的进程本身就是文件属主，因此不需要 O_NOFOLLOW / 属主校验之类的
 * 跨权限防护——用户最多只能影响自己。这里的键名限制保护的是 cdpcd 自身的
 * 路径不变量，不是信任边界。
 *
 * @returns {{loaded:boolean, applied:string[], warnings:string[]}}
 */
function loadUserEnv(file, target = process.env) {
  let out = {loaded: false, applied: [], warnings: []}
  let st

  try {
    st = fs.statSync(file)
  } catch (err) {
    // 不存在是正常路径，不是错误
    if (err.code !== 'ENOENT') {
      out.warnings.push(`读取 ${file} 失败：${err.message}`)
    }
    return out
  }

  if (!st.isFile()) {
    out.warnings.push(`${file} 不是普通文件，已忽略`)
    return out
  }

  if (st.size > MAX_BYTES) {
    out.warnings.push(`${file} 超过 ${MAX_BYTES} 字节上限，已忽略`)
    return out
  }

  // 同组/其他用户可写只告警不拒绝：这是用户自己的文件，权限是他自己的事
  if (st.mode & 0o022) {
    out.warnings.push(`${file} 对同组或其他用户可写，建议 chmod 600`)
  }

  let text
  try {
    text = fs.readFileSync(file, {encoding: 'utf8'})
  } catch (err) {
    out.warnings.push(`读取 ${file} 失败：${err.message}`)
    return out
  }

  let r = parse(text, {lookup: target})
  out.warnings.push(...r.warnings)
  out.loaded = true

  for (let k in r.env) {
    if (FORBIDDEN_KEYS.has(k)) {
      out.warnings.push(`${k} 由 cdpcd 决定，不允许在 ${file} 中覆盖，已跳过`)
      continue
    }

    let v = r.env[k]

    if (k === 'PATH') {
      let s = sanitizePath(v)
      if (s.path === '') {
        out.warnings.push('PATH 规范化后为空，已跳过（保留原 PATH）')
        continue
      }
      if (s.dropped > 0) {
        out.warnings.push(`PATH 中丢弃了 ${s.dropped} 个空分量或重复分量`)
      }
      v = s.path
    }

    target[k] = v
    out.applied.push(k)
  }

  return out
}

module.exports = {
  parse,
  sanitizePath,
  loadUserEnv,
  FORBIDDEN_KEYS,
  MAX_BYTES
}
