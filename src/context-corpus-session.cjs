const fs=require('node:fs/promises'),path=require('node:path');
const {ContextCorpusRunner}=require('./context-corpus-runner.cjs');
const {decode,hash}=require('./files.cjs');
const identity=stat=>`${stat.dev}:${stat.ino}`;
const key=value=>process.platform==='win32'?value.toLowerCase():value;
class ContextCorpusSession{
  constructor(runner=new ContextCorpusRunner()){this.runner=runner;this.generation=0;this.scope=null;this.result=null;this.requestId=null;}
  invalidate(){this.generation++;this.runner.cancel();this.scope=null;this.result=null;this.requestId=null;}
  async setScope(root,options={}){this.invalidate();const generation=this.generation,stat=await fs.lstat(root),real=await fs.realpath(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Corpus scope must be a real directory.');if(generation!==this.generation)return;this.scope={root:real,identity:identity(stat),...structuredClone({include:options.include,exclude:options.exclude})};}
  cancel(id){if(id!==undefined&&id!==this.requestId)return false;this.generation++;this.result=null;this.requestId=null;this.runner.cancel(id);return true;}
  close(){this.invalidate();this.runner.close();}
  async run(request={},onProgress){
    this.cancel();const scope=this.scope,generation=this.generation;this.requestId=request?.requestId;
    if(!scope)return {requestId:request?.requestId,error:'Choose an active watch folder before scanning.',incomplete:true};
    const checkRoot=async()=>{const stat=await fs.lstat(scope.root);if(stat.isSymbolicLink()||!stat.isDirectory()||identity(stat)!==scope.identity||key(await fs.realpath(scope.root))!==key(scope.root))throw new Error('Corpus root changed; choose the watch folder again.');};
    try{await checkRoot();}catch(error){return {requestId:request?.requestId,error:error.message,incomplete:true};}
    if(generation!==this.generation||scope!==this.scope)return {requestId:request?.requestId,cancelled:true,incomplete:true};
    const result=await this.runner.run({requestId:request?.requestId,tokenizer:request?.tokenizer,root:scope.root,include:scope.include,exclude:scope.exclude},progress=>{if(generation===this.generation)onProgress?.(progress);});
    if(!result.error&&!result.cancelled){try{await checkRoot();}catch(error){return {requestId:request?.requestId,error:error.message,incomplete:true};}}
    if(generation!==this.generation||scope!==this.scope)return {requestId:request?.requestId,cancelled:true,incomplete:true};
    if(!result.error&&!result.cancelled)this.result=result;
    return result;
  }
  async open(request={}){
    const result=this.result,scope=this.scope,generation=this.generation;
    const entry=result?.requestId===request?.requestId&&typeof request?.path==='string'?result.files.find(file=>file.path===request.path):null;
    if(!scope||!entry)throw new Error('This corpus result is no longer available; scan again.');
    const parts=entry.path.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||part.includes('\\'))||path.isAbsolute(entry.path))throw new Error('Invalid corpus result path.');
    const safe=async()=>{
      const rootStat=await fs.lstat(scope.root);if(rootStat.isSymbolicLink()||identity(rootStat)!==scope.identity||key(await fs.realpath(scope.root))!==key(scope.root))throw new Error('Corpus root changed; scan again.');
      let file=scope.root;for(const part of parts){file=path.join(file,part);if((await fs.lstat(file)).isSymbolicLink())throw new Error('Corpus result became a symbolic link; scan again.');}
      if(key(await fs.realpath(file))!==key(file))throw new Error('Corpus result path changed; scan again.');return file;
    };
    const file=await safe(),expected=await fs.lstat(file);
    if(!expected.isFile()||expected.size>1024*1024||expected.size!==entry.bytes)throw new Error('Corpus file changed; scan again.');
    const handle=await fs.open(file,'r');let decoded;
    try{
      const before=await handle.stat();if(!before.isFile()||identity(before)!==identity(expected)||before.size!==expected.size)throw new Error('Corpus file changed before reading.');
      const bytes=Buffer.alloc(before.size+1);let length=0;
      while(length<bytes.length){const part=await handle.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}
      const after=await handle.stat(),final=await fs.lstat(await safe());
      if(length!==before.size||identity(final)!==identity(before)||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||final.size!==before.size||final.mtimeMs!==before.mtimeMs||final.ctimeMs!==before.ctimeMs||hash(bytes.subarray(0,length))!==entry.hash)throw new Error('Corpus file changed; scan again.');
      decoded=decode(bytes.subarray(0,length),'utf8');
    }finally{await handle.close();}
    if(generation!==this.generation||result!==this.result||scope!==this.scope)throw new Error('Corpus scope or request changed; scan again.');
    return {path:file,name:path.basename(file),...decoded,corpusText:decoded.text};
  }
}
module.exports={ContextCorpusSession};
