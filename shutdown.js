'use strict'

/**
 * [包B] systemd ExecStop 钩子：cdpcd.service 停止/重启时的有序清理。
 *
 * 用户级 cdpcd 运行在独立 cgroup（cdpcd-user-auth-limit），
 * 会逃过 systemd 对 service cgroup 的 SIGKILL 而残留为孤儿，
 * 导致下次启动出现"服务管理冲突"。本脚本在停止时显式终止它们。
 *
 * 用户的业务进程（detached）不在终止范围内——它们本就设计为
 * 跨 cdpcd 重启存活，下次启动由新实例接管（_recoverDetachedProcess）。
 */

const fs = require('fs')

const CDPC_DIR = '/usr/local/cdpc'
const UAUTH_DIR = `${CDPC_DIR}/uauth`

function killByPidfile(pidfile, label) {
  let pid
  try {
    pid = parseInt(fs.readFileSync(pidfile, {encoding: 'utf8'}).trim())
  } catch (err) {
    return
  }
  if (!pid || isNaN(pid) || pid <= 1) return

  // 校验确实是 cdpcd 进程，避免 PID 文件过期 + pid 复用导致误杀
  try {
    let cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, {encoding: 'utf8'})
    if (cmdline.indexOf('cdpcd.js') < 0) return
  } catch (err) {
    return  // 进程已不存在
  }

  try {
    process.kill(pid, 'SIGKILL')
    console.log(`[shutdown] 已终止 ${label} (PID:${pid})`)
  } catch (err) {}
}

// 1. 终止所有用户级 cdpcd（它们在独立 cgroup，systemd 清理不到）
try {
  let users = fs.readdirSync(UAUTH_DIR)
  for (let u of users) {
    let home
    try {
      home = fs.readFileSync(`${UAUTH_DIR}/${u}`, {encoding: 'utf8'}).trim()
    } catch (err) {
      continue
    }
    if (!home) continue
    killByPidfile(`${home}/.cdpc/cdpcd-pid`, `用户 cdpcd [${u}]`)
  }
} catch (err) {
  // uauth 目录不存在 → 没有授权用户，跳过
}

// 2. 终止 root cdpcd 自身（默认忽略 SIGTERM，需要直接 SIGKILL 才能快速停机）
killByPidfile(`${CDPC_DIR}/logs/cdpcd-pid`, 'root cdpcd')

process.exit(0)
