# GoHttp - High-Performance Node.js Network Library

**GoHttp** is a production-ready HTTP/1.1 and HTTP/2 client library for Node.js. It is engineered for **low memory footprint**, **streaming I/O**, and **high concurrency**.

It includes three powerful command-line tools (`httpcmd`, `httpbench`, `httpab`) covering everything from API debugging to massive-scale stress testing.

## 🚀 Key Features

*   **Dual Protocol Support**: Seamless support for HTTP/1.1 (Agent reuse) and HTTP/2 (Session reuse).
*   **Zero Memory Bloat**: Full streaming support for file uploads and downloads. Transfer GB-sized files with only MB-sized memory usage.
*   **Connection Pooling**: Built-in smart Agent management to prevent port exhaustion and reduce handshake overhead.
*   **Security**: Supports HTTPS certificate configuration and provides a safe "ignore certificate" mode (scoped to the specific request, avoiding global environment pollution).
*   **Engineering CLI**: Out-of-the-box toolkit for debugging and benchmarking.

---

## 📦 Installation & Usage

**Install**

```
npm i gohttp
```

```javascript
const { 
  hcli,          // HTTP/1.1 Default Instance
  http2Connect,  // HTTP/2 Connection Factory
  h2cli,         // HTTP/2 Helper Instance
  GoHttp,        // HTTP/1.1 Class
  GoHttp2        // HTTP/2 Class
} = require('./index.js');
```

---

## 📖 API Reference

### 1. HTTP/1.1 Requests (hcli)

Suitable for standard REST API calls.

```javascript
// GET Request
const res = await hcli.get('https://api.example.com/users?id=1');
console.log(res.status, res.json());

// POST JSON
await hcli.post({
  url: 'https://api.example.com/login',
  body: { user: 'admin', pass: '123' } // Auto-sets Content-Type: application/json
});

// File Upload (Streaming, supports Multipart)
await hcli.up({
  url: 'https://api.example.com/upload',
  file: './video.mp4',
  name: 'file' // Form field name, default is 'file'
});

// File Download (Streaming to disk)
await hcli.download({
  url: 'https://cdn.example.com/image.png',
  dir: './downloads',
  progress: true // Show progress bar
});
```

### 2. HTTP/2 Requests (http2Connect)

Suitable for high-performance scenarios requiring persistent connections and multiplexing.

```javascript
// 1. Establish Connection (Session)
const client = http2Connect('https://http2.golang.org', {
  keepalive: true,
  verifyCert: false
});

try {
  // 2. Send Requests (Multiplexing over the same TCP connection)
  const res1 = await client.get({ path: '/reqinfo' });
  console.log('Response 1:', res1.text());

  const res2 = await client.post({ 
    path: '/echo', 
    body: 'Hello H2' 
  });
  console.log('Response 2:', res2.text());

} finally {
  // 3. Close Connection
  client.close();
}
```

### 3. Common Configuration

Both `hcli` and `GoHttp2` support the following options:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `timeout` | Number | 35000 | Request timeout (ms). |
| `headers` | Object | {} | Custom request headers. |
| `verifyCert`| Boolean| true | Verify HTTPS certificate, ignore the errors if verifyCert is false(Scoped to current request/connection). |
| `cert` | Path | - | Path to client certificate. |
| `key` | Path | - | Path to client private key. |

---

## 🛠️ CLI Toolkit

This project provides three tiers of command-line tools. It is recommended to link them to your system PATH.

### 1. `httpcmd` - Interface Debugger
> **Purpose**: Functional verification, single request debugging, viewing detailed Headers/Body.

**Examples:**
```bash
# View detailed response (Verbose mode)
npx httpcmd -u https://www.google.com -v

# Test HTTP/2 interface + JSON POST
npx httpcmd -u https://nghttp2.org/httpbin/post -t h2 -d '{"val":1}' -v

# Quick file upload
npx httpcmd -u http://localhost:3000/upload -f ./test.jpg
```

**Options:**
*   `-v`: Verbose output (show body and headers).
*   `-d <json>`: Send body data.
*   `-f <path>`: Upload a file.

---

### 2. `httpbench` - Full-Info Benchmark
> **Purpose**: Single-process concurrency testing. Provides detailed **Latency** statistics, QPS, and success rates. Ideal for performance profiling during development.

**Examples:**
```bash
# 50 concurrent connections, 1000 total requests
npx httpbench -u http://127.0.0.1:8080 -c 50 -n 1000

# Test HTTP/2 performance
npx httpbench -u https://localhost:8443 -t h2 -c 100 -n 5000
```

**Output Example:**
```text
QPS: 4500.23, Success: 5000/5000
Latency: min=2ms, max=50ms, avg=12ms
```

---

### 3. `httpab` - Cluster Stress Test
> **Purpose**: Uses multi-core CPUs to launch a "flood" attack. Designed for server capacity planning and maximum QPS testing. Comparable to `ab` or `wrk` in raw power.

**Examples:**
```bash
# Launch 8 processes, 100 concurrency per process (Total 800 concurrency)
# Send 100,000 requests
npx httpab -u http://127.0.0.1:8080 -p 8 -c 100 -n 100000

# HTTP/2 Extreme Stress Test (Establishes 8 H2 Sessions for multiplexing)
npx httpab -u https://127.0.0.1:8443 -t h2 -p 8 -c 200 -n 500000
```

**Options:**
*   `-p <num>`: Number of Worker processes (Recommend setting to CPU core count).
*   `-c <num>`: Concurrency **per process**.
*   `-n <num>`: Total number of requests.

---

## ⚙️ Architecture Design

### Memory Optimization
*   **Traditional Approach**: `fs.readFileSync` -> `Buffer.concat` -> `http.request`. Uploading a 1GB file requires 2GB+ RAM.
*   **GoHttp Approach**: `fs.createReadStream` -> `pipe` -> `http.request`. Uploading a 10GB file requires only a few MB of buffer memory.

### Connection Management
*   **HTTP/1.1**: Uses a `keep-alive` connection pool (`maxSockets: 1024`) by default to avoid exhausting system ports (TIME_WAIT).
*   **HTTP/2**: Adopts a single-session persistent connection model, complying with RFC 7540 to maximize multiplexing efficiency.

---

## 📝 License

MIT
