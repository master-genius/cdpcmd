'use strict'

process.chdir(__dirname)

if (process.geteuid() > 0) {
  process.exit(1)
}

const fs = require('fs')
const getuser = require('./getuser')

try {
  fs.accessSync('./uauth')
} catch (err) {
  fs.mkdirSync('./uauth', {
    mode: 0o755
  })
}

if (process.argv.length < 4) {
  console.error('less arguments: [show|add|remove] [USER]')
  process.exit(1)
}

let op = process.argv[2]

if (['show', 'add', 'remove'].indexOf(op) < 0) {
  console.error(`unknow command ${op}`)
  process.exit(1)
}

let ulist = process.argv.slice(3)

if (op === 'show') {
  let flist = fs.readdirSync('./uauth');

  for (let f of flist)
      console.log(f);

  process.exit(0);
}

function authUser (uname) {

  let au = getuser(uname)

  if (!au) {
    return false
  }
  
  let ucfgpath = `${__dirname}/config/${au.user}.json`;
  
  switch (op) {
  
    case 'add':
      try {
        fs.writeFileSync(`./uauth/${au.user}`, au.home, {encoding: 'utf8'})
        
        let ucfg = {
          name : `cdpcd-${au.user}`,
          args: ['--uid', au.uid],
          file : `${__dirname}/cdpcd.js`,
          options: {
            uid: au.uid,
            gid: au.gid,
            env : {
              HOME: au.home,
            },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc']
          },
          monitor: true
        };
  
        fs.writeFileSync(ucfgpath, 
                        JSON.stringify(ucfg),
                        {encoding: 'utf8'}
                      );
  
        fs.writeFileSync(`/tmp/cdpc_watch/load`, ucfgpath, {encoding: 'utf8'});
  
      } catch (err) {
        console.error(err)
        return false
      }
      
      break;
  
    case 'remove':
      try {
        fs.unlinkSync(`./uauth/${au.user}`)
        fs.unlinkSync(ucfgpath)
        fs.writeFileSync('/tmp/cdpc_watch/remove', `cdpcd-${au.user}`)
      } catch (err) {
        console.error(err)
        return false
      }
      break;
  }
  
}

for (let u of ulist) {
  authUser(u)
}
