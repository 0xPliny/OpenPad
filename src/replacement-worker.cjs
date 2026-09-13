const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { decode, encode } = require('./files.cjs');
const { replacements, MAX_TEXT } = require('./replacement-model.cjs');
async function preview({ root, buffers, options, blocked = [] }) {
  replacements('',options);
  const entries = [], skipped = [];
  let total = 0, visited = 0, capped = false;
  const key = file => process.platform === 'win32' ? file.toLowerCase() : file;
  const blockedPaths = new Set(blocked.map(key));
  const excluded = new Set((options.exclude ?? '.git,node_modules,dist,release').split(',').map(x=>x.trim()).filter(Boolean));
  const included = (options.include || '').split(',').map(x=>x.trim().replace(/^\./,'').toLowerCase()).filter(Boolean);
  function add(text, identity, meta) {
    total += text.length;
    if (total > MAX_TEXT || entries.length >= 256) { capped = true; return; }
    const result = replacements(text,options);
    total += result.after.length;
    if (total > MAX_TEXT) { capped = true; return; }
    if (!result.changes.length) return;
    if (meta) encode(result.after,meta);
    entries.push({...identity,...result,meta});
  }
  if (buffers) {
    for (const buffer of buffers) { add(buffer.text,{id:buffer.id,name:buffer.name}); if (capped) break; }
    if (capped) throw new Error('Open-buffer previews exceed the aggregate 32 MiB / 256 changed-buffer limit. Narrow the scope.');
  } else {
    async function walk(directory, depth = 0) {
      if (depth > 15) { skipped.push({path:directory,reason:'Directory depth limit'}); return; }
      for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
        if (capped) return;
        if (++visited > 100000) { capped = true; return; }
        if (excluded.has(entry.name)) continue;
        const file = path.join(directory,entry.name);
        if (entry.isSymbolicLink()) { skipped.push({path:file,reason:'Symbolic link'}); continue; }
        try {
          if (entry.isDirectory()) await walk(file,depth+1);
          else if (entry.isFile() && (!included.length || included.includes(path.extname(file).slice(1).toLowerCase()))) {
            if (blockedPaths.has(key(file))) throw new Error('Open in an editor tab; use Open buffers scope');
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('Linked or non-regular file');
            if (stat.size > 10*1024*1024) throw new Error('File exceeds 10 MiB');
            if (key(await fs.realpath(file)) !== key(file)) throw new Error('Path contains a link');
            const meta = decode(await fs.readFile(file),options.encoding || undefined);
            add(meta.text,{id:file,path:file,name:path.basename(file)},meta);
          }
        } catch (error) { skipped.push({path:file,reason:error.message}); }
      }
    }
    await walk(root);
  }
  return {entries,skipped,capped};
}
if (parentPort) preview(workerData).then(result=>parentPort.postMessage({result}),error=>parentPort.postMessage({error:error.message}));
module.exports = { preview };
