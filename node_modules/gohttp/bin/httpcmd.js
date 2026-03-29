#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { http2Connect, GoHttp} = require('../index.js'); // 引入你的核心库

// --------------------------------------------------------------------------
// 1. 参数解析逻辑 (简易版)
// --------------------------------------------------------------------------
const args = process.argv.slice(2);
const config = {
  url: '',
  method: 'GET',
  type: 'h1',      // h1 或 h2
  data: null,      // Body 数据
  file: null,      // 上传的文件路径
  uploadName: 'file',
  concurrency: 1,  // -c
  total: 1,        // -n
  headers: {},
  verifyCert: true,
  verbose: false   // 是否打印详细响应
};

function showHelp() {
  console.log(`
Usage: node httpcmd.js [options]

Options:
  -u, --url <url>      Request URL (Required)
  -t, --type <type>    Protocol: h1 (default) or h2
  -m, --method <verb>  HTTP Method (GET, POST, PUT, DELETE...)
  -d, --data <data>    Request Body (JSON string or raw string)
  -f, --file <path>    Upload file (Automatically sets method to POST)
  -c, --conc <num>     Concurrency level (Default: 1)
  -n, --num <num>      Total number of requests (Default: 1)
  -v, --verbose        Show response body (Only in non-benchmark mode)
  -H, --header <k:v>   Custom header (Can be used multiple times)
  -i, --ignore-cv      Ignore Cert Verify
  -up --upname         Upload name

Examples:
  # Simple GET
  node httpcmd.js -u https://www.baidu.com

  # HTTP/2 POST with JSON
  node httpcmd.js -t h2 -u https://nghttp2.org/httpbin/post -m POST -d '{"a":1}'

  # File Upload
  node httpcmd.js -u http://localhost:3000/upload -f ./test.jpg

  # Benchmark (1000 requests, 50 concurrency)
  node httpcmd.js -u http://127.0.0.1:8080/api -c 50 -n 1000
`);
}

// 解析参数
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-u':
    case '--url':
      config.url = args[++i];
      break;
    case '-t':
    case '--type':
      config.type = args[++i];
      break;
    case '-m':
    case '--method':
      config.method = args[++i].toUpperCase();
      break;
    case '-d':
    case '--data':
      config.data = args[++i];
      break;
    case '-f':
    case '--file':
      config.file = args[++i];
      break;
    case '--upname':
    case '-up':
      config.uploadName = args[++i];
      break;
    case '-i':
    case '--ignore-cv':
      config.verifyCert = false;
      break;
    case '-c':
    case '--conc':
      config.concurrency = parseInt(args[++i]);
      break;
    case '-n':
    case '--num':
      config.total = parseInt(args[++i]);
      break;
    case '-v':
    case '--verbose':
      config.verbose = true;
      break;
    case '-H':
    case '--header':
      const parts = args[++i].split(':');
      if (parts.length >= 2) {
        const key = parts.shift().trim();
        const val = parts.join(':').trim();
        config.headers[key] = val;
      }
      break;
    case '-h':
    case '--help':
      showHelp();
      process.exit(0);
  }
}

if (!config.url) {
  console.error('\x1b[31mError: URL is required (-u).\x1b[0m');
  showHelp();
  process.exit(1);
}

// 自动修正逻辑
if (config.file) {
  if (config.method === 'GET') config.method = 'POST'; // 上传默认 POST
}

let h1cli = new GoHttp({
  verifyCert: config.verifyCert
})

// 尝试解析 JSON Data
if (config.data) {
  try {
    config.data = JSON.parse(config.data);
    if (!config.headers['content-type']) {
      config.headers['content-type'] = 'application/json';
    }
  } catch (e) {
    // 保持字符串
  }
}

