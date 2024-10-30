'use strict';

const process = require('node:process');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const urlparse = require('node:url');
const qs = require('./qs.js');
const bodymaker = require('./bodymaker.js');
const fmtpath = require('./fmtpath.js');

let gohttp = function (options = {}) {
  if (! (this instanceof gohttp)) { return new gohttp(options); }

  this.config = {
    cert: '',
    
    key:  '',

    ignoretls: true,

    //不验证证书，针对HTTPS
    //ignoreTLSAuth : true,
    set ignoreTLSAuth (b) {
      if (b) {
        this.config.ignoretls = true;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      } else {
        this.config.ignoretls = false;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
      }
    }
  };

  this.bodymaker = new bodymaker(options);

  this.cert = '';
  this.key = '';

  if (this.ignoretls) {
    this.cert = fs.readFileSync(this.config.cert);
    this.key = fs.readFileSync(this.config.key);
  }

};

gohttp.prototype.parseUrl = function (url) {
  let u = new urlparse.URL(url);

  let urlobj = {
    hash      : u.hash,
    hostname  : u.hostname,
    protocol  : u.protocol,
    path      : u.pathname,
    pathname  : u.pathname,
    method    : 'GET',
    headers   : {},
  };

  if (u.search.length > 0) {
    urlobj.path += u.search;
  }
  
  if (u.protocol  === 'unix:') {
    urlobj.protocol = 'http:';
    let sockarr = u.pathname.split('.sock');
    urlobj.socketPath = `${sockarr[0]}.sock`;
    urlobj.path = sockarr[1];
  } else {
    urlobj.host = u.host;
    urlobj.port = u.port;
  }

  if (u.protocol === 'https:' && this.config.ignoretls) {
    urlobj.requestCert = false;
    urlobj.rejectUnauthorized = false;
  } else if (u.protocol === 'https:') {
    urlobj.cert = this.cert;
    urlobj.key = this.key;
  }

  return urlobj;
};

function setOptsQuery(opts, options) {
  if (options.query) {
    let qstr;
    let qchar = '?';

    if (typeof options.query === 'object')
        qstr = qs(options.query);
    else
        qstr = options.query;
    
    if (opts.path.indexOf('?') > 0) qchar = '&';

    opts.path += qchar + qstr;
  }
}

gohttp.prototype.request = async function (url, options = null) {
  let opts;
  let is_obj = false;
  if (typeof url === 'string') {
    opts = this.parseUrl(url);
  } else if (typeof url === 'object') {
    opts = url;
    is_obj = true;
  } else {
    throw new Error(`url must be a string or object`);
  }

  if (opts.timeout === undefined) {
    opts.timeout = 35000;
  }

  if (options && !is_obj && typeof options === 'object' && opts !== options) {
    for (let k in options) {
      switch (k) {
        case 'headers':
          if (opts.headers) {
            for(let i in options.headers) {
              opts.headers[i] = options.headers[i];
            }
          } else {
            opts.headers = options.headers;
          }
          break;

        case 'query':
          setOptsQuery(opts, options);
          break;
  
        default:
          opts[k] = options[k];
      }
    }
  }

  let postData = {
    'body': '',
    'content-length': 0,
    'content-type': ''
  };

  let postState = {
    isUpload: false,
    isPost: false
  };

  if (opts.method[0] === 'P' || (opts.method[0] === 'D' && (opts.body || opts.rawBody) ) )
  {
    //只有POST、PUT、PATCH的情况会出现参数错误。
    if (opts.body === undefined && opts.rawBody === undefined) {
      throw new Error('POST/PUT must with body data, please set body or rawBody');
    }
    
    if (opts.headers['content-type'] === undefined) {
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
    }

    postState.isPost = true;

    switch (opts.headers['content-type']) {
      case 'application/x-www-form-urlencoded':
        postData.body = Buffer.from(qs(opts.body));
        break;

      case 'multipart/form-data':
        postState.isUpload = true;
        postData = await this.bodymaker.makeUploadData(opts.body);
        opts.headers['content-type'] = postData['content-type'];
        break;

      default:
        if (opts.headers['content-type'].indexOf('multipart/form-data') >= 0) {
          postState.isUpload = true;
          if (options.rawBody !== undefined) {
            postData = {
              'content-type' : '',
              'body' : options.rawBody,
              'content-length' : options.rawBody.length
            };
          }
        } else {
          if (typeof opts.body === 'object') {
            postData.body = Buffer.from(JSON.stringify(opts.body));
          } else {
            postData.body = Buffer.from(opts.body);
          }
        }
    }
  }
  
  
  if (postState.isPost && !postState.isUpload) {
    postData['content-type'] = opts.headers['content-type'];
    postData['content-length'] = postData.body.length;
  }

  if (postState.isPost) {
    opts.headers['content-length'] = postData['content-length'];
  }

  if (options && options.isDownload) {
    return this._coreDownload(opts, postData, postState);
  }
  
  return this._coreRequest(opts, postData, postState);
};

