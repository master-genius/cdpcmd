# cdpcmd 升级说明（upgrade.md）

本次升级围绕 5 个长期存在的问题，对 `cdpc` 进程管理库及 cdpcmd 的多个文件做了系统性修复与重构。

- 总改动：9 个文件，约 +846 / -219 行
- 新增文件：`inspect.js`、`shutdown.js`
- 验证：67 个断言全部通过

---

## 一、问题清单与修复状态

| # | 问题 | 根因层 | 状态 |
|---|------|--------|------|
| 1 | reload 重新加载配置总是让所有进程重启 | cdpc 库 | 已修复 |
| 2 | 文件有问题时看不到日志，也没有地方看服务配置细节 | cdpc + cdpcmd | 已修复 |
| 3 | name 冲突未彻底解决（含静默折叠） | cdpc 库 | 已修复 |
| 4 | 重启服务导致用户级 cdpcd 被 systemd 接管、管理冲突、状态错乱 | cdpc + cdpcmd | 已修复 |
| 5 | 日志缺乏精确的报告过程 | cdpcmd | 已修复 |

附带修复的 bug：

| bug | 文件 | 说明 |
|-----|------|------|
| `_checkAppName` 首字符类 `1-9` 把数字 `0` 排除 | cdpc/index.js | typo，已改为 `0-9` |
| `makeName` 参数排序后哈希导致不同参数同名 | cdpc/index.js | makeName 重写后消除 |
| 不同 name 同 command 的配置被静默折叠丢失 | cdpc/index.js | name 主键重构后根除 |
| `set_disabled_state` 引用未定义的 `msg.name` | cdpcd.js | ReferenceError，已改用参数 `name` |
| `disable-or-enable.js` 用 `flag:'a'` 追加写 | disable-or-enable.js | 重复 disable 会累积内容，已改 `'w'` |
| `cdpclog.js` `for (f of flist)` 缺 `let` | lib/cdpclog.js | strict 模式抛错被吞，日志历史轮转失效 |
| `cdpc config add` 写 watch/load 用了源文件全路径 | cdpc | 已改用 basename |

---

## 二、核心设计变更

### 2.1 name 成为唯一服务身份

旧设计中 `cdpc` 内部以 `ck`（`command + args` 拼接）为 `childs` 主键，`name` 只是次级索引。这导致：

- 两个不同 name 但 command/args 相同的服务会被静默折叠成一个，后者丢失且无报错；
- 对外（CLI、配置文件名、状态文件）都以 name 寻址，对内却以 ck 寻址，两个命名空间不对称。

新设计：**name 是唯一主键**。

- `this.childs` 以 name 为键；`appName` 索引整体移除；
- `ck` 降为 `chk.ck` 字段，仅用于变更检测（reload 判断、`_cleanupOldByName`）；
- 不同 name 同 command 的服务现在各自独立运行。

### 2.2 name 自动推断

当配置未显式指定 `name` 时：

- 配置来自文件 → 用文件名（去 `.js/.cjs/.mjs/.json` 扩展名）作为 name，文件名必须合法否则拒绝；
- 配置来自程序化调用且有 command → 用 `basename(command)` 经 sanitize 后作为 name；
- 多个同名 → 自动追加最小可用编号：`name`、`name-2`、`name-3`……（确定性，可重现，删除后回填）。

`name` 规则：以字母/数字/下划线开头，仅含字母数字下划线减号，长度不超过 50。

### 2.3 reload 语义

reload 是**纯配置同步**操作，不再无差别重启：

- 已存在且 name/命令均未变的服务 → 原样保留，不重启；
- 配置中被删除或改名的服务 → 停止并移除；
- 改了 command/args 的服务 → 重启以应用新命令；
- 只改 restart/limit/env 等字段 → reload 不重启，需显式 `cdpc restart` 才生效。

### 2.4 detached 进程接管恢复

cdpcd 重启后，上次以 detached 方式启动的子进程会被 PID 1 收养而存活。新实例不再错误地把它们标成 EXIT，而是**接管**：状态置 RUNNING、记录真实 pid、轮询 `/proc` 感知存活，退出后按 restart 策略重启。

---

## 三、cdpc 扩展（`node_modules/cdpc/index.js`）的更改

> 说明：cdpc 是独立的 npm 包。此处改动位于本仓库内置的 `node_modules/cdpc/`，
> 若重新 `npm install` 会被覆盖，需同步回 cdpc 上游或使用 patch 固化。

### 3.1 命名与配置校验

