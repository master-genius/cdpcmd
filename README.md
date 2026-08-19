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
- **cluster 模式** —— nodejs 服务配 `cluster: true` / `workers: N` 即可多 worker
  共享端口，应用零改动；worker 异常终止自动补员，停机分层强制终止不留孤儿。
- **进程树负载** —— 除自身占用外，按进程树聚合出合计与逐进程明细。
  包装脚本、master/worker、cluster 主进程这类服务自身接近 0 负载，
  只有看树才定位得到问题。
- **sock 控制通道** —— CLI 与 cdpcd 之间走 unix socket 请求-响应（`0600` 属主专用），
  命令有应答、有时效、失败必报错；通道自身具备自愈能力。
- **可观测性** —— 配置加载报告、变更类命令审计日志、服务运行时配置查看。
- **systemd 集成** —— 自动生成 unit，开机自启，受 systemd 托管。

---

## 架构与设计

### 控制通道（unix socket）

CLI 与 cdpcd 之间的**唯一控制通道**是 unix socket，协议为 NDJSON
（一行一请求、一行一应答，按 `id` 配对，可流水线）。

| 身份 | sock 路径 |
|---|---|
| root | `/run/cdpcd/cdpcd.sock`，回退 `/usr/local/cdpc/run/cdpcd.sock` |
| 普通用户 | `$HOME/.cdpc/cdpcd.sock` |

路径推导只有一份实现（`lib/sockpath.js`），daemon 与 CLI 共用。

**隔离模型：每个 daemon 一个 sock，各管自己的服务。**
socket 文件权限 `0600`、属主即身份，由内核判定访问权：

- 普通用户只能看/控自己的服务，连别人的 sock 会被内核拒绝（`EACCES`）；
- root 可连接任意用户的 sock，跨用户查询时按 `uauth` 逐个连接后聚合展示；
- 不存在"只读连接"这回事——unix socket 的 `connect()` 需要写权限，
  因此没有把查询权限单独放开的可能，除非另开一个 socket（当前不做）。

**失败必须分类报错**，不静默、不误报：

| 情况 | 行为 |
|---|---|
| sock 不存在 / 连接被拒 | "daemon 未运行，可尝试 `cdpc service-start`" |
| 连接超时（300ms） | "cdpcd 无响应，daemon 可能卡死" |
| `EACCES` / `EPERM` | "无权限连接 \<path\>（权限/属主不符）"，不会误报成未运行 |
| root 聚合时部分用户不可达 | 逐用户标注该行，其余用户照常展示 |

控制类命令是**受理语义**：CLI 收到 `accepted` 后轮询目标状态确认完成，超时会明确报错。
`status --runtime` 的 TUI 对每个目标维持一条长连接，daemon 重建 socket 时自动重连，
界面显示"重连中"而不是清空。

### 负载口径：自身与进程树

`cdpc status` 的 `CPU`/`MEM` 两列**永远是服务自身进程**的占用；
`TREE` 列是「自身 + 全部后代」的合计与树内进程数（单进程服务显示 `-`）：

```
│ Name             │ State      │ PID     │ CPU    │ MEM     │ TREE                 │
│ wrapped          │ RUNNING    │ 3645983 │ 0.00%  │ 3.38M   │ 135.65%/103.83M ×3   │
```

`status -l`（或 `--runtime` 下按 `l`）展开到每个进程，用于定位到底是谁在耗：

```
│    tree   3 procs   CPU 135.65%   MEM 103.83M   (self 0.00% / 3.38M)
│    ├─ 3645984   95.90%    50.44M  node worker.js --port 3001
│    ├─ 3645985   39.75%    50.02M  node worker.js --port 3002
│    └─ 3645983    0.00%     3.38M  bash /opt/app/start.sh
```

原因是 `/proc/<pid>/stat` 的 `cutime`/`cstime` 只累计**已被回收**的子进程时间，
活着的子进程不计入，`rss` 也只算自己——所以任何 fork 出常驻子进程的服务
（不止 shell 包装脚本），只看自身都是接近 0。

子进程很多时（如 60+ 个 worker），明细只列 CPU 最高的几个，其余折叠为
"其他 N 个进程"并给出合计；`TREE` 列的进程数与 cpu/mem 合计始终覆盖**全部**
子进程，不受明细条数限制。

### cluster 模式

nodejs 服务加两行配置即可多 worker 共享端口，**应用不用改代码**：

