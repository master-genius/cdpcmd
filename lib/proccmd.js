'use strict'

const fs = require('fs')

/**
 * 进程树命令的补读。
 *
 * cdpc 在 **daemon 侧**就把进程树的 cmd 截断到 72 字符并加省略号
 * （index.js 的 _readProcCmd，长度写死在默认参数里，没有任何开关）。
 * 也就是说无论表格加宽到多少，进程树那几行的命令都不可能超过 72 字符，
 * 折行永远不会触发——加宽只是让右边多出一片空白。
 *
 * CLI 与 daemon 必然同机（控制通道就是本机 unix socket），而
 * /proc/<pid>/cmdline 是全局可读的，所以在这里就地补读完整命令。
 * 读不到（进程已退出、内核线程无 cmdline）或读到的与 daemon 那份对不上
 * （pid 在两次采样之间被复用）时，一律沿用 daemon 给的截断值。
 */

// 与 cdpc 的 _readProcCmd 用同一个省略号字符（U+2026），不是三个点
const ELLIPSIS = '…'

/**
 * 读取并规范化 /proc/<pid>/cmdline。
 * 规范化方式必须与 cdpc 的 _readProcCmd 完全一致：argv[0] 取 basename、
 * 其余参数原样以空格连接——否则下面的前缀校验永远不通过。
 */
function readProcCmd(pid) {
  try {
    let raw = fs.readFileSync(`/proc/${pid}/cmdline`, {encoding: 'utf8'})

    let parts = raw.split('\x00').map(x => x.trim()).filter(x => x.length > 0)

    if (parts.length === 0) return ''

    let base = parts[0].substring(parts[0].lastIndexOf('/') + 1)

    return [base].concat(parts.slice(1)).join(' ')
  } catch (err) {
    return ''
  }
}

/**
 * 把 daemon 截断过的命令还原成完整命令；没被截断的原样返回（不产生任何读盘）。
 *
 * @param {number} pid
 * @param {string} cmd  daemon 给的命令文本
 * @returns {string}
 */
function expandProcCmd(pid, cmd) {
  if (typeof cmd !== 'string') return cmd
  if (cmd.substring(cmd.length - 1) !== ELLIPSIS) return cmd

  let full = readProcCmd(pid)
  if (!full) return cmd

  // 前缀校验：pid 被复用时读到的是另一个进程，宁可保留 daemon 的截断值，
  // 也不能把别的进程的命令安到这一行上。
  if (full.indexOf(cmd.substring(0, cmd.length - 1)) !== 0) return cmd

  return full
}

module.exports = { readProcCmd, expandProcCmd }
