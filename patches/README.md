# node_modules 本地补丁

本仓库把 `node_modules` 纳入了 git，所以对依赖的本地改动是持久的——
但 `npm install` / `npm ci` 会用 registry 的原始包覆盖它们，**且不会有任何提示**。
每次动过依赖之后，用这里的补丁核对一遍。

补丁同时是搬运凭据：这些改动最终应当回到依赖自己的源码仓库并发版，
本地补丁只是过渡。

**纯文档改动不出补丁**（依赖包里的 README 等）：它们没有任何运行时影响，
出补丁只会得到一份没人会去 review 的大 diff。这类改动以上游源码仓库为准，
同步时直接在那边改。

## cdpc-6.1.2-setmaxtree.patch

给 `cdpc@6.1.2` 加一个静态方法 `CDPC.setMaxTree(n)`，用来设定进程树明细
列表的上限 `TREE_PROC_LIMIT`（原本是写死的模块常量 20，无任何入口）。

    CDPC.setMaxTree(100)   // 立即生效，下次采集进程树即按新值

· 静态方法，不挂原型：它改的是模块级变量，对本进程内所有实例一起生效。
· 参数必须是 [10, 10000] 的整数；非法值**抛出**（TypeError / RangeError）
  而不是静默回退默认值——这是启动期配置调用，写错了就该当场知道。
· 它只约束"逐进程列出多少个"以及随之而来的 cmdline 读取次数；
  整棵子树一直是完整遍历的，cpuTotal / memTotal / procCount 不受影响。

补丁**只提供机制**，库层默认值仍是 20；本仓库取多少是上层策略，
写在 `cdpcd.js` 里：默认 50，可由环境变量 `CDPCD_MAX_TREE`（[10, 200]）覆盖。

## cdpc-6.1.2-load-abort.patch

修一个会让**其他服务凭空消失**的问题：`checkConfig` 只在配了 `file` 时才强制
`command`，所以"既没有 file 也没有 command"的配置能通过校验，走到
`startChild` 就是 `spawn(undefined)` —— Node 同步抛 `ERR_INVALID_ARG_TYPE`，
异常穿过 `tryMakeChild` / `runChilds` 冲出 `loadConfig`，**这一批里排在它后面的
配置一个都不会被加载**。现场只有一条 `--ERR-LOAD-CONFIG--`，而加载报告里是个
看着人畜无害的 `loaded: 0`。

两处改动：

· `startChild`：spawn 前挡住空 command，按已有的 CMDLINE-CHECK 早退套路置
  `state=ERROR` + `cause=NO-COMMAND|START|...` 后返回，服务在 status / inspect
  里看得见也说得出原因。
· `runChilds`：`tryMakeChild` 包 try/catch，异常并入 `failures`，与 checkConfig
  失败走同一条上报链路（`failures` → `skipped` → `onLoadConfig`）。
  捕获后**不**清理可能已登记的 chk：status 里看得见一个 ERROR 的服务，
  远好过它凭空消失。

## 应用与核对

两份补丁互不重叠，按顺序应用（在仓库根目录）：

    git apply patches/cdpc-6.1.2-setmaxtree.patch  --directory=node_modules/cdpc
    git apply patches/cdpc-6.1.2-load-abort.patch  --directory=node_modules/cdpc

核对是否仍然生效：

    node -e 'console.log(typeof require("cdpc").setMaxTree)'      # function
    grep -c 'ERR-MAKE-CHILD' node_modules/cdpc/index.js           # 1