- `_checkAppName`：首字符类 `1-9` → `0-9`；长度上限 `{0,28}` → `{0,49}`（总长 50）。
- 新增 `_deriveNameFromFile(fpath)`：从配置文件路径派生 name（去扩展名，严格校验，不 sanitize）。
- `makeName` 重写：废弃哈希命名，改为 `basename(command)` + sanitize + 最小可用编号；确定性、可重现。
- `checkConfig`：移除超长 name 的静默截断，超长直接报错；name 冲突检测改查 `childs`。

### 3.2 配置加载

- `readConfig`：
  - 单 cfg 对象未指定 name 时用文件名派生；
  - 返回结构新增 `skipped` 数组，记录被跳过的配置项（`BAD_FILENAME_AS_NAME`、`ARRAY_ITEM_MISSING_NAME`、`READ_ERROR`），每项带 `{file, code, message}`。
- `runChilds`：返回 `{ok: [成功的 name], failures: [{file,name,code,message}]}`，checkConfig 失败的项被结构化收集。
- `loadConfig`：
  - 返回结构升级为 `{ok, errmsg, loaded, skipped, removed}`；
  - reload 时先按 name 差集做同步 `remove`，再 `runChilds`（消除 ck 复用导致 safeRemove 误伤新进程的暗坑）；
  - 三个返回点统一经新增的 `_loadResult` 助手：缓存 `cm.lastConfigResult`、触发 `onLoadConfig` 回调。
- 构造函数新增 `onLoadConfig` 选项（函数）。

### 3.3 childs 主键 ck → name

- `this.childs` 改以 name 为键；`this.appName` 移除。
- `this.monitorChilds` 改为存 name。
- `chk` 新增 `ck` 字段（变更检测用）。
- `_cleanupOldByName`：按 name 查 chk、比较 `chk.ck`、按 name 删除。
- `setChildCommand`：只更新 `chk.command` 与 `chk.ck`，不再搬移索引。
- `find` / `has`：一跳直查 `childs[name]`。
- `remove`：按 `chk.name` 清理。
- `tryMakeChild`：移除 reload 分支的 kill+respawn（issue 1 修复）；移除"同 ck 不同 name"的折叠分支（不同 name 同命令现在各自独立）。
- 事件处理器（spawn/exit/error）：`cur` 查找从两跳简化为 `this.childs[chk.name] || chk`。

### 3.4 only / force 安全增强

- `only` 检测的 force 分支：区分外部进程与 cdpc 自己的兄弟服务 pid。
  - 命中兄弟服务 → 拒绝 spawn，写 `SIBLING-CONFLICT` cause（避免两个服务互相 ping-pong kill）；
  - 仅对外部进程执行 force-kill（旧版只 kill `cmds[0]` 的 bug 一并修复，现 kill 全部外部命中）。
- force 的语义明确为"接管系统层意外脱管的进程"，不抢占 cdpc 兄弟服务。

### 3.5 detached 进程接管恢复

- `_recoverDetachedProcess` 重写：
  - 新增 PID 复用校验（比对 `/proc/<pid>/cmdline` 命令名），避免 PID 文件过期误接管；
  - 发现存活的遗留进程 → 接管而非置 EXIT；
  - force 模式仍是杀掉重起。
- 新增 `_adoptDetachedProcess`：状态置 RUNNING、记录 `adoptedPid`、加入监控。
- 新增 `_startAdoptPoll`：2 秒间隔轮询 `/proc` 感知退出（无 ChildProcess 句柄只能轮询）。
- 新增 `_onAdoptedExit`：轮询发现退出后按 restart 策略重启。
- `chk` 新增 `adoptedPid`、`_adoptTimer` 字段；`get pid()` 回退 `adoptedPid`。
- `writeChildState`、loadinfo dump 的 pid 改用真实 pid（修复 dump 中 `ch.child.pid` 对接管进程的空引用崩溃）。
- 监控三函数（`_getOneProcInfo`/`_saveMonitorLast`/`_cacltChildsLoad`）支持 `adoptedPid`，被接管进程照常采集 cpu/mem/net。
- `stop` / `remove` / `_cleanupOldByName` 均正确终止 `adoptedPid` 并清理轮询定时器。


### 3.7 loadinfo dump 扩展

`fmtLoadInfo` 的 `childs[]` 每项新增字段，供 `cdpc inspect` 展示真实运行时配置：
`configPath`、`cgroup`、`after`、`autoRemove`、`monitor`、`monitorNetData`。

---

## 四、cdpcmd 其他文件的更改

### 4.1 `cdpcd.js`（守护进程主入口）

