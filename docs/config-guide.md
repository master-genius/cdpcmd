# cdpc 服务配置编写指南

**一个服务的配置，就是一个导出对象的 `.js` 文件，通常 2～3 行。** 除了“跑什么”，其余字段全是可选的，不写就用默认值。
架构与原理见 [`../README.md`](../README.md)，命令全集见 `cdpc help`。

> 行为描述来自 cdpc 6.2.0 源码，以及在普通用户（非 root）环境下的逐条实测。实测过的写“实测”，只读了代码的写“代码推导”。

---

## 1. 最简配置

跑一个 Node 程序：

```js
// hello.js
module.exports = {
  file: '/home/ubt/hello/app.js'
}
```

跑一个命令：

```js
// redis.js
module.exports = {
  command: 'redis-server',
  args: ['/etc/redis/redis.conf']
}
```

加载并查看：

```sh
cdpc config add hello.js     # 检查语法 → 拷进配置目录 → 加载 → 回显加载报告
cdpc status                  # 看状态
cdpc log hello -f            # 看输出（-f 持续跟踪）
```

- **服务名**：没写 `name` 时用文件名（`hello.js` → `hello`）。想换名字就加一行 `name: 'xxx'`，写了 `name` 就以它为准，与文件名无关（实测）。
- **`command` 和 `file` 至少写一个**，否则被拒：`没有可执行的命令，command 与 file 至少要指定一个。`
- `file` 建议写绝对路径，必须存在；设了 `file`，工作目录自动变成它所在的目录（实测）。
- `args` 只写你自己的参数，入口脚本路径 cdpc 会自动放在最前面，不要重复写。

加载成功时的报告：

```
── 配置加载报告 ──
# loaded: 1  skipped: 0  removed: 0
# 已加载: hello
（无配置错误）
```

---

## 2. 常用写法

**带参数和环境变量**

```js
module.exports = {
  file: '/srv/api/server.js',
  args: ['--port', '3000'],
  env: { NODE_ENV: 'production' }      // 追加到环境变量上，不是替换
}
```

**脚本：解释器怎么定**——只写 `file` 时按扩展名默认推导：

| 扩展名 | 解释器 |
|---|---|
| `.js` `.cjs` `.mjs` | `node` |
| `.sh` | `bash` |
| `.py` | `python` |
| 其他 | 必须自己写 `command` |

默认推导不合你的环境，就自己指定 `command` 覆盖，例如机器上只有 `python3`：

```js
module.exports = { command: 'python3', file: '/home/ubt/job/hello.py' }
```

> 推导出的命令不存在时，加载报告仍显示“已加载”，服务随后进入 `ERROR`，原因在日志里（`spawn python ENOENT`，实测）。
> 所以 `config add` 之后请看一眼 `cdpc status`。

**只跑一次的任务**

```js
module.exports = { file: '/opt/tools/backup.sh', onceMode: true }
```

跑完自动从服务列表移除（实测）。

**挂掉后怎么重启**——`restart` 默认 `always`（退出就重启），可选：

| 值 | 含义 | 实测 |
|---|---|---|
| `always`（默认） | 退出就重启 | — |
| `none` | 不重启 | 共运行 1 次，停在 `EXIT` |
| `count` | 重启有次数上限，配合 `restartLimit` | `restartLimit: 2` → 共运行 3 次，然后 `EXIT` |
| `fail` | 退出码非 0 才重启 | 退出码 0 → 不重启 |
| `fail-count` | 退出码非 0 才重启，且受 `restartLimit` 限制 | 按库文档，未单独实测 |

> **`restart` 写错值不会报错，而是静默当成 `always`**（实测：`restart: 'sometimes'` 加载成功，`inspect` 显示 `always`）。写完用 `cdpc inspect <名字>` 核对。

**需要更多时**（都是可选，用到再看）：

```js
// 先启动 db 再启动本服务（字符串或数组）
module.exports = { file: '/srv/web/app.js', after: 'db' }

// 多 worker 共享端口，只支持 Node 服务；workers 不写 = CPU 核数
module.exports = { file: '/srv/web/server.js', args: ['8080'], cluster: true, workers: 2 }

// 以指定用户运行——仅 root 的配置可用
module.exports = { file: '/srv/site/app.js', user: 'www-data' }
```

