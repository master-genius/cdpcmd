'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const urlparse = require('url');
const qs = require('querystring');
const bodymaker = require('./bodymaker');

var gohttp = function (options = {}) {
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
  var u = new urlparse.URL(url);
  var urlobj = {
    hash :    u.hash,
    hostname :  u.hostname,
    protocol :  u.protocol,
    path :    u.pathname,
    method :  'GET',
    headers : {},
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

gohttp.prototype.request = async function (url, options = {}) {

  var opts = {};
  if (typeof url === 'string') {
    opts = this.parseUrl(url);
  } else {
    opts = url;
  }

  if (opts.timeout === undefined) {
    opts.timeout = 35000;
  }

  if (typeof options !== 'object') { options = {}; }

  for(let k in options) {
    switch (k) {
      case 'timeout':
        opts.timeout = options.timeout; break;

      case 'auth':
        opts.auth = options.auth; break;

      case 'headers':
        if (opts.headers) {
          for(let i in options.headers) {
            opts.headers[i] = options.headers[i];
          }
        } else {
          opts.headers = options.headers;
        }
        break;

      case 'method':
        opts.method = options.method; break;

      case 'encoding':
        opts.encoding = options.encoding; break;

      case 'dir':
        opts.dir = options.dir; break;

      case 'target':
        opts.target = options.target; break;

      case 'progress':
        opts.progress = options.progress; break;

      case 'body':
        opts.body = options.body; break;

      case 'rawBody':
        opts.rawBody = options.rawBody; break;

      default: ;
    }
  }

  var postData = {
    'body': '',
    'content-length': 0,
    'content-type': ''
  };
  var postState = {
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
        postData.body = Buffer.from(qs.stringify(opts.body));
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

  if (options.isDownload) {
    return this._coreDownload(opts, postData, postState);
  }
  
  return this._coreRequest(opts, postData, postState);
};

gohttp.prototype._coreRequest = async function (opts, postData, postState) {
  
  var h = (opts.protocol === 'https:') ? https : http;

  var ret = {
    buffers : [],
    length: 0,
    data : '',
    ok : true,
    status : 0,
    timeout: null,
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

      var r = h.request(opts, (res) => {

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
  var h = (opts.protocol === 'https:') ? https : http;

  if (!opts.dir) {opts.dir = './';}

  var getWriteStream = function (filename) {
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

  var checkMakeFileName = function (filename = '') {
    if (!filename) {
      var nh = crypto.createHash('sha1');
      nh.update(`${(new Date()).getTime()}--`);
      filename = nh.digest('hex');
    }
    return filename;
  };

  var parseFileName = function (headers) {
    var fname = '';
    if(headers['content-disposition']) {
      var name_split = headers['content-disposition'].split(';').filter(p => p.length > 0);

      for(let i=0; i < name_split.length; i++) {
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

  var downStream = null;
  var filename = '';
  var total_length = 0;
  var sid = null;
  var progressCount = 0;
  var down_length = 0;
  if (opts.progress === undefined) {
    opts.progress = true;
  }

  return new Promise((rv, rj) => {
    var r = h.request(opts, res => {
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

gohttp.prototype.delete = async function (url, options = {}) {
  this.checkMethod('DELETE', options);
  return this.request(url, options);
};

gohttp.prototype.options = async function (url, options = {}) {
  thid.checkMethod('OPTIONS', options);
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

module.exports = gohttp;

/* 
gohttp.prototype.cacheUrl = {};
gohttp.prototype.cacheCount = 0;
gohttp.prototype.maxCache = 20000;

gohttp.prototype.cid = function (url) {
  let h = crypto.createHash('sha1');
  h.update(url);
  return h.digest('hex');
};

gohttp.prototype.getCache = function (url) {
  let id = this.cid(url);
  if (this.cacheUrl[id] === undefined) {
    return null;
  }
  return this.cacheUrl[id];
};

gohttp.prototype.setCache = function (url, uobj) {
  let id = this.cid(url);
  
  if (this.cacheCount >= this.maxCache) {
    this.cleanCache();
  }

  if (this.cacheUrl[id] === undefined) {
    this.cacheCount += 1;
  }

  this.cacheUrl[id] = uobj;
};

gohttp.prototype.cleanCache = function () {
  this.cacheUrl = {};
  this.cacheCount = 0;
};
 */
