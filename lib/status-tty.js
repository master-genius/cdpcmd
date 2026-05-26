'use strict'

/**
 * 简易 TTY 工具：备用屏 / raw 模式 / 键位解析 / 防御式退出清理。
 *
 * 不依赖 readline；直接挂 process.stdin 读字节流。
 * 已知键位（仅消费"短的、单帧到达"的常用键）：
 *   q / Q / Esc / Ctrl-C / Ctrl-D  → quit
 *   ↑ / ↓                          → 'up' / 'down'
 *   PgUp / PgDn                    → 'pageup' / 'pagedown'
 *   Home / End                     → 'home' / 'end'
 *   g / G                          → 'home' / 'end'   （vim 风格简化）
 *   l / L                          → 'detail'         （切换详情）
 *   r / R                          → 'refresh'        （强制刷新）
 *   其余键忽略
 */

const ESC = '\x1b'

const KEY_TABLE = {
  '\x1b[A': 'up',
  '\x1b[B': 'down',
  '\x1b[5~': 'pageup',
  '\x1b[6~': 'pagedown',
  '\x1b[H':  'home',
  '\x1b[F':  'end',
  '\x1b[1~': 'home',
  '\x1b[4~': 'end',
  '\x1bOH':  'home',
  '\x1bOF':  'end',
  '\x1b':    'quit',
  '\x03':    'quit',  // Ctrl-C
  '\x04':    'quit',  // Ctrl-D
  'q':       'quit',
  'Q':       'quit',
  'l':       'detail',
  'L':       'detail',
  'r':       'refresh',
  'R':       'refresh',
  'g':       'home',
  'G':       'end'
}

function parseKey(chunk) {
  let s = chunk.toString('utf8')
  if (KEY_TABLE[s]) return KEY_TABLE[s]
  // chunk 内可能粘连多个事件；首段匹配也算（连按时键不会被吞）
  if (s.length > 1 && KEY_TABLE[s[0]]) return KEY_TABLE[s[0]]
  return null
}

/**
 * 进入 TUI 模式：备用屏 + 隐光标 + raw。
 * 返回一个 controller，包含 onKey/exit/getSize/write。
 * 多次 cleanup 安全幂等。
 */
function enterTTY(onKey) {
  let stdout = process.stdout
  let stdin = process.stdin

  if (!stdout.isTTY) {
    throw new Error('stdout is not a TTY')
  }

  let entered = false
  let cleanedUp = false

  let write = (s) => stdout.write(s)

  let cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    try { stdin.removeListener('data', onData) } catch (_) {}
    try { stdin.pause() } catch (_) {}
    try { if (stdin.isTTY) stdin.setRawMode(false) } catch (_) {}
    if (entered) {
      try { write('\x1b[?25h') } catch (_) {}  // 显光标
      try { write('\x1b[?1049l') } catch (_) {} // 退备用屏
      entered = false
    }
  }

  let onData = (chunk) => {
    let key = parseKey(chunk)
    if (key) {
      try { onKey(key) } catch (e) {
        cleanup()
        console.error(e)
        process.exit(1)
      }
    }
  }

  // 进入备用屏 + 清屏 + 隐光标
  write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l')
  entered = true

  if (stdin.isTTY) stdin.setRawMode(true)
  stdin.resume()
  stdin.on('data', onData)

  let onSig = (sig) => {
    cleanup()
    // 用默认行为退出（信号默认动作）
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', () => onSig('SIGINT'))
  process.once('SIGTERM', () => onSig('SIGTERM'))
  process.once('SIGHUP', () => onSig('SIGHUP'))
  process.once('exit', cleanup)
  process.once('uncaughtException', (err) => {
    cleanup()
    console.error(err)
    process.exit(1)
  })

  return {
    cleanup,
    write,
    getSize: () => ({
      cols: stdout.columns || 80,
      rows: stdout.rows || 24
    }),
    onResize: (fn) => {
      stdout.on('resize', fn)
    }
  }
}

// 全屏平滑重绘（htop 风）：光标回原点 + 每行末尾擦到行尾。
// 调用方必须保证 lines 数量恰好等于终端行数，否则上一帧的尾部会残留。
function fullRedraw(write, lines) {
  let buf = '\x1b[H'
  for (let i = 0; i < lines.length; i++) {
    buf += lines[i] + '\x1b[K'
    if (i < lines.length - 1) buf += '\n'
  }
  write(buf)
}

module.exports = { enterTTY, fullRedraw }
