'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL, URLSearchParams } = require('node:url');
const BodyMaker = require('./bodymaker.js'); 

// --------------------------------------------------------------------------
// 内部工具函数：替代 fmtpath.js
// 逻辑：格式化前缀，确保以 '/' 开头，且不以 '/' 结尾 (除非是根路径，则返回空字符串用于拼接)
// --------------------------------------------------------------------------
function formatPrefix(p) {
  if (typeof p !== 'string') return '';
  // 移除末尾的 /
  p = p.replace(/\/+$/, '');
  
  if (p.length === 0) return '';
  
  // 确保开头有 /
  if (p[0] !== '/') p = '/' + p;
  
  return p;
}

// --------------------------------------------------------------------------
// 1. 全局连接池管理
// --------------------------------------------------------------------------
const agentOptions = {
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 1024,
  maxFreeSockets: 256,
  timeout: 60000
};

const globalHttpAgent = new http.Agent(agentOptions);
const globalHttpsAgent = new https.Agent(agentOptions);
const globalInsecureAgent = new https.Agent({
  ...agentOptions,
  rejectUnauthorized: false
});

// --------------------------------------------------------------------------
// 2. GoHttp 主类
// --------------------------------------------------------------------------
class GoHttp {
  constructor(options = {}) {
    if (!(this instanceof GoHttp)) { return new GoHttp(options); }

    this.config = {
      cert: '',
      key: '',
      verifyCert: true,
      ...options
    };

    if (this.config.cert && fs.existsSync(this.config.cert)) {
      this.cert = fs.readFileSync(this.config.cert);
    }
    if (this.config.key && fs.existsSync(this.config.key)) {
      this.key = fs.readFileSync(this.config.key);
    }

    this.bodymaker = new BodyMaker(options);

    this.maxBody = 100 * 1024 * 1024
  }

