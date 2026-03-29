#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const cluster = require('node:cluster');
const os = require('node:os');
const { URL } = require('node:url');
const { performance } = require('node:perf_hooks');
const { http2Connect, GoHttp } = require('../index.js');

// --------------------------------------------------------------------------
// 1. 参数解析与配置
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const config = {
  url: '',
  method: 'GET',
  type: 'h1',        // h1 | h2
  data: null,        // body data
  file: null,        // file path
  uploadName: 'file',
  concurrency: 1,    // -c: 单进程并发数
  total: 1,          // -n: 总请求数
  processes: os.cpus().length, // -p: 进程数 (默认全核)
  headers: {},
  verifyCert: true,
  verbose: false     // -v: 显示响应详情
};

function showHelp() {
  console.log(`
\x1b[36mSimple HTTP/1.1 & HTTP/2 Benchmark Tool (Node.js Cluster)\x1b[0m

Usage: node httpcmd.js [options]

Options:
  -u, --url <url>      Target URL (Required)
  -t, --type <type>    Protocol: h1 (default) or h2
  -m, --method <verb>  HTTP Method (GET, POST, etc.)
  -d, --data <str>     Request Body (JSON or String)
  -f, --file <path>    Upload File path
  -c, --conc <num>     Concurrency per process (Default: 1)
  -n, --num <num>      Total requests (Default: 1)
  -p, --proc <num>     Number of processes (Default: CPU cores)
  -H, --header <k:v>   Custom Header
  -v, --verbose        Show response details (Only for single request)
  -i, --ignore-cv      Ignore Cert Verify
  -up --upname         Upload name

Examples:
  # Single Request
  node httpcmd.js -u https://www.google.com -v
  
  # File Upload (H2)
  node httpcmd.js -u https://localhost:3000/upload -t h2 -f ./test.jpg
  
  # Benchmark (8 procs * 100 conc = 800 concurrent, 10000 total)
  node httpcmd.js -u http://127.0.0.1:8080 -p 8 -c 100 -n 10000
`);
}

// 手写参数解析
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-u': case '--url': config.url = args[++i]; break;
    case '-t': case '--type': config.type = args[++i]; break;
    case '-m': case '--method': config.method = args[++i].toUpperCase(); break;
    case '-d': case '--data': config.data = args[++i]; break;
    case '-f': case '--file': config.file = args[++i]; break;
    case '-up': case '--upname': config.uploadName = args[++i]; break;
    case '-i': case '--ignore-cv': config.verifyCert = false; break;
    case '-c': case '--conc': config.concurrency = parseInt(args[++i]); break;
    case '-n': case '--num': config.total = parseInt(args[++i]); break;
    case '-p': case '--proc': config.processes = parseInt(args[++i]); break;
    case '-v': case '--verbose': config.verbose = true; break;
    case '-H': case '--header':
      const parts = args[++i].split(':');
      if (parts.length >= 2) {
        config.headers[parts.shift().trim()] = parts.join(':').trim();
      }
      break;
    case '-h': case '--help': showHelp(); process.exit(0);
  }
}

// 校验
if (!config.url) {
  if (cluster.isMaster) {
    console.error('\x1b[31mError: URL is required (-u)\x1b[0m');
    showHelp();
  }
  process.exit(1);
}

// 自动修正逻辑
if (config.file && config.method === 'GET') config.method = 'POST';

let h1cli = new GoHttp({
  verifyCert: config.verifyCert
})

// 处理 JSON 数据
if (config.data) {
  try {
    config.data = JSON.parse(config.data);
    if (!config.headers['content-type']) config.headers['content-type'] = 'application/json';
  } catch (e) {
    // raw string
  }
}

// --------------------------------------------------------------------------
// 2. 核心请求构造 (Common Logic)
// --------------------------------------------------------------------------
async function sendRequest(client, isH2) {
  const opts = {
    method: config.method,
    headers: { ...config.headers }
  };

  if (config.file) {
    // 使用库的上传方法
    if (!isH2) {
      return client.up(config.url, {
        ...opts, file: config.file, name: config.uploadName
      })
    }

    return client.up({
      ...opts,
      //path: isH2 ? undefined : config.url, // H1 需要 url, H2 不需要 (Client 已绑定)
      file: config.file,
      name: config.uploadName
    });
  } else if (config.data) {
    opts.body = config.data;
  }

  if (isH2) {
    // H2 只需要路径
    const u = new URL(config.url);
    opts.path = u.pathname + u.search;
    return client.request(opts);
  } else {
    // H1 需要完整 URL
    return client.request(config.url, opts);
  }
}