- 新增 `writeConfigErrors`，接到 cdpc 的 `onLoadConfig` 回调，把每次加载结果写成快照到 `logs/config-errors.log`。
- 新增 `apps` 日志目录创建。
- 用户级 cdpcd 启动自检：检测到上一个用户 cdpcd 实例（root cdpcd 重启后残留的孤儿）→ `SIGKILL` 旧实例，由新实例接管，消除"服务管理冲突"。
- 修复 `set_disabled_state` 引用未定义 `msg.name` 的 ReferenceError。

### 4.2 `cdpc`（命令行 shell 脚本）

- `config add`：新增 `check_config_filename` 文件名校验（去扩展名后须符合 name 规则），不合法当场拒绝；修复写 watch/load 用源文件全路径的 bug。
- 新增 `config errors` 子命令：查看配置加载报告。
- 新增 `config list` 走无参子命令分支。
- 新增 `inspect [user:]name` 子命令：查看服务完整运行时配置（root 可跨用户）。
- 新增 `applog [user:]name [-f]` 子命令：查看应用 stdout/stderr 日志。
- 新增 `audit` 子命令：查看命令审计日志。
- 新增 `write_audit`：对变更类命令（start/stop/restart/pause/resume/remove/safe-remove/disable/enable/reload/load/config/auth/webserver/service-*）追加审计行到 `logs/audit.log`。
- 更新快速使用提示。

### 4.3 `outstatus.js`（状态输出）

- name 列宽自适应：按实际最长 name 动态调整（23~52），长 name 不再被粗暴截断。

### 4.4 `makesystemd.js`（systemd unit 生成）

- unit 新增 `ExecStop`（指向 `shutdown.js`）、`KillMode=mixed`、`TimeoutStopSec=20`。
- 停机/重启时先跑 `shutdown.js` 做有序清理。

### 4.5 `disable-or-enable.js`

- disabled 标记文件写入 `flag:'a'` → `'w'`，避免重复 disable 累积内容。

### 4.6 `lib/cdpclog.js`

- 修复 `for (f of flist)` 缺 `let` 的 ReferenceError（strict 模式下被构造函数 try/catch 吞掉，导致日志历史轮转长期失效）。

### 4.7 `helpdoc`

- 补充 `config add/remove/show/list/errors`、`inspect`、`applog`、`audit` 子命令文档。
- 新增 `reload` 与 `load` 区别说明，明确"reload 不重启未变更服务"。

### 4.8 `install.sh`

- 安装清单加入 `inspect.js`、`shutdown.js`。

---

## 五、新增文件

### `inspect.js`

读取 cdpc 周期写出的负载信息文件（JSON），按 name 查找服务并完整 dump 其运行时配置，分"基本 / 重启策略 / 运行控制 / 资源"四组。数据来自运行时快照，比 `config show` 的磁盘原始文件更可信。

### `shutdown.js`

systemd `ExecStop` 钩子。用户级 cdpcd 运行在独立 cgroup（`cdpcd-user-auth-limit`），会逃过 systemd 对 service cgroup 的清理而残留为孤儿。本脚本在停机时按 `uauth` 列表 + PID 文件显式终止用户 cdpcd 与 root cdpcd。用户的业务进程（detached）不在终止范围内——它们设计为跨 cdpcd 重启存活，下次启动由新实例接管。

---

## 六、行为变更须知

1. **reload 不再重启未变更的服务**。若修改了 `restart`、`limit`、`env` 等非命令字段，reload 不会生效，需显式 `cdpc restart <name>`。
2. **配置文件名即服务名**。`cdpc config add` 会校验文件名（去扩展名后须符合 name 规则），不合法的文件名会被拒绝。
3. **不同 name、相同 command+args 的服务现在各自独立运行**（旧版会静默折叠）。
4. **name 长度上限提升到 50**。
5. **systemd unit 结构变化**。重新安装会重新生成 unit；已安装环境需 `node makesystemd.js > /lib/systemd/system/cdpcd.service && systemctl daemon-reload`。
6. cdpc 库改动位于 `node_modules/cdpc/`，重新 `npm install` 会被覆盖，需同步上游或固化为 patch。

---

## 七、验证

通过独立验证脚本覆盖（共 67 个断言全部通过）：

- 配置加载、文件名派生、reload 语义、skipped 列表
- name 自动推断与编号、长度上限、ck 冲突、force 兄弟保护
- detached 进程接管：状态正确、轮询感知退出、重启、stop 终止被接管进程
- `onLoadConfig` 回调、config-errors、`inspect`

> 注意：单元验证未覆盖真机环境下的 cgroup 逃逸/接管行为。建议在 root + 授权用户的真实环境做一次端到端 install + `systemctl restart` 实测。
