const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const limits={files:5000,bytes:64*1024*1024,fileBytes:1024*1024,depth:24,entries:20000};
const forbidden=/^(?:\.git|node_modules|\.env(?:\..*)?|secrets?(?:\..*)?|credentials?(?:\..*)?|\.ssh|\.aws|\.azure|.*id_rsa.*)$/i;
const identity=s=>`${s.dev}:${s.ino}`;
const key=p=>process.platform==='win32'?p.toLowerCase():p;
function glob(value){
  if(typeof value!=='string'||!value||value.length>200||value.includes('..')||value.includes('\\'))throw new Error('Use bounded relative glob patterns with / separators.');
  let result='';for(let i=0;i<value.length;i++){const c=value[i];if(c==='*'&&value[i+1]==='*'){i++;if(value[i+1]==='/'){i++;result+='(?:.*/)?';}else result+='.*';}else if(c==='*')result+='[^/]*';else if(c==='?')result+='[^/]';else result+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}return new RegExp(`^${result}$`,'i');
}
async function scan({root,include=['**/*.md','**/*.markdown','**/AGENTS','**/CLAUDE','**/.cursorrules','**/*.mdc'],exclude=[],tokenizer}){
  if(!Array.isArray(include)||!include.length||include.length>50||!Array.isArray(exclude)||exclude.length>50)throw new Error('Use 1–50 include patterns and at most 50 exclude patterns.');
  const included=include.map(glob),excluded=exclude.map(glob),initial=await fs.lstat(root);
  if(!initial.isDirectory()||initial.isSymbolicLink())throw new Error('Corpus root must be a real directory.');
  root=await fs.realpath(root);const rootId=identity(initial),files=[],skipped=[];let entries=0,bytesRead=0,candidates=0,total=0,halt=false,skippedCount=0,incompleteScan=false;
  const skip=(relative,reason,incomplete=true)=>{skippedCount++;if(incomplete)incompleteScan=true;if(skipped.length<2000)skipped.push({path:relative,reason,incomplete});};
  async function safe(relative){
    const stat=await fs.lstat(root);if(stat.isSymbolicLink()||identity(stat)!==rootId||key(await fs.realpath(root))!==key(root))throw new Error('Corpus root identity changed.');
    let current=root;for(const part of relative.split('/').filter(Boolean)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw new Error('Symbolic links are excluded.');}
    if(key(await fs.realpath(current))!==key(current))throw new Error('Path identity changed.');return current;
  }
  const count=tokenizer==='chars4'?text=>Math.ceil(Array.from(text).length/4):text=>require(`gpt-tokenizer/encoding/${tokenizer}`).countTokens(text,{allowedSpecial:new Set(),disallowedSpecial:new Set()});
  async function read(relative,expected){
    if(++candidates>limits.files){skip(relative,'File count limit reached.');halt=true;return;}
    if(expected.size>limits.fileBytes){skip(relative,'File exceeds 1 MiB.');return;}
    if(bytesRead+expected.size+1>limits.bytes){skip(relative,'Corpus byte limit reached.');halt=true;return;}
    const file=await safe(relative),handle=await fs.open(file,'r');
    try{
      const before=await handle.stat();if(!before.isFile()||identity(before)!==identity(expected)||before.size!==expected.size)throw new Error('File changed before reading.');
      const buffer=Buffer.alloc(before.size+1);let length=0;
      while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
      bytesRead+=length;const after=await handle.stat();
      if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('File changed during reading.');
      const content=buffer.subarray(0,length),text=new TextDecoder('utf-8',{fatal:true}).decode(content),tokens=count(text);
      const final=await fs.lstat(await safe(relative));
      if(!final.isFile()||identity(final)!==identity(before)||final.size!==before.size||final.mtimeMs!==before.mtimeMs||final.ctimeMs!==before.ctimeMs)throw new Error('File changed during token counting.');
      const hash=createHash('sha256').update(content).digest('hex');
      const normalizedTextHash=createHash('sha256').update(text.replace(/\r\n|\r/g,'\n'),'utf8').digest('hex');
      files.push({path:relative,bytes:length,lines:text.split(/\r\n|\r|\n/).length,hash,normalizedTextHash,tokens});total+=tokens;
    }finally{await handle.close();}
  }
  async function walk(relative,depth){
    if(halt)return;if(++entries>limits.entries){skip(relative,'Traversal entry limit reached.');halt=true;return;}
    if(depth>limits.depth){skip(relative,'Directory depth limit reached.');return;}
    if(relative&&(relative.split('/').some(part=>forbidden.test(part))||/\.(?:pem|key|pfx|p12|kdbx)$/i.test(relative)||excluded.some(re=>re.test(relative)))){skip(relative,'Excluded by scope.',false);return;}
    try{
      const file=await safe(relative),stat=await fs.lstat(file);
      if(stat.isDirectory()){const directory=await fs.opendir(file);for await(const entry of directory){await walk(relative?relative+'/'+entry.name:entry.name,depth+1);if(halt)break;}}
      else if(stat.isFile()&&included.some(re=>re.test(relative)))await read(relative,stat);
      else skip(relative,'Outside included regular files.',false);
    }catch(error){skip(relative,error.message);}
    parentPort.postMessage({progress:{files:files.length,entries,bytesRead,total}});
  }
  await walk('',0);await safe('');
  files.sort((a,b)=>b.tokens-a.tokens||a.path.localeCompare(b.path));
  return {root,tokenizer,approximate:tokenizer==='chars4',total,files,skipped,skippedCount,skippedTruncated:skippedCount>skipped.length,incomplete:halt||incompleteScan,entries,bytesRead,limits,note:'Counts cover successfully read file snapshots, not an atomic folder snapshot; chat/tool framing is excluded. '+(tokenizer==='chars4'?'Heuristic: ceil(Unicode code points / 4) per file, not an exact model tokenizer.':'Literal special markers are ordinary text.')};
}
scan(workerData).then(result=>parentPort.postMessage(result),error=>parentPort.postMessage({error:error.message,incomplete:true}));
