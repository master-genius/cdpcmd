'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');


const MIME_TABLE = {
  'css'   : 'text/css',
    'der'   : 'application/x-x509-ca-cert',
    'gif'   : 'image/gif',
    'gz'    : 'application/x-gzip',
    'h'     : 'text/plain',
    'htm'   : 'text/html',
    'html'  : 'text/html',
    'c'     : 'text/plain',
    'txt'   : 'text/plain',
    'js'    : 'application/x-javascript',
    
    'jpg'   : 'image/jpeg',
    'jpeg'  : 'image/jpeg',
    'png'   : 'image/png',
    'gif'   : 'image/gif',
    'webp'  : 'image/webp',

    'mp3'   : 'audio/mpeg',
    'mp4'   : 'video/mp4',
    'webm'  : 'video/webm',
    
    'exe'   : 'application/octet-stream',
    
    'wav'   : 'audio/x-wav',
    'svg'   : 'image/svg+xml',
    'tar'   : 'application/x-tar',
    
    'ttf'   : 'font/ttf',
    'wtf'   : 'font/wtf',
    'woff'  : 'font/woff',
    'woff2' : 'font/woff2',
    'ttc'   : 'font/ttc',

    'xls'   : 'application/vnd.ms-excel',
    'gz'    : 'application/x-gzip',
    'zip'   : 'application/zip',
    'pdf'   : 'application/pdf',

    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/vnd.ms-word',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

    'odp': 'application/vnd.oasis.opendocument.presentation',
    'odt': 'application/vnd.oasis.opendocument.text',
    'ods': 'application/vnd.oasis.opendocument.spreadsheet',
    'odg': 'application/vnd.oasis.opendocument.graphics'
};

class BodyMaker {
  constructor(options = {}) {
    this.default_mime = 'application/octet-stream';
  }

  _getMime(filename) {
    const ext = path.extname(filename).toLowerCase().slice(1);
    return MIME_TABLE[ext] || this.default_mime;
  }

  _fmtName(name) {
    return name.replace(/"/g, '%22');
  }

  generateBoundary() {
    return '----------------' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  }

  /**
   * 核心优化：返回流和长度，而不是巨大的 Buffer
   */
  makeUploadStream(data, boundary) {
    const pass = new PassThrough();
    const CRLF = '\r\n';
    let length = 0;

    // 使用 Async Generator 依次推入数据，避免一次性加载
    (async () => {
      try {
        // 1. 处理普通 Form 字段
        if (data.form) {
          for (const key in data.form) {
            const head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${this._fmtName(key)}"${CRLF}${CRLF}`;
            const tail = `${data.form[key]}${CRLF}`;
            pass.write(head);
            pass.write(tail);
          }
        }

        // 2. 处理文件
        if (data.files) {
          for (const key in data.files) {
            // 归一化为数组
            const fileList = Array.isArray(data.files[key]) ? data.files[key] : [data.files[key]];

            for (const filePath of fileList) {
              const fileName = path.basename(filePath);
              const mimeType = this._getMime(fileName);
              
              const head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${this._fmtName(key)}"; filename="${this._fmtName(fileName)}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`;
              
              pass.write(head);

              // 管道流传输文件数据
              await new Promise((resolve, reject) => {
                const fileStream = fs.createReadStream(filePath);
                fileStream.on('error', reject);
                fileStream.on('end', () => {
                   pass.write(CRLF); // 文件结束后的换行
                   resolve();
                });
                fileStream.pipe(pass, { end: false });
              });
            }
          }
        }

        // 3. 结束 Boundary
        pass.end(`--${boundary}--${CRLF}`);
      } catch (err) {
        pass.destroy(err);
      }
    })();

    return pass;
  }
  
  /**
   * 计算 Content-Length (为了 HTTP 头)
   * 注意：这需要同步 stat 文件，但比读取文件内容快得多
   */
  async calculateLength(data, boundary) {
      const CRLF = '\r\n';
      let len = 0;

      if (data.form) {
          for (const key in data.form) {
              const header = `--${boundary}${CRLF}Content-Disposition: form-data; name="${this._fmtName(key)}"${CRLF}${CRLF}`;
              len += Buffer.byteLength(header) + Buffer.byteLength(String(data.form[key])) + Buffer.byteLength(CRLF);
          }
      }

      if (data.files) {
          for (const key in data.files) {
              const fileList = Array.isArray(data.files[key]) ? data.files[key] : [data.files[key]];
              for (const filePath of fileList) {
                  const stat = await fs.promises.stat(filePath);
                  const fileName = path.basename(filePath);
                  const header = `--${boundary}${CRLF}Content-Disposition: form-data; name="${this._fmtName(key)}"; filename="${this._fmtName(fileName)}"${CRLF}Content-Type: ${this._getMime(fileName)}${CRLF}${CRLF}`;
                  len += Buffer.byteLength(header) + stat.size + Buffer.byteLength(CRLF);
              }
          }
      }

      len += Buffer.byteLength(`--${boundary}--${CRLF}`);
      return len;
  }
}

module.exports = BodyMaker;