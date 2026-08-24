# node_modules 本地补丁

本仓库把 `node_modules` 纳入了 git，所以对依赖的本地改动是持久的——
但 `npm install` / `npm ci` 会用 registry 的原始包覆盖它们，**且不会有任何提示**。
每次动过依赖之后，用这里的补丁核对一遍。

补丁同时是搬运凭据：这些改动最终应当回到依赖自己的源码仓库并发版，
本地补丁只是过渡。

## cdpc-6.1.2-tree-proc-limit-50.patch

`cdpc@6.1.2` 的 `index.js`：进程树明细列表上限 `TREE_PROC_LIMIT` 20 → 50。

20 对 `cdpc status <名字> -l` 太紧——稍微多几个 worker 就有一截看不到，
而这个命令的用途恰恰是看清某一个服务。注意它只约束"逐进程列出多少个"，
CPU / MEM 合计一直是按整棵树求和的，不受此值影响。

应用方式（在仓库根目录）：

    git apply patches/cdpc-6.1.2-tree-proc-limit-50.patch --directory=node_modules/cdpc

核对是否仍然生效：

    grep -n 'TREE_PROC_LIMIT = ' node_modules/cdpc/index.js