gohttp.prototype._coreRequest = async function (opts, postData, postState) {
  let h = (opts.protocol === 'https:') ? https : http;

  let ret = {
    buffers : [],
    length: 0,
    data : '',
    ok : true,
    status : 0,
    timeout: false,
    error: null,
    headers : {},
  };

  ret.text = (ecd = 'utf8') => {
    return ret.data.toString(ecd);
  };

  ret.json = (ecd = 'utf8') => {
    return JSON.parse(ret.data.toString(ecd));
  };

  ret.blob = () => {
    return ret.data;
  };

  return new Promise ((rv, rj) => {
      let r = h.request(opts, (res) => {

        if (opts.encoding) {
          //默认为buffer
          res.setEncoding(opts.encoding);
        }

        let bd = '';
        let onData = (data) => {
          //如果消息头有content-length则返回结果会是字符串而不是buffer。
          //但是无法保证content-length和实际数据是否一致，所以会把字符串转换为buffer。
          if (typeof data === 'string') {
            bd = Buffer.from(data);
            ret.buffers.push(bd);
            ret.length += bd.length;
          } else {
            ret.buffers.push(data);
            ret.length += data.length;
          }
        };

        res.on('data', onData);

        res.on('end', () => {
          ret.data = Buffer.concat(ret.buffers, ret.length);
          ret.buffers = null;
          ret.status = res.statusCode;
          ret.headers = res.headers;

          if (res.statusCode >= 400) {
            ret.ok = false;
          } else {
            ret.ok = true;
          }
          rv(ret);
        });
  
        res.on('error', (err) => {
          ret.error = err;
          rv(ret);
        });
    });

    r.setTimeout(opts.timeout);

    r.on('timeout', (sock) => {
      r.destroy();
      ret.timeout = true;
      rv(ret);
    });
    
    r.on('error', (e) => { rj(e); });

    if (postState.isPost) {
      r.write(postData.body);
    }

    r.end();
  });

};

gohttp.prototype._coreDownload = function (opts, postData, postState) {
  let h = (opts.protocol === 'https:') ? https : http;

  if (!opts.dir) {opts.dir = './';}

  let getWriteStream = function (filename) {
    if (opts.target) {
      return fs.createWriteStream(opts.target, {encoding:'binary'});
    } else {
      let dfname = `${opts.dir}/${filename}`;
      try {
        fs.accessSync(dfname, fs.constants.F_OK);
        dfname = `${Date.now()}-${dfname}`;
      } catch(err) {}

      return fs.createWriteStream(dfname,{encoding:'binary'});
    }
  };

  let checkMakeFileName = function (filename = '') {
    if (!filename) {
      var nh = crypto.createHash('sha1');
      nh.update(`${(new Date()).getTime()}--`);
      filename = nh.digest('hex');
    }
    return filename;
  };

  let parseFileName = function (headers) {
    let fname = '';
    if(headers['content-disposition']) {
      let name_split = headers['content-disposition'].split(';').filter(p => p.length > 0);

      for (let i=0; i < name_split.length; i++) {
        if (name_split[i].indexOf('filename*=') >= 0) {
          fname = name_split[i].trim().substring(10);
          //fname = fname.split('\'')[2];
          //fname = decodeURIComponent(fname);
          fname = decodeURIComponent( fname.split('\'')[2] );
        } else if(name_split[i].indexOf('filename=') >= 0) {
          fname = name_split[i].trim().substring(9);
        }
      }
    }
    return fname;
  };

  let downStream = null;
  let filename = '';
  let total_length = 0;
  let sid = null;
  let progressCount = 0;
  let down_length = 0;
  if (opts.progress === undefined) {
    opts.progress = true;
  }

  return new Promise((rv, rj) => {
    let r = h.request(opts, res => {
      //res.setEncoding('binary');
      filename = parseFileName(res.headers);
      if (res.headers['content-length']) {
        total_length = parseInt(res.headers['content-length']);
      }
      try {
        filename = checkMakeFileName(filename);
        downStream = getWriteStream(filename);
      } catch (err) {
        console.log(err);
        res.destroy();
        return ;
      }

      res.on('data', data => {
        downStream.write(data);
        down_length += data.length;
        if (opts.progress && total_length > 0) {
          if (down_length >= total_length) {
            console.clear();
            console.log('100.00%');
          } else if (progressCount > 25) {
            console.clear();
            console.log(`${((down_length/total_length)*100).toFixed(2)}%`);
            progressCount = 0;
          }
        }
      });
      
      res.on('end', () => {rv(true);});
      res.on('error', (err) => { rj(err); });

      sid = setInterval(() => {
        progressCount+=1;
      }, 20);

    });
    if (postState.isPost) {
      r.write(postData.body, postState.isUpload ? 'binary' : 'utf8');
    }
    r.end();
  })
  .then((r) => {
    if (opts.progress) { console.log('ok.'); }
  }, (err) => {
    throw err;
  })
  .catch(err => { throw err; })
  .finally(() => {
    if (downStream) {
      downStream.end();
    }
    clearInterval(sid);
  });
};

