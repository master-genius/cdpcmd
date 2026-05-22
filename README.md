# cdpcmd

基于 Node.js 的多用户进程 / 服务管理系统。以守护进程 + 配置文件 + 命令行的方式，
在单机上托管、监控、限制和管理后台服务，并支持把管理权授权给普通用户。

> cdpcmd 构建在 `cdpc`（Node.js 进程管理库）之上，在其基础上实现了守护进程、
> 用户授权、命令行、配置式管理、资源限制、日志采集与 systemd 集成。

---

## 简介

- **cdpc** —— 底层进程管理库：负责 spawn 子进程、重启策略、cgroup 资源限制、状态监控。
- **cdpcd** —— 守护进程（`cdpcd.js`）：常驻运行，按配置托管一批服务。系统级实例以 root
  运行；每个被授权的普通用户可运行属于自己的用户级实例。
- **cdpc** —— 命令行工具：对守护进程下发控制指令，管理配置、查看状态与日志。

一个服务只需写一个配置文件放进配置目录，cdpcd 即会按配置启动它、按策略重启它、
按资源上限约束它、把它的输出采集到日志，并持续监控它的 CPU / 内存 / 网络。

---

## 特性

- **配置式管理** —— 一个服务一个配置文件，文件名即服务名。
- **多用户授权** —— root 把管理权授权给普通用户，普通用户以自身身份托管自己的服务。
- **精确的 reload** —— 重新加载配置只同步差异：未变更的服务不重启，删除/改名的服务被移除，
  改了命令的服务才重启。
- **cgroup v2 资源限制** —— 按预设的限制组约束服务的 CPU / 内存 / PID 数 / IO。
- **干净的停机模型** —— 所有进程都在 systemd 服务的 cgroup 子树内，`systemctl stop/restart`
  一次性回收，无孤儿、无重复实例。
- **双层日志** —— cdpcd 自身运行日志 + 每个服务的 stdout/stderr 采集日志，均自动按量轮转。
- **运行时监控** —— 周期采集每个服务的 CPU、内存、网络数据。
- **可观测性** —— 配置加载报告、变更类命令审计日志、服务运行时配置查看。
- **systemd 集成** —— 自动生成 unit，开机自启，受 systemd 托管。
- **Web 服务**（开发中）—— 内置 web server 组件，用于远程查询与管理。

---

## 架构与设计

### 多用户授权模型

cdpcd 同时服务 root 与普通用户：

- **root cdpcd** —— 系统级实例，由 systemd 托管，配置目录 `/usr/local/cdpc/config`。
- **用户 cdpcd** —— 每个被授权用户一个独立实例，以该用户身份运行，配置与日志位于
  `~/.cdpc/`。它本身是 root cdpcd 托管的一个子服务。

root 通过 `cdpc auth add <用户>` 授权；被授权用户即可用 `cdpc` 托管自己的进程，
但只能以自身身份运行、只能看到和管理自己的服务。

### 配置式服务管理

服务由配置文件描述（`.js` / `.json`），放入配置目录即被加载。`name` 是服务的**唯一身份**：
对外寻址、配置文件名、状态文件、日志文件都以它为准。未显式指定时由文件名推导。

`reload` 是纯配置同步操作，不做无差别重启 —— 见下方命令说明。

### 资源限制与停机模型（cgroup v2）

cdpcd 启动时在**自己的 cgroup 子树内**创建一组预设限制组（如 `cdpcd-50-limit`、
`cdpcd-25-limit` 等，按 CPU/内存/PID 档位划分）。服务在配置里指定 `cgroup` 即落入对应限制组。

systemd unit 启用 `Delegate=yes`，cdpcd 把自身挪入叶子组、在服务 cgroup 下建限制组，
**所有被管进程都留在 `cdpcd.service` 的 cgroup 子树内**。因此 `systemctl stop/restart`
能一次性回收全部进程 —— 不会有逃逸出去的孤儿，也不会在重启后出现重复实例。

### 进程生命周期

被管子进程一律**非 detached**，与 cdpcd 同生死：cdpcd 重启时下层服务随之重启（restart-all）。
停机时 systemd 以 `KillMode=mixed` 先让 root cdpcd 优雅退出，再 SIGKILL 回收 cgroup 子树。

### 日志体系

两层互不相干的日志：

- **cdpcd 运行日志** —— `logs/cdpcd.log`，cdpcd 自身的错误与事件，结构化、按行数轮转。
- **应用日志** —— 每个服务的 stdout/stderr 采集到 `logs/apps/<name>.log`，由 cdpcd 持有
  写入流，按累计字节数轮转（单备份 `.1`）。`cdpc applog` 查看。

