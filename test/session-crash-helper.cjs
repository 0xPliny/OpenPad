const fs=require('node:fs/promises'),path=require('node:path');
const root=process.argv[2],phase=process.argv[3],file=path.join(root,'session.json');
async function stop(point){if(point!==phase)return;process.send({phase:point});await new Promise(()=>setInterval(()=>{},1000));}
const open=fs.open,rename=fs.rename;
fs.open=async(target,...args)=>{const handle=await open(target,...args),sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();if(target===`${file}.tmp`)await stop('temp-synced');if(target===`${file}.bak.tmp`)await stop('backup-synced');};return handle;};
fs.rename=async(from,to)=>{if(to===file)await stop('before-primary');await rename(from,to);if(to===`${file}.bak`)await stop('backup-promoted');if(to===file)await stop('primary-promoted');};
new (require('../src/session.cjs').SessionStore)(root).save({docs:[{text:'next generation'}]}).then(()=>process.exit(0)).catch(error=>{process.stderr.write(error.stack);process.exit(1);});