gohttp.prototype.checkMethod = function (method, options) {
  if (typeof options !== 'object') {
    options = {method: method};
  } else if (!options.method || options.method !== method) {
    options.method = method;
  }
};

gohttp.prototype.get = async function (url, options = {}) {
  this.checkMethod('GET', options);
  return this.request(url, options);
};

gohttp.prototype.post = async function (url, options = {}) {
  this.checkMethod('POST', options);
  if (!options.body && !options.rawBody) {
    throw new Error('must with body data');
  }
  return this.request(url, options);
};

gohttp.prototype.put = async function (url, options = {}) {
  this.checkMethod('PUT', options);
  if (!options.body && !options.rawBody) {
    throw new Error('must with body data');
  }
  return this.request(url, options);
};

gohttp.prototype.patch = async function (url, options = {}) {
  this.checkMethod('PATCH', options);
  if (!options.body && !options.rawBody) {
    throw new Error('must with body data');
  }
  return this.request(url, options);
};

gohttp.prototype.delete = async function (url, options = {}) {
  this.checkMethod('DELETE', options);
  return this.request(url, options);
};

gohttp.prototype.options = async function (url, options = {}) {
  this.checkMethod('OPTIONS', options);
  return this.request(url, options);
};

gohttp.prototype.upload = async function (url, options = {}) {
  if (typeof options !== 'object') {
    options = {method: 'POST'};
  }

  if (options.method === undefined) {
    options.method = 'POST';
  }

  if (options.method[0] !== 'P' && options.method[0] !== 'D') {
    throw new Error('必须是POST、PUT、PATCH、DELETE请求之一。');
  }

  if (!options.files && !options.form && !options.body && !options.rawBody) {
    throw new Error('没有请求体数据(file or form not found.)');
  }

  //没有设置body，但是存在files或form，则自动打包成request需要的格式。
  if (!options.body && !options.rawBody) {
    options.body = {};
    if (options.files) {
      options.body.files = options.files;
      delete options.files;
    }
    if (options.form) {
      options.body.form = options.form;
      delete options.form;
    }
  }
  if (!options.headers) {
    options.headers = {
      'content-type' : 'multipart/form-data'
    };
  }
  if (!options.headers['content-type'] 
    || options.headers['content-type'].indexOf('multipart/form-data') < 0)
  {
    options.headers['content-type'] = 'multipart/form-data';
  }
  return this.request(url, options);
};

gohttp.prototype.download = function(url, options = {}) {
  if (typeof options !== 'object') {
    options = {
      method: 'GET',
      isDownload: true
    };
  } else {
    if (!options.isDownload) {options.isDownload = true; }
  }
  return this.request(url, options);

};

//upload的简单封装，让参数更简单，用于快速文件上传写起来简单些。
gohttp.prototype.up = async function (url, opts = {}) {
  if (typeof opts !== 'object' || opts.file === undefined) {
    throw new Error('Error: file or form not found. options : {file:FILE_PATH, name : UPLOAD_NAME}');
  }

  /* if (opts.name === undefined) {
    opts.name = 'file';
  } */

  opts.files = {};

  opts.files[ opts.name || 'file' ] = opts.file;

  return this.upload(url, opts);

};

/**
 * 这个接口主要是为了快速转发，接收到的数据，不需要经过任何解析，直接转发，不经过request接口的复杂选项解析。
 * 并且body必须是buffer类型。 如果确定了要转发的url，你可以先通过parseUrl解析后并保存结果，之后每次都直接传递这个对象。
 */

