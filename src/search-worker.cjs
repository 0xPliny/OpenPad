const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { decode } = require('./files.cjs');
const {createMatcher,scanMatches}=require('./search-model.cjs');
async function search(options) {
  const {root,include='',exclude='.git,node_modules,dist,release',buffers,encoding}=options;
  createMatcher(options);
  const ignored = new Set(exclude.split(',').map(s => s.trim()).filter(Boolean));
  const extensions = include.split(',').map(s => s.trim().replace(/^\*?\.?/, '').toLowerCase()).filter(Boolean);
  let scanned = 0, skipped = 0, count = 0, visited = 0, capped = false;
  const scope=buffers?'buffers':'folder';
  const send=message=>parentPort?.postMessage({...message,scope});
  function scan(text,identity){count+=scanMatches(text,options,1000-count,match=>send({type:identity.bufferId?'buffer-match':'match',...identity,...match,from:match.from+(identity.offset||0),to:match.to+(identity.offset||0)}));if(count>=1000)capped=true;}
  if(buffers){for(const buffer of buffers){if(capped)break;send({type:'scanning-file',bufferId:buffer.id});scan(buffer.text,{bufferId:buffer.id,name:buffer.name,offset:buffer.from||0});scanned++;}return {type:'done',scanned,skipped,count,capped,scope};}
  async function visit(directory,depth=0) {
    if(depth>30){skipped++;return;}
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++visited > 100000 || count >= 1000) { capped = true; return; }
      if (ignored.has(entry.name)) { skipped++; continue; }
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped++; continue; }
      if (entry.isDirectory()) { try { await visit(file,depth+1); } catch { skipped++; } continue; }
      if (!entry.isFile() || (extensions.length && !extensions.includes(path.extname(file).slice(1).toLowerCase()))) { skipped++; continue; }
      try {
        if ((await fs.stat(file)).size > 10 * 1024 * 1024) { skipped++; continue; }
        const doc = decode(await fs.readFile(file),encoding||undefined);
        scanned++;
        send({ type:'scanning-file', file });
        scan(doc.text,{path:file,encoding:doc.encoding,hash:doc.hash});
        send({ type: 'progress', scanned, skipped, count });
        if(capped)return;
      } catch { skipped++; }
    }
  }
  await visit(root);
  return { type: 'done', scanned, skipped, count, capped,scope };
}
if (parentPort) search(workerData).then(result => parentPort.postMessage(result)).catch(error => parentPort.postMessage({ type: 'error', message: error.message }));
module.exports = { search };
