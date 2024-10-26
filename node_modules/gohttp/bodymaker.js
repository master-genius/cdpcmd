'use strict';

//const crypto = require('crypto');
const fs = require('fs');

const fsp = fs.promises;

var bodymaker = function (options = {}) {

  if (!(this instanceof bodymaker)) return new bodymaker(options);

  //最大同时上传文件数量限制
  this.maxUploadLimit = 10;

  //上传文件最大数据量
  this.maxUploadSize = 2000000000;

  //单个文件最大上传大小
  this.maxFileSize = 1000000000;

  this.mimeTable = {
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
  }

  this.default_mime   = 'application/octet-stream'

  this.extName = function (filename = '') {
    if (filename.length < 2) return '';

    let name_split = filename.split('.').filter(p => p.length > 0);

    if (name_split.length < 2) return '';
    
    return name_split[name_split.length - 1];
  }

  this.mimeType = function (filename) {
    var extname = this.extName(filename);
    extname = extname.toLowerCase();
    if (extname !== '' && this.mimeTable[extname] !== undefined) {
      return this.mimeTable[extname];
    }
    return this.default_mime;
  }

}

bodymaker.prototype.fmtName = function (name) {
  return name.replace(/"/g, '%22');
}

bodymaker.prototype.fmtFilename = function (name) {
  if (name.indexOf('/') >= 0) {
    let namesplit = name.split('/').filter(p => p.length > 0);
    if (namesplit.length > 0) {
      name = namesplit[namesplit.length - 1];
    }
  }

  return name.replace(/"/g, '%22');
}

bodymaker.prototype.makeUploadData = async function (r) {
  let bdy = this.boundary();

  let formData = '';

  if (r.form !== undefined) {
    if (typeof r.form === 'object') {
      for (let k in r.form) {
        formData += `\r\n--${bdy}\r\nContent-Disposition: form-data; `
                + `name=${'"'}${this.fmtName(k)}${'"'}\r\n\r\n${r.form[k]}`;
      }
    }
  }

  let bodyfi = {};
  let header_data = '';
  let payload = '';

  let content_length = Buffer.byteLength(formData);

  let end_data = `\r\n--${bdy}--\r\n`;

  content_length += Buffer.byteLength(end_data);

  if (r.files && typeof r.files === 'object') {
    let t = '';
    for (let k in r.files) {
      if (typeof r.files[k] === 'string') {
        t = [ r.files[k] ];
      } else {
        t = r.files[k];
      }
      let fst = null;
      
      for (let i=0; i < t.length; i++) {
        header_data = `Content-Disposition: form-data; `
            + `name="${this.fmtName(k)}"; `
            + `filename="${this.fmtFilename(t[i])}"`
            + `\r\nContent-Type: ${this.mimeType(t[i])}`;

        payload = `\r\n--${bdy}\r\n${header_data}\r\n\r\n`;
        content_length += Buffer.byteLength(payload);

        try {
          fst = fs.statSync(t[i]);
          content_length += fst.size;
        } catch (err) {
          console.error(err);
          continue ;
        }

        bodyfi[ t[i] ] = {
          payload : payload,
          length: fst.size
        };

      }
    }

  }

  let seek = 0;
  let bodyData = Buffer.alloc(content_length);
  seek = Buffer.from(formData).copy(bodyData);

  //let fd = -1;
  let fh = null;
  let fret;

  for (let f in bodyfi) {
    seek += Buffer.from(bodyfi[f].payload).copy(bodyData, seek);
    try {
      fh = await fsp.open(f);

      fret = await fh.read(bodyData, seek, bodyfi[f].length, 0)

      seek += fret.bytesRead;

    } catch (err) {
      throw err;
    } finally {
      fh && fh.close && fh.close();
    }
  }
  
  Buffer.from(end_data).copy(bodyData, seek);

  return {
    'content-type' : `multipart/form-data; boundary=${bdy}`,
    'body' : bodyData,
    'content-length' : content_length
  };
};

bodymaker.prototype.boundary = function() {

  let bdy = `${Date.now()}${parseInt(Math.random() * 10000)+10001}`;

  return `----------------${bdy}`;

};

module.exports = bodymaker;