cluster 对外仍是一个服务，`status` 的 `TREE` 列显示 launcher 加 worker 的合计（实测 `×3`），请求在 worker 间均分（实测）。
普通用户的配置里写 `user`（哪怕是 `root`）会被拒：`必须以root用户运行才可以改变子进程的uid和gid。`（实测）

---

## 3. 可选字段速查

| 字段 | 默认 | 说明 |
|---|---|---|
| `name` | 文件名去扩展名 | 服务名。规则：以字母/数字/下划线开头，其后只含字母数字下划线 `-` `@`，不超过 50 字符；同名冲突会被拒 |
| `command` | 由 `file` 推导 | 要执行的命令 |
| `file` | — | 入口脚本，必须存在 |
| `args` | `[]` | 参数（不含 `file`） |
| `env` | — | 追加的环境变量；值只接受字符串/数字/布尔。要完全替换环境用 `options.env` |
| `options` | `{}` | 透传给 `child_process.spawn`，常用 `cwd` |
| `restart` | `always` | 见上表；写错静默变 `always` |
| `restartDelay` | `1000` | 重启前等待的毫秒数 |
| `restartLimit` | — | 重启次数上限，`count` / `fail-count` 用 |
| `onceMode` | `false` | 只跑一次并自动移除 |
| `autoRemove` | `false` | 跑完自动移除，仅对 `count` / `fail` / `fail-count` 有意义 |
| `stopTimeout` | — | stop 后等待优雅退出的毫秒数，库文档给的范围 5～600000 |
| `after` | — | 启动顺序依赖 |
| `cluster` / `workers` | — | 多 worker；写 `workers` 就等于启用；与 `only`、`onceMode` 互斥 |
| `user` / `group` | — | 仅 root |
| `monitor` | 实测默认开 | 采集 CPU/内存供 `status` 显示 |
| `cgroup` / `limit` | — | 资源限制，见下 |

**资源限制（cgroup / limit）**：`cgroup: '组名'` 把服务挂进预设组（`cdpcd-25-limit`、`cdpcd-50-limit`、`cdpcd-70-limit`、`cdpcd-80-limit`、
`cdpcd-85-limit`、`cdpcd-user-auth-limit`、`cdpcd-hclm-limit`、`cdpcd-mem-limit`、`cdpcd-cpu-limit`），组名里的百分比是占全机的比例，
具体数值见 `cdpcd.js` 里的 `mkgrp(...)`。**普通用户配置 `cgroup` 不生效**：服务照常运行，但日志里有警告
`加入 cgroup「…」失败 —— 非root用户不具备操作权限。该服务当前没有资源限制。`（实测）；root 下的效果为代码推导，未实测。
`limit.maxrss` 单位是 **KB**（cdpc 轮询判定），cgroup 的 `memory` 单位是**字节**（内核强制），别混；`limit.maxtime` / `frequency` / `maxdaylimit` 当前版本未实现。

---

## 4. 改了配置，怎么生效

| 命令 | 做什么 |
|---|---|
| `cdpc reload` | 同步配置：新增的启动，删除/改名的停止，改了 `command`/`args` 的重启，**其余保持原样** |
| `cdpc reload-force <名字…>` | 停止指定服务，再按配置文件重建 |

**`reload` 不会同步 `env`、`restart`、`limit`、`cgroup`**。实测：把 `env` 的值从 `v1` 改成 `v2`，`reload` 后进程仍是 `v1`、pid 不变；
`reload-force` 后才变成 `v2` 并换了 pid。改这几个字段就用 `reload-force`（必须写出服务名，不支持 `--all`）。

移除服务：`cdpc config remove hello.js`，再 `cdpc reload`。

> **手写的文件直接放进配置目录也行**，但放进去不会自动加载（实测），需要再执行 `cdpc load`（加载整个目录）或 `cdpc reload`。
> 手写没有 `config add` 的语法预检，写错了看加载报告。扩展名请用 `.js`（也支持 `.json`，字段相同，只是不能写注释）：
> **手写放进目录的 `.cjs` 会被静默忽略，报告里也没有提示**（实测）。

---

## 5. 出错了怎么办

加载报告（`config add` / `load` / `reload` 都会回显；事后用 `cdpc config errors` 重看）里，被拒的配置以 `!` 开头。实测原文：

