'use strict';

const http2 = require('node:http2');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL, URLSearchParams } = require('node:url');
const { PassThrough } = require('node:stream');
const BodyMaker = require('./bodymaker.js');

// --------------------------------------------------------------------------
// 工具函数
// --------------------------------------------------------------------------
function formatPrefix(p) {
  if (typeof p !== 'string') return '';
  p = p.replace(/\/+$/, '');
  if (p.length === 0) return '';
  if (p[0] !== '/') p = '/' + p;
  return p;
}

// --------------------------------------------------------------------------
// HTTP/2 Client 类 (单 Session 管理)
// --------------------------------------------------------------------------
class GoHttp2 {
  constructor(urlStr, options = {}) {
    this.urlStr = urlStr;
    this.options = {
      verifyCert: true,
      rejectUnauthorized: true, // 默认安全，verifyCert: true 时改为 false
      timeout: 15000,
      keepalive: true,
      reconnDelay: 1000,
      debug: false,
      ...options
    };

    if (!this.options.verifyCert) {
      this.options.rejectUnauthorized = false;
    }

    this.maxBody = 200 * 1024 * 1024;
    if (options.maxBody && typeof options.maxBody === 'number') {
      this.maxBody = options.maxBody;
    }

    this.bodymaker = new BodyMaker(options);
    
    // 内部状态
    this.session = null;
    this.connecting = false;
    this.closed = false; // 用户主动关闭
    this._reconnectTimer = null;
    
    // 解析 URL
    try {
      this.urlobj = new URL(urlStr);
    } catch (e) {
      throw new Error(`Invalid URL: ${urlStr}`);
    }

    // 初始化前缀 (兼容旧逻辑)
    this.prefix = this.urlobj.pathname !== '/' ? formatPrefix(this.urlobj.pathname) : '';

    // 立即连接
    this._connect();
  }