  parseUrl(urlStr) {
    if (urlStr.startsWith('unix:')) {
      const sockarr = urlStr.split('.sock');
      return {
        protocol: 'http:',
        socketPath: `${sockarr[0].substring(5)}.sock`,
        path: sockarr[1] || '/',
        hostname: 'unix',
        headers: {},
        method: 'GET'
      };
    }

    try {
      const u = new URL(urlStr);
      const opts = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        method: 'GET',
        headers: {}
      };

      if (u.protocol === 'https:') {
        if (!this.config.verifyCert) {
          opts.rejectUnauthorized = false;
        } else if (this.cert && this.key) {
          opts.cert = this.cert;
          opts.key = this.key;
        }
      }
      return opts;
    } catch (err) {
      throw new Error(`Invalid URL: ${urlStr}`);
    }
  }

  _mergeQuery(opts, queryData) {
    if (!queryData) return;
    
    // 替代 qs.js：使用原生 URLSearchParams
    let qstr = '';
    if (typeof queryData === 'object') {
      qstr = new URLSearchParams(queryData).toString();
    } else {
      qstr = String(queryData);
    }

    if (!qstr) return;
    const separator = opts.path.includes('?') ? '&' : '?';
    opts.path += separator + qstr;
  }

  async request(url, options = null) {
    let opts;
    if (typeof url === 'string') {
      opts = this.parseUrl(url);
    } else if (typeof url === 'object' && url !== null) {
      opts = { ...url };
      if (!opts.path && opts.pathname) opts.path = opts.pathname;
    } else {
      throw new Error('url must be a string or object');
    }

    if (opts.timeout === undefined) opts.timeout = 35000;

    if (options && typeof options === 'object') {
      if (options.headers) opts.headers = { ...opts.headers, ...options.headers };
      if (options.query) this._mergeQuery(opts, options.query);
      for (let k in options) {
        if (k !== 'headers' && k !== 'query') opts[k] = options[k];
      }
    }

    if (!opts.headers) opts.headers = {};

    const method = (opts.method || 'GET').toUpperCase();
    opts.method = method;

    const postState = { isPost: false, bodyStream: null };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && (opts.body || opts.rawBody)) {
      postState.isPost = true;
      let contentType = opts.headers['content-type'] || '';

      // 优先处理 rawBody，如果提供了 rawBody 则直接使用它
      if (opts.rawBody) {
        let buf = Buffer.isBuffer(opts.rawBody) ? opts.rawBody : Buffer.from(opts.rawBody);
        if (!contentType.includes('multipart')) {
          opts.headers['content-length'] = buf.length;
        }
        postState.bodyStream = buf;
      }
      // 处理 multipart/form-data，仅当没有 rawBody 时才检查 body.files
      else if (contentType.includes('multipart/form-data') || (opts.body && opts.body.files)) {
        const boundary = this.bodymaker.generateBoundary();
        const length = await this.bodymaker.calculateLength(opts.body, boundary);

        opts.headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
        opts.headers['content-length'] = length;
        postState.bodyStream = this.bodymaker.makeUploadStream(opts.body, boundary);
      }
      else if (contentType === 'application/x-www-form-urlencoded') {
        // 替代 qs.js
        const payload = new URLSearchParams(opts.body).toString();
        const buf = Buffer.from(payload);
        opts.headers['content-length'] = buf.length;
        postState.bodyStream = buf;
      }
      else {
        let buf;
        if (typeof opts.body === 'object') {
          if (!contentType) opts.headers['content-type'] = 'application/json';
          buf = Buffer.from(JSON.stringify(opts.body));
        } else {
          buf = Buffer.from(String(opts.body));
        }

        if (!contentType.includes('multipart')) {
          opts.headers['content-length'] = buf.length;
        }
        postState.bodyStream = buf;
      }
    }

    if (!opts.agent) {
      if (opts.protocol === 'https:') {
        opts.agent = (!this.config.verifyCert || opts.rejectUnauthorized === false) 
          ? globalInsecureAgent 
          : globalHttpsAgent;
      } else {
        opts.agent = globalHttpAgent;
      }
    }

    if (options && options.isDownload) {
      return this._coreDownload(opts, postState);
    }
    
    return this._coreRequest(opts, postState);
  }

  _coreRequest(opts, postState) {
    const lib = (opts.protocol === 'https:') ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.request(opts, (res) => {
        // 检查是否为SSE响应
        const contentType = res.headers['content-type'] || '';
        const isSSE = contentType.includes('text/event-stream') ||
                     (contentType.includes('text/plain') && opts.sse && res.statusCode < 300);

        // 如果指定了sseCallback且是SSE响应，则使用流式处理
        if (opts.sseCallback && isSSE) {
          if (opts.encoding) res.setEncoding(opts.encoding);

          let sse_options = {headers: res.headers, status: res.statusCode};

          res.on('data', (chunk) => {
            opts.sseCallback(chunk, sse_options);
          });

          res.on('end', () => {
            opts.sseCallback(null, sse_options); // 通知结束
            resolve({
              status: res.statusCode,
              headers: res.headers,
              ok: res.statusCode >= 200 && res.statusCode < 400,
              error: null,
              timeout: false,
              text: () => '', // SSE模式下不返回文本内容
              json: () => {}, // SSE模式下不返回JSON
              blob: () => Buffer.alloc(0) // SSE模式下不返回blob
            });
          });

          res.on('error', (err) => resolve({ ok: false, error: err, status: 0 }));
        } else {
          // 传统处理方式
          if (opts.encoding) res.setEncoding(opts.encoding);
          const chunks = [];
          let totalLen = 0;

          res.on('data', (chunk) => {
            chunks.push(chunk);
            totalLen += chunk.length;
            // 限制最大 500MB
            if (totalLen > this.maxBody) {
               req.destroy();
               reject(new Error('Response body too large'));
            }
          });

          res.on('end', () => {
            const dataBuf = Buffer.concat(chunks, totalLen);
            const ret = {
              status: res.statusCode,
              headers: res.headers,
              data: dataBuf,
              length: totalLen,
              ok: res.statusCode >= 200 && res.statusCode < 400,
              error: null,
              timeout: false,
              text: (encoding = 'utf8') => dataBuf.toString(encoding),
              json: (encoding = 'utf8') => JSON.parse(dataBuf.toString(encoding)),
              blob: () => dataBuf
            };
            resolve(ret);
          });

          res.on('error', (err) => resolve({ ok: false, error: err, status: 0 }));
        }
      });

      if (opts.timeout) {
        req.setTimeout(opts.timeout, () => {
          req.destroy();
          resolve({ ok: false, timeout: true, error: new Error('Timeout'), status: 0 });
        });
      }

      req.on('error', (err) => reject(err));

      if (postState.isPost && postState.bodyStream) {
        if (typeof postState.bodyStream.pipe === 'function') {
          postState.bodyStream.pipe(req);
        } else {
          req.write(postState.bodyStream);
          req.end();
        }
      } else {
        req.end();
      }
    });
  }

  _coreDownload(opts, postState) {
    const lib = (opts.protocol === 'https:') ? https : http;
    const dir = opts.dir || './';

    return new Promise((resolve, reject) => {
      const req = lib.request(opts, (res) => {
        if (res.statusCode >= 400) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }

        let filename = '';
        const cd = res.headers['content-disposition'];
        if (cd) {
            // 简化版文件名解析
            const utf8Match = cd.match(/filename\*=utf-8''(.+)/i);
            if (utf8Match) {
                filename = decodeURIComponent(utf8Match[1]);
            } else {
                const standardMatch = cd.match(/filename="?([^";]+)"?/i);
                if (standardMatch) filename = standardMatch[1];
            }
        }
        if (!filename) filename = crypto.createHash('md5').update(Date.now().toString()).digest('hex');

        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        let targetPath = path.join(dir, filename);
        if (fs.existsSync(targetPath)) targetPath = path.join(dir, `${Date.now()}-${filename}`);

        const fileStream = fs.createWriteStream(targetPath);
        
        // 进度条逻辑
        if (opts.progress) {
            const total = parseInt(res.headers['content-length'] || 0);
            let cur = 0;
            let lastLog = 0;
            res.on('data', c => {
                cur += c.length;
                if (total > 0 && Date.now() - lastLog > 500) {
                    process.stdout.write(`Downloading: ${((cur/total)*100).toFixed(1)}%\r`);
                    lastLog = Date.now();
                }
            });
        }

        res.pipe(fileStream);

        fileStream.on('finish', () => {
            if (opts.progress) console.log('\nDone.');
            resolve(true);
        });
        fileStream.on('error', (err) => {
            fs.unlink(targetPath, () => {});
            reject(err);
        });
      });

      req.on('error', reject);
      if (postState.isPost && postState.bodyStream) {
        typeof postState.bodyStream.pipe === 'function' ? postState.bodyStream.pipe(req) : req.end(postState.bodyStream);
      } else {
        req.end();
      }
    });
  }

  // --- 便捷方法 ---
  checkMethod(method, options) {
    if (typeof options !== 'object') return { method };
    options.method = method;
    return options;
  }
  async get(url, options = {}) { return this.request(url, this.checkMethod('GET', options)); }
  async post(url, options = {}) { return this.request(url, this.checkMethod('POST', options)); }
  async put(url, options = {}) { return this.request(url, this.checkMethod('PUT', options)); }
  async patch(url, options = {}) { return this.request(url, this.checkMethod('PATCH', options)); }
  async delete(url, options = {}) { return this.request(url, this.checkMethod('DELETE', options)); }
  async options(url, options = {}) { return this.request(url, this.checkMethod('OPTIONS', options)); }

  async upload(url, options = {}) {
    options = options || {};
    options.method = 'POST';
    if (!options.body && (options.files || options.form)) {
      options.body = { files: options.files, form: options.form };
      delete options.files; delete options.form;
    }
    options.headers = options.headers || {};
    options.headers['content-type'] = 'multipart/form-data';
    return this.request(url, options);
  }

  async up(url, opts = {}) {
    if (!opts.file) throw new Error('file required');
    return this.upload(url, { ...opts, files: { [opts.name || 'file']: opts.file } });
  }

  async download(url, options = {}) {
    options = options || {};
    options.method = 'GET';
    options.isDownload = true;
    return this.request(url, options);
  }

  transmit(url, opts = {}) {
    const uobj = (typeof url === 'string') ? this.parseUrl(url) : { ...url };
    if (opts.headers) uobj.headers = { ...uobj.headers, ...opts.headers };
    uobj.timeout = opts.timeout || 35000;
    uobj.method = opts.method || 'GET';
    return this._coreRequest(uobj, { isPost: !!opts.rawbody, bodyStream: opts.rawbody || null });
  }

  connect(url, options = null) { return new HiiCompat(url, options || {}, this); }
}