| 报告里的内容 | 原因 | 处理 |
|---|---|---|
| `没有可执行的命令，command 与 file 至少要指定一个。` | 两个都没写 | 补一个 |
| `入口文件不存在或不可访问：<路径>` | `file` 指向的文件不存在 | 改成存在的绝对路径 |
| `应用名称冲突。` | 服务名已被占用 | 改 `name` |
| `必须以root用户运行才可以改变子进程的uid和gid。` | 普通用户写了 `user`/`group` | 删掉，或改由 root 部署 |
| `配置文件语法错误，已中止添加` | `config add` 时语法错 | 按行号修；文件不会被拷进配置目录 |
| `[READ_ERROR] … Unexpected end of input` | 手写文件语法错 | 报告里没有行号，用 `node --check <文件>` 定位 |
| `[BAD_FILENAME_AS_NAME] … 文件名不符合命名规则` | 没写 `name`，文件名又不合规（如含空格） | 写上 `name` 或改文件名 |
| `[ARRAY_ITEM_MISSING_NAME] … 数组第 N 项` | 一个文件导出数组时，某项没写 `name`（数组里每项都必须写 `name`，其余项照常加载） | 补 `name` |

三个容易忽略的点：

1. **被拒的文件会留在配置目录里**（`config add` 先拷贝后加载，报告里会写“文件仍在 …”），之后每次 `reload` 都会再报一遍。改好，或 `cdpc config remove` 掉。语法错误是在拷贝前拦下的，不属于这种情况。
2. **“已加载”不等于“在运行”**。服务到底跑没跑，看 `cdpc status`：`RUNNING` 正常，`ERROR` 多半是命令不存在，`EXIT` 是已退出且不会再重启。原因看 `cdpc log <名字>`（`==` 开头是启动/退出事件，`!!` 开头是失败事件）。
3. **配置没生效？** 依次：`cdpc config errors` 看是不是被拒 → `cdpc inspect <名字>` 看**生效值**（比磁盘文件更可信）→ 改的是 `env` / `restart` / `limit` / `cgroup` 就用 `reload-force`。

路径里不要有空格：带空格的路径会被 `cdpc` 脚本拆开，报误导性的 `bad : file not exists`（实测，已知缺陷）。

---

## 6. 命令速查

| 命令 | 作用 |
|---|---|
| `cdpc config add <文件>` | 检查并添加配置，回显加载报告 |
| `cdpc config remove <文件名>` | 删除配置文件（还需 `cdpc reload` 才停掉服务） |
| `cdpc config list` / `show` | 列出 / 显示配置目录里的配置文件 |
| `cdpc config errors` | 最近一次加载报告 |
| `cdpc load` / `reload` / `reload-force <名字…>` | 加载目录 / 同步 / 强制重建 |
| `cdpc status [名字] [-l]` | 状态，`-l` 展开详情 |
| `cdpc inspect <名字>` | 完整的生效配置 |
| `cdpc log <名字> [-f]` | 应用日志 |
| `cdpc start / stop / restart / pause / resume <名字>` | 单个服务控制 |

配置目录：root 是 `/usr/local/cdpc/config`；普通用户是 `~/.cdpc/config`（需 root 授权，`cdpc auth` 能看到“已被授权”）。

> `config list` / `show` 会多显示 `disabled/` 目录的缺陷已在本仓库修复；线上机器升级 `cdpc` 之前仍会多出一项，不影响使用。

---

## 附：依据与实测环境

- 实测环境：Ubuntu 24.04、Node v26.12.0、cdpc 6.2.0，**普通用户**（非 root）的 cdpcd，2026-10-19。未在 root 下实测的已在正文标明。
- 示例里的路径与命令名（`/srv/api/server.js`、`redis-server`、`www-data` 等）是示意性的，请按你的环境替换；标“实测”的行为用结构相同的探针配置验证过，探针已全部清理。
- 校验与默认值的出处（`node_modules/cdpc/index.js`）：目录扫描与数组模式在 `readConfig`；字段校验与默认值、解释器推导在 `_validateConfig`；cluster 约束在 `_normalizeWrap`；`name` 规则在 `_checkAppName`；`reload` 的差集语义在 `loadConfig`。预设 cgroup 组见 `cdpcd.js` 的 `mkgrp(...)`。