// --------------------------------------------------------------------------
// 3. Worker 进程逻辑 (压测执行者)
// --------------------------------------------------------------------------
async function runWorker(taskTotal) {
  const isH2 = config.type === 'h2';
  let client = null;

  // 初始化客户端
  if (isH2) {
    // H2: 建立独立连接
    client = http2Connect(config.url, {
                        verifyCert: config.verifyCert,
                        rejectUnauthorized: config.verifyCert});
  } else {
    // H1: 使用全局单例 Agent
    client = h1cli;
  }

  let successCount = 0;
  let failCount = 0;
  let processedCount = 0;
  
  // 共享计数器，用于替代 p-limit 实现并发控制
  let remaining = taskTotal;

  // 核心并发循环函数
  const workerLoop = async () => {
    while (true) {
      // 1. 同步检查剩余任务
      if (remaining <= 0) break;
      
      // 2. 扣减任务 (JS 单线程特性保证了这里的原子性)
      remaining--; 

      // 3. 执行请求
      try {
        const res = await sendRequest(client, isH2);
        if (res.ok) successCount++;
        else failCount++;
      } catch (err) {
        failCount++;
      }

      // 4. 汇报进度 (减少 IPC 通信频率，每 50 个请求汇报一次)
      processedCount++;
      if (processedCount % 50 === 0) {
        process.send({ type: 'progress', count: 50 });
        processedCount = 0;
      }
    }
  };

  // 启动 N 个并发循环
  const threads = [];
  for (let i = 0; i < config.concurrency; i++) {
    threads.push(workerLoop());
  }

  // 等待所有循环结束
  await Promise.all(threads);

  // 汇报剩余的进度
  if (processedCount > 0) {
    process.send({ type: 'progress', count: processedCount });
  }

  // 汇报最终结果
  process.send({ type: 'done', success: successCount, fail: failCount });

  // 清理资源
  if (isH2 && client) client.close();
  process.exit(0);
}

// --------------------------------------------------------------------------
// 4. Master 进程逻辑 (单次模式 & 调度模式)
// --------------------------------------------------------------------------

// --- 模式 A: 单次详细请求 (-n 1) ---
async function runSingleMode() {
  console.log(`\x1b[36m[Info] Request -> ${config.url} (${config.type.toUpperCase()})\x1b[0m`);
  const isH2 = config.type === 'h2';
  let client = null;

  try {
    const t0 = performance.now();
    
    if (isH2) client = http2Connect(config.url, { rejectUnauthorized: false });
    else client = h1cli;

    const res = await sendRequest(client, isH2);
    const cost = (performance.now() - t0).toFixed(2);

    const color = res.ok ? '\x1b[32m' : '\x1b[31m';
    console.log(`Status: ${color}${res.status} ${res.ok ? 'OK' : 'FAIL'}\x1b[0m`);
    console.log(`Time:   ${cost} ms`);
    console.log(`Size:   ${res.length} bytes`);
    
    if (config.verbose) {
      console.log('Headers:', res.headers);
      console.log('\n--- Body ---');
      const bodyStr = res.text();
      console.log(bodyStr.length > 2000 ? bodyStr.substring(0, 2000) + '\n...(truncated)' : bodyStr);
    }
  } catch (err) {
    console.error('\x1b[31mError:\x1b[0m', err.message);
  } finally {
    if (isH2 && client) client.close();
  }
}

// --- 模式 B: Cluster 压测 (-n > 1) ---
function runClusterMode() {
  console.log(`\x1b[33m[Bench] Cluster Mode Enabled\x1b[0m`);
  console.log(`Target:    ${config.url}`);
  console.log(`Processes: ${config.processes}`);
  console.log(`Conc/Proc: ${config.concurrency}`);
  console.log(`Total Req: ${config.total}`);

  const startTime = performance.now();
  let totalDone = 0;
  let totalSuccess = 0;
  let totalFail = 0;
  let workersActive = config.processes;

  // 任务分配计算
  const baseTask = Math.floor(config.total / config.processes);
  let remainder = config.total % config.processes;

  for (let i = 0; i < config.processes; i++) {
    const taskCount = baseTask + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;

    // 启动 Worker 并发送任务
    const worker = cluster.fork();
    worker.send({ cmd: 'start', total: taskCount });

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        totalDone += msg.count;
        // 进度条显示 (每 5% 显示一个点)
        if (totalDone % Math.ceil(config.total / 20) === 0) {
          process.stdout.write('.');
        }
      } else if (msg.type === 'done') {
        totalSuccess += msg.success;
        totalFail += msg.fail;
        workersActive--;
        if (workersActive === 0) {
          printReport();
        }
      }
    });
  }

  function printReport() {
    const duration = (performance.now() - startTime) / 1000;
    const qps = (totalDone / duration).toFixed(2);
    
    console.log('\n\n\x1b[32m=== Benchmark Result ===\x1b[0m');
    console.log(`Time Taken:   ${duration.toFixed(3)} seconds`);
    console.log(`Total Reqs:   ${totalDone}`);
    console.log(`Success:      ${totalSuccess}`);
    console.log(`Failed:       ${totalFail}`);
    console.log(`QPS (RPS):    \x1b[36m${qps}\x1b[0m`);
    console.log(`Avg Latency:  ${(duration * 1000 / totalDone * config.concurrency * config.processes).toFixed(2)} ms (Estimated)`);
    process.exit(0);
  }
}

// --------------------------------------------------------------------------
// 主入口
// --------------------------------------------------------------------------
if (cluster.isMaster) {
  // Master 决定运行模式
  if (config.total > 1) {
    runClusterMode();
  } else {
    runSingleMode();
  }
} else {
  // Worker 等待指令
  process.on('message', (msg) => {
    if (msg.cmd === 'start') {
      runWorker(msg.total || 0);
    }
  });
}