gohttp.prototype.transmit = function (url, opts = {}) {

  let postopts = {
    isPost: false
  };

  if (opts.rawbody && opts.rawbody instanceof Buffer) {
    postopts.isPost = true;
  } else {
    opts.rawbody = '';
  }

  let uobj = null;

  if (typeof url === 'string') {
    uobj = this.parseUrl(url);

  } else if (url && typeof url === 'object') {
    uobj = url;
  } else {
    throw new Error('url must be string or a object');
  }

  if (opts.headers && typeof opts.headers === 'object') {
    for (let k in opts.headers) {
      uobj.headers[k] = opts.headers[k];
    }
  }

  if (opts.timeout && typeof opts.timeout == 'number') {
    uobj.timeout = opts.timeout;
  } else {
    uobj.timeout = 35000;
  }

  if (opts.method) {
    uobj.method = opts.method;
  }

  return this._coreRequest(uobj, {body: opts.rawbody}, postopts);
};

/** ------------ 兼容http2的接口层，和hiio.js接口一致 ---------------- */

let compatMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function _hiicompat(url, options, t) {
  if (!(this instanceof _hiicompat)) {
    return new _hiicompat(url, options, t);
  }

  this.url = url;

  this.req = t;
  this.request = t.request;

  this.urlobj = this.req.parseUrl(url);

  this.host = this.urlobj.host;

  this.options = options;

  this.port = this.urlobj.port;

  this.methods = compatMethods;

  this.headers = null;

  options.headers && this.setHeader(options.headers)

  Object.defineProperty(this, '__prefix__', {
    configurable: false,
    writable: true,
    enumerable: false,
    value: fmtpath(this.urlobj.pathname)
  });

};

compatMethods.forEach(m => {
  let mlower = m.toLowerCase();
  _hiicompat.prototype[ mlower ] = function (opts) {
    this.setOptions(opts, m, true);
    return this.req.request(opts);
  };
});

/**
 * 
 * @param {object} opts {path: '/', headers:{...}}
 */
_hiicompat.prototype.upload = function (opts) {
  //在request中，检测到如果两个参数相同则不会把options中的值复制给opts
  //使用这种方式，可以利用upload的选项检测操作。
  this.setOptions(opts, 'POST');
  return this.req.upload(opts, opts);
};

_hiicompat.prototype.up = function (opts) {
  this.setOptions(opts, 'POST');
  return this.req.up(opts, opts);
};

_hiicompat.prototype.download = function (opts) {
  this.setOptions(opts, 'GET');
  return this.req.download(opts, {isDownload: true});
};

_hiicompat.prototype.copyUrl = function () {
    let new_url = {
      ...this.urlobj
    };
    new_url.headers = {};
    return new_url;
};

_hiicompat.prototype.setHeader = function (key, val = null) {
  if (!this.headers) this.headers = Object.create(null);
  if (typeof key === 'object') {
    for (let k in key) this.headers[k] = key[k];
  } else {
    this.headers[key] = val;
  }
  return this;
};

Object.defineProperty(_hiicompat.prototype, 'prefix', {
  get: function () {
    return this.__prefix__;
  },

  set: function (path) {
    this.__prefix__ = fmtpath(path);
  }
});

Object.defineProperty(_hiicompat.prototype, 'setOptions', {
  value: setOptions,
  configurable: false,
  writable: false,
  enumerable: false
});

function setOptions(opts, method, resetMethod = false) {
  for (let k in this.urlobj) {
    if (k === 'headers' || k === 'method' || k === 'path')
      continue;

    opts[k] = this.urlobj[k];
  }

  if (!opts.method || resetMethod) opts.method = method;

  if (!opts.headers) opts.headers = {};
  
  if (this.headers && typeof this.headers === 'object') {
    for (let k in this.headers) {
      opts.headers[k] = this.headers[k];
    }
  }

  let options = this.options;

  if (options) {
    if (options.headers) {
      for (let k in options.headers)
        opts.headers[k] = options.headers[k];
    }

    for (let k in options) {
      if (k === 'headers') continue;
      opts[k] = options[k];
    }
  }

  if (opts.timeout === undefined && options.timeout)
    opts.timeout = options.timeout;

  if (!opts.path) opts.path = this.urlobj.path;
  else {
    if (this.__prefix__ !== '' && !opts.withoutPrefix) {
      opts.path = `${this.__prefix__}${opts.path}`;
    }
  }

  if (opts.query) setOptsQuery(opts, opts);
};

/**
 * 返回 _hiicompat 实例。为兼容hiio而提供。
 * @param {string} url url字符串
 */
gohttp.prototype.connect = function (url, options = null) {
  if (typeof options !== 'object') options = null;
  
  return new _hiicompat(url, options || {}, this);
};

/** ------------------------------END------------------------------ */

module.exports = gohttp;
