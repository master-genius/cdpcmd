'use strict'

const npargv = require('npargv')

let arg = npargv({
  '--user': {
    type: 'string',
    default: '',
    name: 'user'
  },

  '--json': {
    type: 'boolean',
    name: 'json',
    default: false
  },

  '--encode-json': {
    name: 'encodeJson',
    type: 'boolean',
    default: false
  },

  '--only-name': {
    name: 'onlyName',
    type: 'boolean',
    default: false
  }
})

let args = arg.args
let result = arg.list

let table = {}

result.filter(p => {
  return p.trim().length > 0
}).forEach(x => {
  let data = ''
  try {
    data = JSON.parse(decodeURIComponent(x))
  } catch (e) {
    return
  }

  if (!Array.isArray(data)) return false

  data.forEach(r => {
    !table[r] && (table[r] = r.split(' ').filter(p => p.length > 0))
  })
})

if (Object.keys(table).length === 0) {
  process.exit(0)
}

if (args.encodeJson) {
  console.log( encodeURIComponent( JSON.stringify(table) ) )
} else if (args.json) {
  console.log(JSON.stringify(table))
} else {
  if (args.onlyName) {
    let names = []
    for (let k in table) {
      names.push(table[k][0] + ':' + table[k][1])
    }

    console.log(names.join(' '))
    process.exit(0)
  }

  for (let k in table) {
    let c = table[k]
    console.log(c.join(' '))
  }
}
