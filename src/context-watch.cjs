const fs=require('node:fs');
const io=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');

const defaults={maxFiles:5000,maxFileBytes:2*1024*1024,maxScanBytes:64*1024*1024,maxSnapshotBytes:16*1024*1024,maxScanEntries:20000,maxQueue:2000,maxEvents:2000,debounceMs:120,maxDepth:24};
const forbidden=/^(?:\.git|node_modules|\.env(?:\..*)?|secrets?(?:\..*)?|credentials?(?:\..*)?|\.ssh|\.aws|\.azure|.*id_rsa.*)$/i;
const secretExtension=/\.(?:pem|key|pfx|p12|kdbx)$/i;
const identity=s=>`${s.dev}:${s.ino}`;
const key=p=>process.platform==='win32'?p.toLowerCase():p;
const normalize=text=>text.replace(/\r\n|\r/g,'\n');
const textHash=text=>createHash('sha256').update(normalize(text)).digest('hex');
function changedRange(before,after){
  const a=before?normalize(before).split('\n'):[],b=after?normalize(after).split('\n'):[];
  let prefix=0,suffix=0;while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
  while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  if(prefix===a.length&&prefix===b.length)return null;
  const oldMiddle=new Set(a.slice(prefix,a.length-suffix));
  return {before:{fromLine:prefix+1,toLine:a.length-suffix+1},after:{fromLine:prefix+1,toLine:b.length-suffix+1},deletionAnchor:b.length-suffix===prefix&&a.length-suffix>prefix?Math.max(1,Math.min(prefix+1,b.length)):null,approximate:b.slice(prefix,b.length-suffix).some(line=>oldMiddle.has(line))};
}
function glob(pattern){
  if(typeof pattern!=='string'||!pattern||pattern.length>200||pattern.includes('..')||pattern.includes('\\'))throw new Error('Use relative glob patterns with / separators.');
  let source='';
  for(let i=0;i<pattern.length;i++){
    if(pattern[i]==='*'&&pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;source+='(?:.*/)?';}else source+='.*';}
    else if(pattern[i]==='*')source+='[^/]*';
    else if(pattern[i]==='?')source+='[^/]';
    else source+=pattern[i].replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  }
  return new RegExp(`^${source}$`,'i');
}
class ContextWatch {
  constructor(options={}){
    const {onEvent,onStatus,onObservation,...limits}=options;
    if(onEvent!==undefined&&typeof onEvent!=='function')throw new Error('onEvent must be a function.');
    if(onObservation!==undefined&&typeof onObservation!=='function')throw new Error('onObservation must be a function.');
    this.onEvent=onEvent;this.onStatus=onStatus;this.onObservation=onObservation;
    this.limits={...defaults,...limits};
    for(const [name,value] of Object.entries(this.limits))if(!(name in defaults)||!Number.isInteger(value)||value<1||value>defaults[name]*10)throw new Error(`Invalid watch limit: ${name}`);
    if(this.limits.maxSnapshotBytes>defaults.maxSnapshotBytes)throw new Error('Snapshot memory cannot exceed 16 MiB.');
    this.snapshots=new Map();this.latest=new Map();this.invalidated=new Set();this.snapshotBytes=0;this.snapshotEvictions=0;
    this.running=false;this.generation=0;this.events=[];this.sequence=0;this.sessionId=randomUUID();this.entries=new Map();this.pending=new Set();this.droppedEvents=0;this.issues=0;this.overflows=0;this.busy=false;this.scanning=false;this.root=null;
  }
  notifyStatus(){try{this.onStatus?.(this.status());}catch{}}
  status(){return {running:this.running,root:this.root,sessionId:this.sessionId,sessionLabel:this.sessionLabel||'',baselineScanning:this.scanning,busy:this.busy,trackedFiles:this.entries.size,snapshotBytes:this.snapshotBytes,snapshotFiles:this.snapshots.size,snapshotEvictions:this.snapshotEvictions,queuedPaths:this.pending.size,retainedEvents:this.events.length,droppedEvents:this.droppedEvents,issues:this.issues,overflows:this.overflows,complete:this.running&&!this.scanning&&!this.busy&&!this.pending.size&&!this.issues,limits:{...this.limits}};}
  getEvents({after=0,limit=this.limits.maxEvents}={}){
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid event range.');
    return this.events.filter(e=>e.id>after).slice(0,Math.min(limit,this.limits.maxEvents)).map(e=>structuredClone(e));
  }
  newSession(label=''){if(typeof label!=='string'||label.length>120)throw new Error('Session label must be at most 120 characters.');this.sessionLabel=label;this.sessionId=randomUUID();this.events=[];this.droppedEvents=0;this.snapshots.clear();this.latest.clear();this.invalidated.clear();this.snapshotBytes=0;this.snapshotEvictions=0;return this.sessionId;}
  record(data){const event={id:++this.sequence,timestamp:new Date().toISOString(),sessionId:this.sessionId,actor:'unknown',...data};this.events.push(event);if(this.events.length>this.limits.maxEvents){this.events.shift();this.droppedEvents++;}if(this.onEvent){try{this.onEvent(structuredClone(event));}catch{ /* Consumer notifications must not interrupt filesystem observation. */ }}return event;}
  observe(event,before,after){if(this.onObservation)this.onObservation({event:structuredClone(event),root:this.root,before,after});}
  discardSnapshot(id){const previous=this.snapshots.get(id);if(previous){this.snapshotBytes-=previous.bytes;this.snapshots.delete(id);}}
  retainSnapshot(id,text){
    this.discardSnapshot(id);const bytes=text.length*2;
    if(bytes>this.limits.maxSnapshotBytes)return;
    while(this.snapshotBytes+bytes>this.limits.maxSnapshotBytes){this.discardSnapshot(this.snapshots.keys().next().value);this.snapshotEvictions++;}
    this.snapshots.set(id,{text,bytes});this.snapshotBytes+=bytes;
  }
  invalidate(relative,discard=true){for(const id of this.latest.keys())if(!relative||id===key(relative)||id.startsWith(key(relative)+'/')){if(discard){this.latest.delete(id);this.invalidated.delete(id);}else this.invalidated.add(id);}}
  issue(code,relative,message){this.invalidate(relative);for(const id of this.snapshots.keys())if(!relative||id===key(relative)||id.startsWith(key(relative)+'/'))this.discardSnapshot(id);this.issues++;if(code==='overflow')this.overflows++;this.record({type:'issue',code,path:relative,message});}
  excluded(relative){return relative.split('/').some(p=>forbidden.test(p))||secretExtension.test(relative)||this.excludes.some(re=>re.test(relative));}
  included(relative){return !this.excluded(relative)&&this.includes.some(re=>re.test(relative));}
  relative(target){const relative=path.relative(this.root,path.resolve(target));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('Path leaves watched root.');return relative.split(path.sep).join('/');}
  async safe(relative){
    this.relative(path.resolve(this.root,relative));
    const rootStat=await io.lstat(this.root);
    if(rootStat.isSymbolicLink()||identity(rootStat)!==this.rootIdentity||key(await io.realpath(this.root))!==key(this.root))throw new Error('Watched root identity changed.');
    const parts=relative.split('/').filter(Boolean);let current=this.root;
    for(const part of parts){current=path.join(current,part);if((await io.lstat(current)).isSymbolicLink())throw new Error('Symbolic links are excluded.');}
    this.relative(await io.realpath(current));
    return current;
  }
  async hasPath(absolutePath){
    if(!this.running||typeof absolutePath!=='string'||!path.isAbsolute(absolutePath))return false;
    try{if((await io.lstat(absolutePath)).isSymbolicLink())return false;const relative=this.relative(await io.realpath(absolutePath));if(!this.included(relative)||!this.entries.has(key(relative)))return false;const stat=await io.lstat(await this.safe(relative));return stat.isFile()&&stat.size<=this.limits.maxFileBytes;}catch{return false;}
  }
  async latestObservation(absolutePath){
    if(!await this.hasPath(absolutePath))return null;
    try{const relative=this.relative(await io.realpath(absolutePath)),id=key(relative),event=this.latest.get(id);return event&&!this.busy&&!this.scanning&&!this.pending.size&&!this.invalidated.has(id)&&event.sessionId===this.sessionId?structuredClone(event):null;}catch{return null;}
  }
  async start(root,{include=['**/*.md','**/*.markdown','**/AGENTS','**/CLAUDE','**/.cursorrules','**/*.mdc'],exclude=[]}={}){
    await this.stop();
    if(typeof root!=='string'||!root||!Array.isArray(include)||!include.length||include.length>50||!Array.isArray(exclude)||exclude.length>50)throw new Error('Choose a folder and bounded include/exclude glob lists.');
    this.includes=include.map(glob);this.excludes=exclude.map(glob);this.root=path.resolve(root);
    const initial=await io.lstat(this.root);if(!initial.isDirectory()||initial.isSymbolicLink())throw new Error('Watch root must be a real directory.');
    this.root=await io.realpath(this.root);this.rootIdentity=identity(initial);this.entries.clear();this.pending.clear();this.issues=0;this.overflows=0;this.newSession();
    this.running=true;this.scanning=true;const generation=++this.generation;
    try{
      this.watcher=fs.watch(this.root,{recursive:true},(_event,name)=>{
        if(!this.running||generation!==this.generation)return;
        if(name===null){this.issue('overflow','', 'Filesystem event omitted its path; restart to establish a new baseline.');return;}
        try{this.enqueue(this.relative(path.resolve(this.root,String(name))));}catch(error){this.issue('path','',error.message);}
      });
      this.watcher.on('error',error=>{if(generation===this.generation){this.issue('watch','',error.message);this.running=false;this.watcher.close();}});
      await this.scan('',true,{count:0},generation);
    }catch(error){if(generation===this.generation){this.issue('start','',error.message);this.running=false;this.watcher?.close();}throw error;}
    finally{if(generation===this.generation){this.scanning=false;this.schedule();this.notifyStatus();}}
    return this.status();
  }
  async stop(){this.running=false;this.generation++;clearTimeout(this.timer);this.watcher?.close();this.watcher=null;this.pending.clear();this.latest.clear();this.invalidated.clear();this.snapshots.clear();this.snapshotBytes=0;this.scanning=false;await this.work?.catch(()=>{});this.busy=false;this.notifyStatus();return this.status();}
  enqueue(relative){
    if(!relative||this.excluded(relative))return;
    this.invalidate(relative,false);
    if(this.pending.size>=this.limits.maxQueue&&!this.pending.has(relative)){this.issue('overflow',relative,'Changed-path queue is full; restart to establish a new baseline.');return;}
    this.pending.add(relative);this.schedule();
  }
  schedule(){if(!this.running||this.scanning||this.busy||!this.pending.size)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{this.work=this.flush();},this.limits.debounceMs);}
  async flush(){
    if(this.busy||!this.running)return;this.busy=true;const generation=this.generation;
    try{while(this.running&&generation===this.generation&&this.pending.size){const relative=this.pending.values().next().value;this.pending.delete(relative);await this.scan(relative,false,{count:0},generation);}}
    catch(error){if(generation===this.generation)this.issue('scan','',error.message);}
    finally{this.busy=false;this.schedule();this.notifyStatus();}
  }
  remove(relative){for(const [id,previous] of this.entries)if(id===key(relative)||id.startsWith(key(relative)+'/')){const snapshot=this.snapshots.get(id),ranges=snapshot?changedRange(snapshot.text,''):null;this.entries.delete(id);this.latest.delete(id);this.invalidated.delete(id);this.discardSnapshot(id);const event=this.record({type:'delete',path:previous.path,bytes:0,lines:0,byteDelta:-previous.bytes,lineDelta:-previous.lines,ranges,rangeReason:ranges?null:snapshot?'no-text-change':'previous-snapshot-unavailable',afterTextHash:null});this.observe(event,snapshot?{state:'present',text:normalize(snapshot.text),rawHash:previous.hash}:{state:'unavailable',reason:'previous-snapshot-unavailable',rawHash:previous.hash},{state:'absent'});}}
  async scan(relative,baseline,budget,generation){
    if(!this.running||generation!==this.generation||this.excluded(relative))return;
    if(++budget.count>this.limits.maxScanEntries){if(!budget.reported){budget.reported=true;this.issue('overflow',relative,'Directory scan entry limit reached; coverage is incomplete.');}return;}
    if(relative.split('/').length>this.limits.maxDepth){this.issue('overflow',relative,'Directory depth limit reached.');return;}
    try{
      const file=await this.safe(relative),stat=await io.lstat(file);
      if(stat.isDirectory()){
        const directory=await io.opendir(file);
        for await(const entry of directory){if(!this.running||generation!==this.generation||budget.count>this.limits.maxScanEntries)break;await this.scan(relative?relative+'/'+entry.name:entry.name,baseline,budget,generation);}
      }else if(stat.isFile()&&this.included(relative)){
        if((budget.bytes||0)+stat.size>this.limits.maxScanBytes){if(!budget.bytesReported){budget.bytesReported=true;this.issue('overflow',relative,'Directory scan byte limit reached; coverage is incomplete.');}return;}
        budget.bytes=(budget.bytes||0)+stat.size;await this.read(relative,stat,baseline,generation);
      }
    }catch(error){if(generation!==this.generation)return;if(error.code==='ENOENT'||error.code==='ENOTDIR'){if(!baseline)this.remove(relative);}else this.issue('read',relative,error.message);}
  }
  async read(relative,expected,baseline,generation){
    const id=key(relative),previous=this.entries.get(id),sessionId=this.sessionId;
    if(expected.size>this.limits.maxFileBytes){this.issue('oversize',relative,'File exceeds watch byte limit; no content was read.');return;}
    if(!previous&&this.entries.size>=this.limits.maxFiles){this.issue('overflow',relative,'Tracked-file limit reached.');return;}
    const file=await this.safe(relative),handle=await io.open(file,'r');
    try{
      const before=await handle.stat();if(!before.isFile()||identity(before)!==identity(expected)||before.size>this.limits.maxFileBytes)throw new Error('File identity or size changed before reading.');
      const bytes=Buffer.alloc(before.size+1);let length=0;
      while(length<bytes.length){const result=await handle.read(bytes,length,bytes.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
      const after=await handle.stat(),final=await io.lstat(await this.safe(relative));
      if(length!==before.size||identity(final)!==identity(before)||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||after.size!==final.size||after.mtimeMs!==final.mtimeMs)throw new Error('File changed during reading; delta unavailable.');
      const content=bytes.subarray(0,length),text=new TextDecoder('utf-8',{fatal:true}).decode(content);
      const next={path:relative,bytes:length,lines:text.length?1+(text.match(/\r\n|\r|\n/g)||[]).length:0,hash:createHash('sha256').update(content).digest('hex')};
      if(!this.running||generation!==this.generation)return;
      this.entries.set(id,next);
      const snapshot=this.snapshots.get(id);
      if(!baseline&&(!previous||previous.hash!==next.hash)){
        const ranges=sessionId!==this.sessionId?null:previous&&!snapshot?null:changedRange(snapshot?.text||'',text);
        const rangeReason=ranges?null:sessionId!==this.sessionId?'session-boundary':previous&&!snapshot?'previous-snapshot-unavailable':'no-text-change';
        const event=this.record({type:previous?'modify':'create',path:relative,bytes:next.bytes,lines:next.lines,byteDelta:next.bytes-(previous?.bytes||0),lineDelta:next.lines-(previous?.lines||0),ranges,rangeReason,afterTextHash:textHash(text)});
        this.latest.set(id,event);
        const before=sessionId!==this.sessionId?{state:'unavailable',reason:'session-boundary'}:!previous?{state:'absent'}:snapshot?{state:'present',text:normalize(snapshot.text),rawHash:previous.hash}:{state:'unavailable',reason:'previous-snapshot-unavailable',rawHash:previous.hash};
        this.observe(event,before,{state:'present',text:normalize(text),rawHash:next.hash});
      }
      this.invalidated.delete(id);
      this.retainSnapshot(id,text);
    }finally{await handle.close();}
  }
}
module.exports={ContextWatch};
