'use strict'

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

let sockFile = process.argv[2]

if (!sockFile) {
  console.error('用法: outstatus.js <sockFile> [name...]')
  process.exit(1)
}

;(async () => {
  try {
    let res = await model.readStatus(sockFile)

    if (!res.ok) {
      /**
       * C1/C5 根治：原实现"文件不存在 → exit 0 什么都不输出"，用户无法区分
       * 没有服务 / daemon 没跑 / 文件被清理。现在四分类都必须说话：
       *   - --has 是命令链路的前置查询，报到 stderr 并用 exit 3 与"服务不存在"(exit 0) 区分；
       *   - 展示模式打印带用户名的标注行，root 逐用户聚合时不会因某个用户失败而中断。
       */
      if (args.has) {
        console.error(`${args.user || 'root'}: ${res.message}`)
        process.exit(3)
      }

      // 提示可能是多行（如半升级状态的操作建议）：首行进括号，其余单独成行，
      // 避免括号里夹换行、也避免调用方按行处理时错乱
      let lines = String(res.message).split('\n')
      console.log(`  ${args.user || 'root'}  (${lines[0]})`)
      for (let extra of lines.slice(1)) console.log(extra)
      process.exit(0)
    }

    let ld = res.data

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

    console.log(renderTable(model.SUMMARY_HEADERS, rows, {
      title,
      minWidths: model.SUMMARY_MIN_WIDTHS,
      boldHeader: true
    }).join('\n'))
    console.log('')
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
})()