```js
module.exports = {
  name: 'web', file: '/opt/app/server.js', args: ['--port', '8080'],
  cluster: true, workers: 4
}
```

cdpc 自身不做 cluster 管理：它只多管一个 `launcher.js` 进程，N 个 worker 的
fork、补员与收尾都在 launcher 内完成。所以 `cdpc status` 里它仍是**一个服务**，
`TREE` 列显示 launcher + workers 的合计（`×5`），`status -l` 展开到每个 worker：

```
│ web              │ RUNNING    │ 3025810 │ 0.00%  │ 44.42M  │ 220.15%/180.40M ×5   │
│    exec   node /usr/local/cdpc/node_modules/cdpc/launcher.js --workers 4 …
│    tree   5 procs   CPU 220.15%   MEM 180.40M   (self 0.30% / 44.42M)
│    ├─ 3025819   72.10%    45.03M  node /opt/app/server.js
```

`exec` 行显示实际执行的命令（cluster 服务真正跑的是 launcher），
`cmd`/`args` 仍是用户配置的原值。

停机是分层的：worker 优雅收尾 → launcher 3 秒后 SIGKILL 强制终止残余 →
cdpc 5 秒兜底。**worker 会收到两次 SIGTERM**（cdpc 与 launcher 各一次），
所以应用的 SIGTERM handler 需要幂等。

几条经过实测的可靠性保证：`stop` 时 **launcher 最后退出**（不留孤儿）；
`pause` 作用于**整棵子树**（launcher 与全部 worker 一起停），实测暂停期间
worker 的 CPU 时间不再增长；暂停状态下 `stop` 会先整树 SIGCONT，仍走优雅收尾；
launcher 若自身崩溃，其 worker 会随 IPC 断开自行退出，cdpc 重启后不会出现重复服务；
daemon 无论优雅退出还是被 `kill -9`，worker 都能被收干净（后者靠 launcher 的孤儿自检）。

注意 `limit.maxrss` 对 cluster 服务无效（它只测 launcher 自身），
内存限制请用 cgroup。

**cdpc 依赖**：仓库内置（vendored）的是 **cdpc 6.1.1**，`package.json` 的范围声明为
`^6.0.0`。6.1.1 修掉了一批**静默失效**类问题 —— cgroup 的 `setMem`/`setSwap`/`setCPU`
写入无效、`cpu` 百分比小于 10% 直接抛错、`cpu: 0` 重建时不清旧配额、加入 cgroup
失败不出声，以及守护进程信号退出时把包装型服务的后台作业留成 `ppid=1` 孤儿。
完整清单见 `node_modules/cdpc/README.md` 的「v6.1.1 修复」。

**两套内存限制的单位不同，别混：**

| 机制 | 单位 | 谁执行 | 超限行为 |
|---|---|---|---|
| `limit.maxrss` / `limit.rssOffset` | **KB** | cdpc 轮询判定 | 按 `limit.maxRestart` 重启，超次数后停止 |
| `cgroup` 的 `memory` | **字节** | **内核** | 直接 OOM kill（进程收 SIGKILL） |

`cdpc status -l` 与 `cdpc inspect` 都会带单位显示。被 OOM kill 的服务在详情里
可以看到 `exit signal SIGKILL`。

`limit` 里的 `maxtime` / `frequency` / `maxdaylimit` 在当前版本**未实现**，
写了不报错也不生效；`cdpc inspect` 会标注出来，概览详情不显示它们。

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

cdpcd 周期采集每个服务的 CPU 占用、内存、网络收发数据，供 `status` 与 `inspect` 读取。

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

控制通道与运行时状态（不在上述配置目录内）：

```
root:      /run/cdpcd/cdpcd.sock        控制通道（0600）
           /run/cdpcd/pids/<name>.pid   detached 服务的 pid（接管恢复用）
普通用户:  ~/.cdpc/cdpcd.sock
           ~/.cdpc/pids/<name>.pid
```

`/run/cdpcd` 由 systemd 的 `RuntimeDirectory=cdpcd` 提供；
若不可用则回退到安装目录下的 `run/`。

---

## 依赖

底层进程管理库 `cdpc`；命令行参数解析 `npargv`。完整依赖见 `package.json`。

---

## 状态

命令行管理功能已可用，是当前唯一的管理入口。

基于 Web 的远程管理**尚未开始**：原先那套基于 titbit 的组件是半成品，已从仓库移除，
后续会基于 `topbit` 框架重写。