此外：`logs/config-errors.log` 记录最近一次配置加载报告，`logs/audit.log` 记录变更类命令审计。

### 监控

cdpcd 周期采集每个服务的 CPU 占用、内存、网络收发数据，写入负载信息文件，供 `status`、
`inspect` 与 web 服务读取。

### Web 服务

内置 `cdpcd-web-server` 组件（基于 titbit），通过 IPC 与 cdpcd 通信，用于远程获取负载信息
与下发管理指令。该部分仍在开发完善中，目前命令行是主要的管理入口。

---

## 安装

需要 Linux + systemd + cgroup v2，以及 Node.js（安装脚本会在缺失时尝试安装）。

```bash
sudo bash install.sh
```

安装内容：

- 程序安装到 `/usr/local/cdpc`
- 命令行 `cdpc` 安装到 `/usr/local/bin/cdpc`
- 生成 systemd unit 并设为开机自启

升级已安装环境后若 unit 结构有变化，需重新生成并重载：

```bash
node makesystemd.js > /lib/systemd/system/cdpcd.service && systemctl daemon-reload
```

---

## 命令用法

```
cdpc [子命令] [选项] [参数]
```

root 用 `sudo cdpc ...` 管理系统级服务；被授权的普通用户直接 `cdpc ...` 管理自己的服务。

### 服务控制

| 命令 | 说明 |
|------|------|
| `cdpc start <name>` / `--all` | 启动服务 |
| `cdpc stop <name>` / `--all` | 停止服务 |
| `cdpc restart <name>` / `--all` | 重启服务 |
| `cdpc pause <name>` | 暂停（进程不退出，暂时不被调度） |
| `cdpc resume <name>` | 恢复暂停的服务 |
| `cdpc remove <name>` | 移除服务 |
| `cdpc disable / enable <name>` | 禁用 / 启用服务 |

### 配置管理

| 命令 | 说明 |
|------|------|
| `cdpc config add <文件>` | 添加配置文件（文件名去扩展名即服务名，须合法） |
| `cdpc config remove <name>` | 移除配置文件 |
| `cdpc config show` / `list` | 查看配置内容 / 列出配置名 |
| `cdpc config errors` | 查看最近一次配置加载报告 |
| `cdpc load` | 加载配置目录，新增服务会被启动 |
| `cdpc reload` | 配置同步：未变更服务不重启，删除/改名的移除，改了命令的重启 |

> `reload` 不会因 `restart` / `limit` / `env` 等字段的修改而重启服务，
> 这类改动需显式 `cdpc restart <name>` 才生效。

### 查看

| 命令 | 说明 |
|------|------|
| `cdpc status [name]` | 显示服务状态 |
| `cdpc inspect [用户:]<name>` | 查看服务真实生效的运行时配置 |
| `cdpc applog [用户:]<name> [-f]` | 查看服务的 stdout/stderr 采集日志，`-f` 持续跟踪 |
| `cdpc audit` | 查看变更类命令的审计历史 |

### 授权（root）

```bash
sudo cdpc auth add <用户>      # 授权
sudo cdpc auth remove <用户>   # 取消授权
sudo cdpc auth                 # 查看授权信息
```

---

## 配置文件示例

配置文件放入配置目录（root：`/usr/local/cdpc/config`；用户：`~/.cdpc/config`），
或用 `cdpc config add` 添加。一个 `.js` 配置导出一个对象：

```js
module.exports = {
  name: 'myapp',               // 服务名；省略时由文件名推导
  file: '/srv/myapp/app.js',   // 或用 command + args
  restart: 'always',           // 重启策略
  cgroup: 'cdpcd-50-limit',    // 资源限制组
  maxLogBytes: 5 * 1024 * 1024,// 应用日志单文件轮转阈值
  monitor: true,               // 启用监控
  env: { NODE_ENV: 'production' }
}
```

---

## 目录结构

系统级（`/usr/local/cdpc/`）/ 用户级（`~/.cdpc/`）布局一致：

```
config/            服务配置文件
config/disabled/   被禁用服务的标记
logs/cdpcd.log     cdpcd 自身运行日志
logs/apps/         每个服务的 stdout/stderr 采集日志
logs/config-errors.log  配置加载报告
logs/audit.log     变更类命令审计日志
limit/             按用户的资源限制配置
uauth/             授权用户清单（仅系统级）
```

---

## 依赖

底层进程管理库 `cdpc`；命令行参数解析 `npargv`；web 服务基于 `titbit` 系列框架。
完整依赖见 `package.json`。

---

## 状态

命令行管理功能已可用。基于 Web 的远程控制与自动化编排仍在持续开发中。
