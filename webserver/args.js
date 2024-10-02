'use strict'

let host_preg = '(^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$)|'
              + '(^http[s]?\:\/\/.+)|(.*\.sock$)|'
              + '(^[0-9a-f]{1,4}:([0-9a-f]{1,4}:){1,6}[0-9a-f]{1,4}$)|'
              + '(^::[0-9a-f]{1,4}$)|'
              + '(^[0-9a-f]{1,4}:([0-9a-f]{1,4}:){0,6}):[0-9a-f]{0,4}$'

module.exports = {
  
  '@autoDefault': true,

  '--test' : {
    name: 'test',
    type: 'bool',
    default: false,
  },

  '--debug' : {
    name : 'debug',
    default: false,
  },

  '--host' : {
    name: 'host',
    type: 'string',
    match : new RegExp(host_preg, 'i'),
    default: '0.0.0.0',
  },

  '--port': {
    name: 'port',
    type: 'number',
    default: 10101,
    min: 1000,
    max: 65535
  }

}
