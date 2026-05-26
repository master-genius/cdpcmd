'use strict'

const fs = require('fs')
const npargv = require('npargv')

const model = require('./lib/status-model')
const { renderTable } = require('./lib/status-render')

let arg = npargv({
  '-l': {
    name: 'list',
    type: 'boolean',
    default: false
  },

  '--user': {
    name: 'user',
    type: 'string',
    default: ''
  },

  //用于查询
  '--has': {
    type: 'boolean',
    default: false,
    name: 'has'
  },

  '--limit-user': {
    type: 'string',
    default: '',
    name: 'limitUser'
  },

  '--json': {
    type: 'boolean',
    default: false,
    name: 'json'
  },

  '--encode-json': {
    type: 'boolean',
    default: false,
    name: 'encodeJson'
  },

  // --runtime 在 outstatus 层不直接消费；当用户误传到这里时，等价于一次性 snapshot。
  // runtime 主循环在 runstatus.js 里实现。
  '--runtime': {
    type: 'boolean',
    default: false,
    name: 'runtime'
  },

  // 与 runstatus 共用，避免 outstatus 调用时被 npargv 报"未知参数"
  '--period': {
    type: 'string',
    default: '1',
    name: 'period'
  }
})

let args = arg.args
let applist = arg.list.slice(1)

if (process.argv.length < 3) {
  console.error('less arguments')
  process.exit(1)
}

let loadfile = process.argv[2]

try {
  fs.accessSync(loadfile)
} catch (err) {
  if (err.code === 'ENOENT') process.exit(0)
  console.error(err)
  process.exit(1)
}

;(async () => {
  try {
    let ld = await model.readLoad(loadfile)
    if (!ld) process.exit(0)

    // --has 查询模式：输出 "user name pid" 列表（pipe / json / encode-json）
    if (args.has) {
      let haslist = []
      for (let ch of (ld.childs || [])) {
        if (applist.length > 0 && !model.matchAppName(ch.name, applist, args.user)) continue
        if (args.limitUser && args.limitUser !== args.user && args.limitUser !== 'root') continue
        let owner = args.user || 'root'
        haslist.push(`${owner} ${ch.name} ${ch.pid || '-'}`)
      }

      if (haslist.length > 0) {
        if (args.encodeJson) {
          console.log(encodeURIComponent(JSON.stringify(haslist)))
        } else if (args.json) {
          console.log(JSON.stringify(haslist))
        } else {
          console.log(haslist.join('|'))
        }
      }
      process.exit(0)
    }

    let childs = model.filterChilds(ld, applist, args.user)
    if (childs.length === 0) process.exit(0)

    let rows = model.buildRows(childs, { detail: args.list })
    let title = args.user ? `User: ${args.user}` : undefined

    console.log(renderTable(model.SUMMARY_HEADERS, rows, { title }).join('\n'))
    console.log('')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