// --------------------------------------------------------------------------
// 2. 核心请求构造器
// --------------------------------------------------------------------------
async function sendRequest(client, isH2 = false) {
  const opts = {
    method: config.method,
    headers: { ...config.headers } // 浅拷贝
  };

  // 构造请求参数
  if (config.file) {
    // 使用库的上传封装
    // 注意：在压力测试中，每次都 createReadStream 可能导致 "Too many open files"
    // 但为了模拟真实 IO，这里保持流式读取
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

  // 发送请求
  if (isH2) {
    // H2 Client 已经绑定了 URL，这里只需要传 path
    // 你的 H2 库会自动处理 path 归一化
    const urlObj = new URL(config.url);
    opts.path = urlObj.pathname + urlObj.search;
    return client.request(opts);
  } else {
    // H1 Client 是无状态 Agent
    return client.request(config.url, opts);
  }
}

// --------------------------------------------------------------------------
// 3. 运行模式：单次请求
// --------------------------------------------------------------------------
async function runSingle() {
  console.log(`\x1b[36m[Info] Sending ${config.method} request to ${config.url} (${config.type.toUpperCase()})\x1b[0m`);
  
  const startTime = performance.now();
  let res;
  let client;

  try {
    if (config.type === 'h2') {
      client = http2Connect(config.url, {
                        verifyCert: config.verifyCert,
                        rejectUnauthorized: config.verifyCert});
      res = await sendRequest(client, true);
    } else {
      client = h1cli;
      res = await sendRequest(client, false);
    }

    const duration = (performance.now() - startTime).toFixed(2);
    const color = res.ok ? '\x1b[32m' : '\x1b[31m'; // 绿/红

    console.log(`Status: ${color}${res.status} ${res.ok ? 'OK' : 'Fail'}\x1b[0m`);
    console.log(`Time:   ${duration} ms`);
    console.log(`Size:   ${res.length} bytes`);
    console.log('Headers:', res.headers);

    if (config.verbose || !res.ok) {
      console.log('\n--- Body ---');
      console.log(res.text().substring(0, 2000) + (res.length > 2000 ? '\n... (truncated)' : ''));
    }

  } catch (err) {
    console.error('\x1b[31mRequest Error:\x1b[0m', err.message);
  } finally {
    if (config.type === 'h2' && client) client.close();
  }
}

// --------------------------------------------------------------------------
// 4. 运行模式：并发压测 (Benchmark)
// --------------------------------------------------------------------------
async function runBenchmark() {
  console.log(`\x1b[33m[Bench] Starting benchmark...\x1b[0m`);
  console.log(`Target: ${config.url}`);
  console.log(`Proto:  ${config.type.toUpperCase()}`);
  console.log(`Load:   ${config.concurrency} concurrent / ${config.total} total`);
  
  if (config.file) console.log(`\x1b[33mWarning: Benchmarking file upload relies on disk I/O.\x1b[0m`);

  const stats = {
    done: 0,
    success: 0,
    fail: 0,
    totalTime: 0,
    min: 999999,
    max: 0
  };

  const startTime = performance.now();
  
  // 准备工作器
  let requestsSent = 0;
  
  // 核心 Worker 函数：不断领取任务直到总量完成
  const worker = async (id) => {
    let client = null;

    // 为了模拟真实用户，如果是 H2，每个 worker 创建一个独立的 session
    if (config.type === 'h2') {
      client = http2Connect(config.url, { rejectUnauthorized: false, debug: false });
    } else {
      client = h1cli;
    }

    try {
      while (true) {
        // 原子操作：抢占一个请求配额
        if (requestsSent >= config.total) break;
        requestsSent++;

        const t0 = performance.now();
        try {
          const res = await sendRequest(client, config.type === 'h2');
          const t1 = performance.now();
          const cost = t1 - t0;

          // 记录统计数据
          stats.totalTime += cost;
          if (cost < stats.min) stats.min = cost;
          if (cost > stats.max) stats.max = cost;

          if (res.ok) stats.success++;
          else stats.fail++;
        } catch (e) {
          stats.fail++;
          // console.error(e.message); // 压测时通常不打印具体错误以免刷屏
        } finally {
          stats.done++;
          // 简单的进度条
          if (stats.done % Math.ceil(config.total / 10) === 0) {
            process.stdout.write('.');
          }
        }
      }
    } finally {
      if (config.type === 'h2' && client) client.close();
    }
  };

  // 启动所有 Worker
  const workers = [];
  for (let i = 0; i < config.concurrency; i++) {
    workers.push(worker(i));
  }

  await Promise.all(workers);
  
  const totalDuration = (performance.now() - startTime) / 1000; // 秒
  const qps = (stats.done / totalDuration).toFixed(2);
  const avg = (stats.totalTime / stats.done).toFixed(2);

  console.log('\n\n\x1b[32m[Result]\x1b[0m');
  console.log(`Duration:    ${totalDuration.toFixed(2)} sec`);
  console.log(`Requests:    ${stats.done} (Success: ${stats.success}, Fail: ${stats.fail})`);
  console.log(`QPS:         \x1b[36m${qps} req/sec\x1b[0m`);
  console.log(`Latency:     min=${stats.min.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms, avg=${avg}ms`);
}

// --------------------------------------------------------------------------
// 主入口
// --------------------------------------------------------------------------
if (config.concurrency > 1 || config.total > 1) {
  runBenchmark();
} else {
  runSingle();
}
