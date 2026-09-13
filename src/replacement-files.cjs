const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash, encode, writeDocument } = require('./files.cjs');
const { replaceFile } = require('./replace-file.cjs');
const key = file => process.platform === 'win32' ? file.toLowerCase() : file;
async function validate(entry) {
  const stat = await fs.lstat(entry.path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > 10*1024*1024 || key(await fs.realpath(entry.path)) !== key(entry.path)) throw new Error(`File type or path changed: ${entry.path}`);
  const bytes = await fs.readFile(entry.path);
  if (hash(bytes) !== entry.meta.hash) throw new Error(`File changed after preview: ${entry.path}`);
  return bytes;
}
async function applyFiles(entries, recoveryRoot, writer = writeDocument) {
  if (!entries.length) throw new Error('Select at least one changed file.');
  // Recovery bytes and complete preflight precede the first write because files cannot form a single filesystem transaction.
  const originals = [];
  for (const entry of entries) { originals.push(await validate(entry)); encode(entry.after,entry.meta); }
  const recovery = path.join(recoveryRoot,randomUUID());
  await fs.mkdir(recovery,{recursive:true});
  const manifest = entries.map((entry,index)=>({path:entry.path,backup:`${index}.original`,beforeHash:entry.meta.hash,afterHash:hash(encode(entry.after,entry.meta))}));
  for (let i=0;i<entries.length;i++) await fs.writeFile(path.join(recovery,manifest[i].backup),originals[i],{flag:'wx'});
  await fs.writeFile(path.join(recovery,'manifest.json'),JSON.stringify({status:'prepared',files:manifest},null,2),{flag:'wx'});
  const written = [], rollback = [];
  try {
    for (const entry of entries) {
      await validate(entry);
      await writer(entry.path,entry.after,entry.meta,entry.meta.hash);
      written.push(entry);
    }
  } catch (error) {
    for (const entry of written.reverse()) {
      const index = entries.indexOf(entry), temp = `${entry.path}.${randomUUID()}.tmp`;
      try {
        const check = async()=>{
          const stat=await fs.lstat(entry.path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink>1 || key(await fs.realpath(entry.path)) !== key(entry.path) || hash(await fs.readFile(entry.path)) !== manifest[index].afterHash) throw new Error('File changed again; recovery copy retained');
        };
        await fs.writeFile(temp,originals[index],{flag:'wx'}); await replaceFile(temp,entry.path,check);
        rollback.push({path:entry.path,restored:true});
      } catch (failure) { rollback.push({path:entry.path,restored:false,error:failure.message}); }
      finally { await fs.unlink(temp).catch(()=>{}); }
    }
    const result = {ok:false,error:error.message,recovery,rollback};
    await fs.writeFile(path.join(recovery,'result.json'),JSON.stringify(result,null,2)).catch(()=>{});
    return result;
  }
  const result = {ok:true,count:written.length,recovery};
  await fs.writeFile(path.join(recovery,'result.json'),JSON.stringify(result,null,2)).catch(()=>{});
  return result;
}
module.exports = { applyFiles };