  // ----------------------------------------------------------------------
  // 连接管理 (核心逻辑)
  // ----------------------------------------------------------------------
  _connect() {
    if (this.session && !this.session.destroyed) return;
    if (this.closed) return;

    this.connecting = true;

    const connectOpts = {
      rejectUnauthorized: this.options.rejectUnauthorized,
      // 启用对端最大并发流设置
      peerMaxConcurrentStreams: 100, 
      settings: {
        enablePush: false,
        initialWindowSize: 6291456, // 6MB 窗口，提升大文件传输速度
      }
    };

    if (this.options.checkServerIdentity) {
        connectOpts.checkServerIdentity = this.options.checkServerIdentity;
    }

    try {
      if (this.options.debug) console.log(`[H2] Connecting to ${this.urlobj.origin}...`);
      
      this.session = http2.connect(this.urlobj.origin, connectOpts);

      this.session.on('connect', () => {
        this.connecting = false;
        if (this.options.debug) console.log('[H2] Connected.');
      });

      this.session.on('error', (err) => {
        if (this.options.debug) console.error('[H2] Session Error:', err.message);
        // Error 会触发 close，逻辑在 close 中处理
      });

      this.session.on('close', () => {
        this.session = null;
        this.connecting = false;
        if (!this.closed && this.options.keepalive) {
          this._scheduleReconnect();
        }
      });
      
      this.session.on('goaway', () => {
         // 服务器通知即将关闭，不再发送新请求，但在 keepalive 模式下我们会尝试重建 session
         if (this.options.debug) console.warn('[H2] Session GOAWAY');
      });

    } catch (err) {
      this.connecting = false;
      if (this.options.debug) console.error('[H2] Connect Throw:', err);
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.closed || this._reconnectTimer) return;
    if (this.options.debug) console.log(`[H2] Reconnecting in ${this.options.reconnDelay}ms...`);
    
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, this.options.reconnDelay);
  }

  /**
   * 等待连接可用
   */
  async _waitForConnection() {
    if (this.session && !this.session.destroyed && !this.session.closed) {
      return this.session;
    }
    
    if (this.closed) throw new Error('Client is closed');

    // 如果断开了，尝试触发连接
    if (!this.connecting) this._connect();

    // 轮询等待 (比 EventEmitter 更简单且不易内存泄漏)
    let waitCount = 0;
    while (waitCount < 50) { // 最多等 5秒 (50 * 100ms)
      await new Promise(r => setTimeout(r, 100));
      if (this.session && !this.session.destroyed && !this.session.closed) {
        return this.session;
      }
      waitCount++;
    }
    throw new Error('Connection timeout or failed');
  }

  // ----------------------------------------------------------------------
  // 请求核心
  // ----------------------------------------------------------------------
  async request(reqobj) {
    // 1. 预处理参数
    reqobj = this._normalizeOptions(reqobj);
    
    // 2. 准备 Headers
    const headers = {
      ':method': reqobj.method,
      ':path': reqobj.path,
      ...reqobj.headers
    };

    // 3. 处理 Body (流式)
    let bodyStream = null;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(reqobj.method) && (reqobj.body || reqobj.rawBody)) {
      // Logic mirrors gohttp.js optimization
      let contentType = headers['content-type'] || '';

      // 优先处理 rawBody，如果提供了 rawBody 则直接使用它
      if (reqobj.rawBody) {
         let buf = Buffer.isBuffer(reqobj.rawBody) ? reqobj.rawBody : Buffer.from(reqobj.rawBody);
         // HTTP/2 推荐尽量带 content-length
         if (!contentType.includes('multipart')) {
            headers['content-length'] = buf.length;
         }
         bodyStream = buf;
      }
      // Multipart
      else if (contentType.includes('multipart/form-data') || reqobj.multipart) {
        const boundary = this.bodymaker.generateBoundary();
        const len = await this.bodymaker.calculateLength(reqobj.body, boundary);
        headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
        headers['content-length'] = len;
        bodyStream = this.bodymaker.makeUploadStream(reqobj.body, boundary);
      }
      // UrlEncoded
      else if (contentType === 'application/x-www-form-urlencoded') {
        const payload = new URLSearchParams(reqobj.body).toString();
        const buf = Buffer.from(payload);
        headers['content-length'] = buf.length;
        bodyStream = buf;
      }
      // JSON / Raw
      else {
         let buf;
         if (Buffer.isBuffer(reqobj.body)) {
             buf = reqobj.body;
         } else if (typeof reqobj.body === 'object') {
             if (!contentType) headers['content-type'] = 'application/json';
             buf = Buffer.from(JSON.stringify(reqobj.body));
         } else {
             buf = Buffer.from(String(reqobj.body));
         }
         // HTTP/2 推荐尽量带 content-length
         if (!contentType.includes('multipart')) {
            headers['content-length'] = buf.length;
         }
         bodyStream = buf;
      }
    }

    // 4. 获取 Session 并发送
    const session = await this._waitForConnection();
    
    // 发起请求 (options 可以包含 endStream: false 等)
    const req = session.request(headers, reqobj.options || {});

    // 设置超时
    if (reqobj.timeout) {
      req.setTimeout(reqobj.timeout, () => {
        req.close(http2.constants.NGHTTP2_CANCEL);
      });
    }

    // 5. 如果有下载需求，转交给 download 处理器
    if (reqobj.isDownload) {
      return this._handleDownload(req, reqobj, bodyStream);
    }

    // 6. 普通请求处理
    return new Promise((resolve, reject) => {
      const response = {
        headers: {},
        status: 0,
        ok: false,
        data: null, // Buffer
        text: () => (response.data ? response.data.toString() : ''),
        json: () => JSON.parse(response.data.toString()),
        blob: () => {
          return response.data
        }
      };

      // 根据是否有sseCallback和是否为SSE响应决定处理方式
      if (reqobj.sseCallback) {
        req.on('response', (headers, flags) => {
          response.headers = headers;
          response.status = headers[':status'];
          response.ok = response.status >= 200 && response.status < 400;

          // 检查是否为SSE响应
          const contentType = headers['content-type'] || '';
          const isSSEType = contentType.includes('text/event-stream') ||
                           (contentType.includes('text/plain') && reqobj.sse && response.ok);

          if (isSSEType) {
            // 使用SSE回调处理
            let sse_options = { headers, status: response.status };

            req.on('data', (chunk) => {
              reqobj.sseCallback(chunk, sse_options);
            });

            req.on('end', () => {
              reqobj.sseCallback(null, sse_options); // 通知结束
              resolve({
                status: response.status,
                headers: response.headers,
                ok: response.ok,
                data: null,
                text: () => '', // SSE模式下不返回文本内容
                json: () => {}, // SSE模式下不返回JSON
                blob: () => Buffer.alloc(0) // SSE模式下不返回blob
              });
            });
          } else {
            // 非SSE响应，继续使用传统处理方式
            const chunks = [];
            let totalLen = 0;

            req.on('data', (chunk) => {
              chunks.push(chunk);
              totalLen += chunk.length;
              // 简单防护
              if (totalLen > this.maxBody) {
                  req.close();
                  reject(new Error('Response too large'));
              }
            });

            req.on('end', () => {
              response.data = Buffer.concat(chunks, totalLen);
              resolve(response);
            });
          }
        });
      } else {
        // 无SSE回调，使用传统处理方式
        const chunks = [];
        let totalLen = 0;

        req.on('response', (headers, flags) => {
          response.headers = headers;
          response.status = headers[':status'];
          response.ok = response.status >= 200 && response.status < 400;
        });

        req.on('data', (chunk) => {
          chunks.push(chunk);
          totalLen += chunk.length;
          // 简单防护
          if (totalLen > this.maxBody) {
              req.close();
              reject(new Error('Response too large'));
          }
        });

        req.on('end', () => {
          response.data = Buffer.concat(chunks, totalLen);
          resolve(response);
        });
      }

      req.on('error', (err) => reject(err));

      // 发送 Body
      if (bodyStream) {
        if (typeof bodyStream.pipe === 'function') {
            bodyStream.pipe(req);
        } else {
            req.write(bodyStream);
            req.end();
        }
      } else {
        req.end();
      }
    });
  }

  // ----------------------------------------------------------------------
  // 下载处理 (流式，去除了 Sync)
  // ----------------------------------------------------------------------
  _handleDownload(req, reqobj, bodyStream) {
    return new Promise((resolve, reject) => {
      let isResolved = false; // 防止多次 resolve/reject
      
      req.on('response', (headers) => {
        const status = headers[':status'];
        if (status >= 400) {
          isResolved = true;
          reject(new Error(`Download failed with status: ${status}`));
          req.close();
          return;
        }

        // 文件名解析
        let filename = '';
        const cd = headers['content-disposition'];
        if (cd) {
             const utf8Match = cd.match(/filename\*=utf-8''(.+)/i);
             if (utf8Match) {
                 filename = decodeURIComponent(utf8Match[1]);
             } else {
                 const standardMatch = cd.match(/filename="?([^";]+)"?/i);
                 if (standardMatch) filename = standardMatch[1];
             }
        }
        if (!filename) {
            filename = crypto.createHash('md5').update(Date.now().toString()).digest('hex');
        }

        const dir = reqobj.dir || './';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // 路径去重逻辑
        let targetPath = path.join(dir, filename);
        if (fs.existsSync(targetPath)) {
            // 简单处理：覆盖或者重命名，这里沿用你的重命名逻辑
             targetPath = path.join(dir, `${Date.now()}-${filename}`);
        }

        const fileStream = fs.createWriteStream(targetPath);
        
        // 进度
        if (reqobj.progress) {
             const total = parseInt(headers['content-length'] || 0);
             let cur = 0;
             let lastLog = 0;
             req.on('data', c => {
                 cur += c.length;
                 if (total > 0 && Date.now() - lastLog > 800) {
                     process.stdout.write(`[H2] Downloading: ${((cur/total)*100).toFixed(1)}%\r`);
                     lastLog = Date.now();
                 }
             });
        }

        req.pipe(fileStream);

        fileStream.on('finish', () => {
             if (reqobj.progress) console.log('\n[H2] Download Done.');
             if (!isResolved) resolve({ ok: true, path: targetPath });
        });
        
        fileStream.on('error', (err) => {
             if (!isResolved) reject(err);
        });
      });

      req.on('error', (err) => {
          if (!isResolved) reject(err);
      });

      // 发送 Body (如下载接口需要 POST 参数)
      if (bodyStream) {
        if (typeof bodyStream.pipe === 'function') bodyStream.pipe(req);
        else { req.write(bodyStream); req.end(); }
      } else {
        req.end();
      }
    });
  }

  // ----------------------------------------------------------------------
  // 参数归一化
  // ----------------------------------------------------------------------
  _normalizeOptions(reqobj) {
    // 兼容 { method: 'GET' } 或直接传 path 字符串的情况 (如果调用层封装过)
    if (!reqobj.headers) reqobj.headers = {};
    
    if (!reqobj.method) reqobj.method = 'GET';
    reqobj.method = reqobj.method.toUpperCase();

    // 路径处理
    let reqPath = reqobj.path || reqobj.pathname || '/';
    
    // 前缀处理 (H2 中 :path 必须是完整路径)
    if (this.prefix && !reqobj.withoutPrefix) {
      if (!reqPath.startsWith(this.prefix)) {
        reqPath = path.posix.join(this.prefix, reqPath);
      }
    }

    // Query 处理
    if (reqobj.query) {
      const q = new URLSearchParams(reqobj.query).toString();
      reqPath += (reqPath.includes('?') ? '&' : '?') + q;
    }

    reqobj.path = reqPath;

    if (!reqobj.timeout) reqobj.timeout = 15000;
    
    // 自动兼容 upload 语法糖
    if (reqobj.files || reqobj.form) {
        if (!reqobj.body) reqobj.body = { files: reqobj.files, form: reqobj.form };
        reqobj.multipart = true;
        reqobj.method = 'POST'; // 强制 POST
    }

    return reqobj;
  }

  // ----------------------------------------------------------------------
  // 公共 API (语法糖)
  // ----------------------------------------------------------------------
  async get(reqobj) { reqobj.method = 'GET'; return this.request(reqobj); }
  async post(reqobj) { reqobj.method = 'POST'; return this.request(reqobj); }
  async put(reqobj) { reqobj.method = 'PUT'; return this.request(reqobj); }
  async patch(reqobj) { reqobj.method = 'PATCH'; return this.request(reqobj); }
  async delete(reqobj) { reqobj.method = 'DELETE'; return this.request(reqobj); }
  
  async upload(reqobj) { 
      reqobj.multipart = true; 
      if(!reqobj.method) reqobj.method = 'POST';
      return this.request(reqobj);
  }

  async up(reqobj) {
    if (!reqobj.file) throw new Error('file required');
    return this.upload({ ...reqobj, files: { [reqobj.name || 'file']: reqobj.file } });
  }

  async download(reqobj) {
      reqobj.method = 'GET';
      reqobj.isDownload = true;
      return this.request(reqobj);
  }

  close() {
    this.closed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.session && !this.session.destroyed) {
      this.session.close();
    }
  }
}

// --------------------------------------------------------------------------
// 为了兼容旧的 SessionPool 接口，如果真的有人需要海量连接
// --------------------------------------------------------------------------
class SessionPool {
  constructor(url, options = {}) {
    this.max = options.max || 1; // HTTP/2 通常 1 个就够了
    this.pool = [];
    this.cursor = 0;
    
    for (let i = 0; i < this.max; i++) {
      this.pool.push(new H2Client(url, options));
    }
  }

  _getClient() {
    // 简单的轮询负载均衡
    const client = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    return client;
  }

  // 代理所有方法
  async request(reqobj) { return this._getClient().request(reqobj); }
  async get(reqobj) { return this._getClient().get(reqobj); }
  async post(reqobj) { return this._getClient().post(reqobj); }
  async put(reqobj) { return this._getClient().put(reqobj); }
  async upload(reqobj) { return this._getClient().upload(reqobj); }

  async up(reqobj) {return this.upload(reqobj);}

  async download(reqobj) { return this._getClient().download(reqobj); }
  
  close() { this.pool.forEach(c => c.close()); }
}

GoHttp2.SessionPool = SessionPool

module.exports = GoHttp2;
