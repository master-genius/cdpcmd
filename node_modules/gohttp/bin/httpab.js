#!/usr/bin/env node

'use strict';

const cluster = require('node:cluster');
const os = require('node:os');
const { URL } = require('node:url');
const { performance } = require('node:perf_hooks');
const { http2Connect, GoHttp} = require('../index.js');

const args = process.argv.slice(2);
const config = {
  url: '', method: 'GET', type: 'h1', data: null, file: null, uploadName: 'file',
  concurrency: 1, total: 100, processes: os.cpus().length, headers: {}, verifyCert: true
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-u': config.url = args[++i]; break;
    case '-t': config.type = args[++i]; break;
    case '-m': config.method = args[++i].toUpperCase(); break;
    case '-d': config.data = args[++i]; break;
    case '-f': config.file = args[++i]; break;
    case '-up': config.uploadName = args[++i]; break;
    case '-i': config.verifyCert = false; break;
    case '-c': config.concurrency = parseInt(args[++i]); break;
    case '-n': config.total = parseInt(args[++i]); break;
    case '-p': config.processes = parseInt(args[++i]); break;
    case '-H': const p = args[++i].split(':'); if(p.length>=2) config.headers[p.shift().trim()]=p.join(':').trim(); break;
  }
}

if (!config.url && cluster.isMaster) { console.log('Usage: httpbench -u <url> [-c 100 -n 10000 -p 8 -t h2]'); process.exit(1); }
if (config.file && config.method === 'GET') config.method = 'POST';
if (config.data) { try { config.data=JSON.parse(config.data); if(!config.headers['content-type']) config.headers['content-type']='application/json'; }catch(e){} }

let h1cli = new GoHttp({
  verifyCert: config.verifyCert
})

// --- Worker ---
if (cluster.isWorker) {
  process.on('message', async (msg) => {
    if (msg.cmd !== 'start') return;
    
    const isH2 = config.type === 'h2';
    const client = isH2 ? http2Connect(config.url, {
                            verifyCert: config.verifyCert,
                            rejectUnauthorized: config.verifyCert})
                        : h1cli;
    let ok = 0, fail = 0, processed = 0, remaining = msg.total;

    const workerLoop = async () => {
      while (true) {
        if (remaining <= 0) break;
        remaining--;
        try {
          let r;
          const opts = { method: config.method, headers: { ...config.headers } };
          if (config.file) {
              if (!isH2) {
                r = await client.up(config.url, {
                  ...opts, file: config.file, name: config.uploadName
                })
              } {
                r = await client.up({
                  ...opts,
                  file: config.file,
                  name: config.uploadName
                });
              }
          } else {
             if (config.data) opts.body = config.data;
             if (isH2) { const u = new URL(config.url); opts.path = u.pathname+u.search; r=await client.request(opts); } 
             else r = await client.request(config.url, opts);
          }
          if (r.ok) ok++; else fail++;
        } catch (e) { fail++; }
        
        processed++;
        if (processed % 100 === 0) { process.send({ t: 'p', c: 100 }); processed = 0; }
      }
    };

    const ths = [];
    for(let i=0; i<config.concurrency; i++) ths.push(workerLoop());
    await Promise.all(ths);
    
    process.send({ t: 'p', c: processed });
    process.send({ t: 'd', ok, fail });
    if (isH2 && client) client.close();
    process.exit(0);
  });
}

// --- Master ---
if (cluster.isMaster) {
  console.log(`\x1b[33m[httpbench] Launching ${config.processes} processes...\x1b[0m`);
  console.log(`Target: ${config.url} (${config.type})`);
  console.log(`Load:   ${config.concurrency} conc x ${config.processes} cores = ${config.concurrency*config.processes} concurrent`);
  console.log(`Total:  ${config.total} requests`);

  const t0 = performance.now();
  let done = 0, okTotal = 0, failTotal = 0, active = config.processes;
  const base = Math.floor(config.total / config.processes);
  let rem = config.total % config.processes;

  for (let i = 0; i < config.processes; i++) {
    const w = cluster.fork();
    w.send({ cmd: 'start', total: base + (rem-- > 0 ? 1 : 0) });
    w.on('message', m => {
      if (m.t === 'p') {
        done += m.c;
        if (done % Math.ceil(config.total/20) === 0) process.stdout.write('.');
      } else if (m.t === 'd') {
        okTotal += m.ok; failTotal += m.fail;
        if (--active === 0) report();
      }
    });
  }

  function report() {
    const s = (performance.now() - t0) / 1000;
    console.log('\n\n\x1b[32m=== Benchmark Result ===\x1b[0m');
    console.log(`Time:    ${s.toFixed(3)} s`);
    console.log(`QPS:     \x1b[36m${(done/s).toFixed(2)}\x1b[0m`);
    console.log(`Success: ${okTotal}`);
    console.log(`Fail:    ${failTotal}`);
    process.exit(0);
  }
}