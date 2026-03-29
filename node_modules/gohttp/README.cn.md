# GoHttp - 高性能 Node.js 网络请求库

**GoHttp** 是一个专为生产环境设计的 Node.js HTTP/1.1 和 HTTP/2 客户端库。它专注于**低内存占用**、**流式 I/O** 和**高并发性能**。

内置了三款强大的命令行工具（`httpcmd`, `httpbench`, `httpab`），覆盖了从接口调试到大规模压力测试的全场景需求。

## 🚀 核心特性

*   **双协议支持**：无缝支持 HTTP/1.1 (Agent 复用) 和 HTTP/2 (Session 复用)。
*   **零内存积压**：文件上传和下载采用全链路流式（Streaming）处理，GB 级文件传输内存占用仅 MB 级。
*   **连接池管理**：内置智能 Agent 管理，解决高并发下的端口耗尽和握手开销问题。
*   **安全性**：支持 HTTPS 证书配置，提供安全的忽略证书模式（不污染全局环境）。
*   **工程化 CLI**：开箱即用的调试与压测工具箱。

---

## 📦 安装与引入


**安装**

```
npm i gohttp
```


```javascript
const { 
  hcli,          // HTTP/1.1 默认实例
  http2Connect,  // HTTP/2 连接工厂
  h2cli,         // HTTP/2 辅助实例
  GoHttp,        // HTTP/1.1 类
  GoHttp2        // HTTP/2 类
} = require('./index.js');
```

---

## 📖 库 API 使用指南

### 1. HTTP/1.1 请求 (hcli)

适用于常规 REST API 调用。

```javascript
// GET 请求
const res = await hcli.get('https://api.example.com/users?id=1');
console.log(res.status, res.json());

// POST JSON
await hcli.post({
  url: 'https://api.example.com/login',
  body: { user: 'admin', pass: '123' } // 自动设置 Content-Type: application/json
});

// 文件上传 (自动流式处理，支持 Multipart)
await hcli.up({
  url: 'https://api.example.com/upload',
  file: './video.mp4',
  name: 'file' // 表单字段名，默认 'file'
});

// 文件下载 (流式写入磁盘)
await hcli.download({
  url: 'https://cdn.example.com/image.png',
  dir: './downloads',
  progress: true // 显示进度条
});
```

### 2. HTTP/2 请求 (http2Connect)

适用于需要长连接、多路复用的高性能场景。

```javascript
// 1. 建立连接 (Session)
const client = http2Connect('https://http2.golang.org', {
  keepalive: true,
  verifyCert: false
});

try {
  // 2. 发送请求 (复用同一个 TCP 连接)
  const res1 = await client.get({ path: '/reqinfo' });
  console.log('Response 1:', res1.text());

  const res2 = await client.post({ 
    path: '/echo', 
    body: 'Hello H2' 
  });
  console.log('Response 2:', res2.text());

} finally {
  // 3. 关闭连接
  client.close();
}
```

### 3. 通用配置选项

无论是 `hcli` 还是 `GoHttp2`，都支持以下核心选项：

| 选项名 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `timeout` | Number | 35000 | 请求超时时间 (毫秒) |
| `headers` | Object | {} | 自定义请求头 |
| `verifyCert`| Boolean| true | 是否进行 HTTPS 证书验证，false表示忽略错误 (仅影响当前请求/连接) |
| `cert` | Path | - | 客户端证书路径 |
| `key` | Path | - | 客户端私钥路径 |

---

## 🛠️ 命令行工具箱 (CLI)

本项目提供了三个层级的命令行工具，建议链接到系统 Path 使用。

### 1. `httpcmd` - 接口调试工具
> **定位**：功能验证、单次请求调试、查看详细 Header/Body。

**用法示例：**
```bash
# 查看接口返回详情 (Verbose 模式)
npx httpcmd -u https://www.baidu.com -v

# 测试 HTTP/2 接口 + JSON POST
npx httpcmd -u https://nghttp2.org/httpbin/post -t h2 -d '{"val":1}' -v

# 快速上传文件
npx httpcmd -u http://localhost:3000/upload -f ./test.jpg
```

**参数说明：**
*   `-v`: 显示响应 Body 和详细信息。
*   `-d <json>`: 发送 Body 数据。
*   `-f <path>`: 上传文件。

---

### 2. `httpbench` - 全信息压力测试
> **定位**：单进程并发测试，提供详细的 Latency (延迟) 统计、QPS 及成功率。适用于开发阶段的性能摸底。

**用法示例：**
```bash
# 并发 50，总请求 1000 次
npx httpbench -u http://127.0.0.1:8080 -c 50 -n 1000

# 测试 HTTP/2 性能
npx httpbench -u https://localhost:8443 -t h2 -c 100 -n 5000
```

**输出示例：**
```text
QPS: 4500.23, Success: 5000/5000
Latency: min=2ms, max=50ms, avg=12ms
```

---

### 3. `httpab` - 核动力压力测试 (Cluster)
> **定位**：利用多核 CPU 发起洪水攻击。专为服务器容量规划、极限 QPS 测试设计。性能可比肩 `ab` / `wrk`。

**用法示例：**
```bash
# 启动 8 个进程，每个进程 100 并发 (总并发 800)
# 发送 10万 次请求
npx httpab -u http://127.0.0.1:8080 -p 8 -c 100 -n 100000

# HTTP/2 极限压测 (建立 8 个 H2 Session 进行多路复用)
npx httpab -u https://127.0.0.1:8443 -t h2 -p 8 -c 200 -n 500000
```

**参数说明：**
*   `-p <num>`: 启动的 Worker 进程数 (建议设置为 CPU 核心数)。
*   `-c <num>`: **每个进程**的并发数。
*   `-n <num>`: 总请求数量。

---

## ⚙️ 架构设计

### 内存管理优化
*   **传统方式**：`fs.readFileSync` -> `Buffer.concat` -> `http.request`。上传 1GB 文件需要 2GB+ 内存。
*   **GoHttp 方式**：`fs.createReadStream` -> `pipe` -> `http.request`。上传 10GB 文件仅需占用几 MB Buffer 内存。

### 连接管理
*   **HTTP/1.1**：默认启用 `keep-alive` 连接池 (`maxSockets: 1024`)，避免 TIME_WAIT 耗尽系统端口。
*   **HTTP/2**：采用单 Session 持久化连接模型，遵循 RFC 7540 标准，最大化利用多路复用特性。

---

## 📝 License

MIT