// --------------------------------------------------------------------------
// 3. 兼容层
// --------------------------------------------------------------------------
class HiiCompat {
  constructor(url, options, goInstance) {
    this.req = goInstance;
    this.url = url;
    this.options = options;
    this.urlobj = this.req.parseUrl(url);
    this.host = this.urlobj.hostname;
    this.port = this.urlobj.port;
    this.headers = options.headers ? { ...options.headers } : null;
    // 使用新的工具函数
    this.__prefix__ = formatPrefix(this.urlobj.pathname);
  }

  get prefix() { return this.__prefix__; }
  set prefix(path) { this.__prefix__ = formatPrefix(path); }

  setHeader(key, val) {
    if (!this.headers) this.headers = {};
    if (typeof key === 'object') Object.assign(this.headers, key);
    else this.headers[key] = val;
    return this;
  }

  _makeOpts(opts, method) {
    const finalOpts = { ...this.options, ...opts };
    finalOpts.headers = { ...this.headers, ...finalOpts.headers };
    finalOpts.method = method;
    
    let reqPath = finalOpts.path || '';
    if (this.__prefix__ && !finalOpts.withoutPrefix) {
       if (!reqPath.startsWith(this.__prefix__)) {
         // 简单的路径拼接，避免重复斜杠
         reqPath = (this.__prefix__ + '/' + reqPath).replace('//', '/');
       }
    }
    if (finalOpts.query) {
       const qs = new URLSearchParams(finalOpts.query).toString();
       reqPath += (reqPath.includes('?') ? '&' : '?') + qs;
    }
    
    finalOpts.hostname = this.urlobj.hostname;
    finalOpts.port = this.urlobj.port;
    finalOpts.protocol = this.urlobj.protocol;
    finalOpts.path = reqPath;
    return finalOpts;
  }
  
  upload(opts) { return this.req.upload(this._makeOpts(opts, 'POST')); }
  up(opts) { return this.req.up(this._makeOpts(opts, 'POST')); }
  download(opts) { 
    const o = this._makeOpts(opts, 'GET');
    o.isDownload = true;
    return this.req.request(o); 
  }
}

;['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].forEach(method => {
  HiiCompat.prototype[method.toLowerCase()] = function(opts = {}) {
    return this.req.request(this._makeOpts(opts, method));
  };
});

module.exports = GoHttp;
