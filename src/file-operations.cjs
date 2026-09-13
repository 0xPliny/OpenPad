const fs = require('node:fs/promises');
const path = require('node:path');
const { hash } = require('./files.cjs');
function validName(name) {
  if (typeof name!=='string' || !name || name!==name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Enter a valid filename without a directory or reserved Windows name.');
  return name;
}
async function checkDisk(doc) {
  const stat=await fs.lstat(doc.path);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>32*1024*1024)throw new Error('The path is no longer a supported regular file.');
  if(hash(await fs.readFile(doc.path))!==doc.hash)throw new Error('The file changed on disk. Reload or save your edits elsewhere first.');
}
async function renameDocument(doc,name) {
  validName(name);
  const target=path.join(path.dirname(doc.path),name);
  if(target===doc.path)return doc;
  await checkDisk(doc);
  if(process.platform==='win32' && target.toLowerCase()===doc.path.toLowerCase()){
    const existing=await fs.realpath(target).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(existing===await fs.realpath(doc.path)){await fs.rename(doc.path,target);return {...doc,path:target,name};}
  }
  // An exclusive hard link avoids overwriting an existing destination; removing the old name retains the same file bytes and identity.
  await fs.link(doc.path,target);
  try { await fs.unlink(doc.path); }
  catch(error) { throw new Error(`Could not remove the old name. Both paths are retained: ${doc.path} and ${target}. ${error.message}`); }
  return {...doc,path:target,name};
}
module.exports={renameDocument,checkDisk,validName};
