const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {decode}=require('./files.cjs');
const identity=value=>`${value.dev}:${value.ino}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function readMcpWorkspaceFile(watch,relative,signal){
  if(typeof relative!=='string'||!relative||relative.length>2048||relative.includes('\\')||relative.includes(':')||relative.includes('\0')||path.isAbsolute(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('INVALID_WORKSPACE_PATH');
  const status=watch.status(),generation=watch.generation;
  const current=()=>{if(signal?.aborted)throw new Error('CANCELLED');if(!watch.status().running||watch.generation!==generation||watch.status().root!==status.root)throw new Error('WORKSPACE_CHANGED');};
  current();const candidate=path.join(status.root,...relative.split('/'));
  if(!await watch.hasPath(candidate))throw new Error('FILE_NOT_IN_WATCH_SCOPE');
  current();const file=await watch.safe(relative),expected=await fs.lstat(file);
  if(!expected.isFile()||expected.size>1024*1024)throw new Error('FILE_LIMIT');
  const handle=await fs.open(file,'r');
  try{
    const before=await handle.stat();if(!before.isFile()||identity(before)!==identity(expected)||before.size!==expected.size)throw new Error('FILE_CHANGED');
    const bytes=Buffer.alloc(before.size+1);let length=0;
    while(length<bytes.length){current();const result=await handle.read(bytes,length,bytes.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
    current();const after=await handle.stat(),final=await fs.lstat(await watch.safe(relative));
    if(length!==before.size||identity(final)!==identity(before)||after.size!==before.size||final.size!==before.size||after.mtimeMs!==before.mtimeMs||final.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||final.ctimeMs!==before.ctimeMs)throw new Error('FILE_CHANGED');
    const content=bytes.subarray(0,length),text=new TextDecoder('utf-8',{fatal:true}).decode(content),document=decode(content,'utf8');current();
    return {path:file,text,hash:hash(content),normalizedTextHash:hash(document.text),document:{path:file,name:path.basename(file),...document}};
  }finally{await handle.close();}
}
module.exports={readMcpWorkspaceFile};
