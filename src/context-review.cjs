const fs=require('node:fs/promises'),{realpathSync}=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {replaceFile}=require('./replace-file.cjs');
const MAX_RECORDS=128,MAX_TEXT_BYTES=1024*1024,MAX_BYTES=8*1024*1024,MAX_WAITERS=256;
const leases=new Set(),digest=value=>createHash('sha256').update(value,'utf8').digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,fields)=>object(value)&&Object.keys(value).every(key=>fields.includes(key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const bounded=(value,limit)=>typeof value==='string'&&value.length<=limit&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
function canonical(directory){let current=path.resolve(directory),suffix=[];for(;;)try{return path.join(realpathSync.native(current),...suffix);}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;suffix.unshift(path.basename(current));current=parent;}}
function side(value,stored=false){
  if(!object(value))throw new Error('Review snapshot descriptor is required.');
  if(value.state==='absent'&&exact(value,['state']))return {state:'absent'};
  if(value.state==='unavailable'&&exact(value,['state','reason','rawHash'])&&bounded(value.reason,256)&&value.reason&&(!('rawHash'in value)||hash(value.rawHash)))return {...value};
  if(!stored&&value.state==='present'&&exact(value,['state','text','rawHash'])&&typeof value.text==='string'&&hash(value.rawHash)&&(value.text.length>MAX_TEXT_BYTES||Buffer.byteLength(value.text)>MAX_TEXT_BYTES))return {state:'unavailable',reason:'snapshot-size-limit',rawHash:value.rawHash};
  if(value.state!=='present'||!exact(value,stored?['state','text','rawHash','textHash']:['state','text','rawHash'])||typeof value.text!=='string'||value.text.length>MAX_TEXT_BYTES||!value.text.isWellFormed()||Buffer.byteLength(value.text)>MAX_TEXT_BYTES||!hash(value.rawHash))throw new Error('Review text must be valid Unicode up to 1 MiB with a raw byte hash.');
  const text=value.text.replace(/\r\n|\r/g,'\n'),textHash=digest(text);
  if(stored&&(value.text!==text||value.textHash!==textHash))throw new Error('Review text checksum failed.');
  return {state:'present',text,rawHash:value.rawHash,textHash};
}
function observation(value,stored=false){
  if(!object(value)||!object(value.event)||!bounded(value.root,4096)||!path.isAbsolute(value.root))throw new Error('Invalid review observation root/event.');
  const source=value.event,event={sessionId:source.sessionId,id:source.id,type:source.type,path:source.path,timestamp:source.timestamp,actor:source.actor};
  if(stored&&!exact(source,Object.keys(event)))throw new Error('Unexpected review event metadata.');
  if(!bounded(event.sessionId,128)||!event.sessionId||event.sessionId.includes(':')||!Number.isSafeInteger(event.id)||event.id<1||!['create','modify','delete'].includes(event.type)||event.actor!=='unknown'||!stamp(event.timestamp)||!bounded(event.path,2048)||!event.path||path.isAbsolute(event.path)||event.path.includes('\\')||event.path.includes(':')||event.path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid review event metadata.');
  const before=side(value.before,stored),after=side(value.after,stored);
  if(event.type==='create'&&before.state==='present'||event.type==='delete'&&after.state!=='absent'||event.type!=='create'&&before.state==='absent'||event.type!=='delete'&&after.state==='absent')throw new Error('Absent snapshots must agree with creation/deletion.');
  return {key:`${event.sessionId}:${event.id}`,root:value.root,event,before,after};
}
function validateRecord(value){
  if(!exact(value,['key','root','event','before','after','decision']))throw new Error('Unexpected review record fields.');
  const record=observation(value,true),decision=value.decision;
  if(value.key!==record.key||!exact(decision,['value','revision','updatedAt'])||!['unreviewed','acknowledged','needs-attention'].includes(decision.value)||!Number.isSafeInteger(decision.revision)||decision.revision<0||(decision.revision===0?(decision.value!=='unreviewed'||decision.updatedAt!==null):!stamp(decision.updatedAt)))throw new Error('Invalid review decision.');
  return {...record,decision:{...decision}};
}
function encode(snapshot){const payload=JSON.stringify(snapshot);return JSON.stringify({version:1,payload,sha256:digest(payload)});}
function parse(raw){
  const envelope=JSON.parse(raw);if(!exact(envelope,['version','payload','sha256'])||envelope.version!==1||typeof envelope.payload!=='string'||digest(envelope.payload)!==envelope.sha256)throw new Error('Review store checksum failed.');
  const value=JSON.parse(envelope.payload);if(!exact(value,['records','evicted'])||!Array.isArray(value.records)||value.records.length>MAX_RECORDS||!Number.isSafeInteger(value.evicted)||value.evicted<0)throw new Error('Invalid review store.');
  const records=value.records.map(validateRecord);if(new Set(records.map(record=>record.key)).size!==records.length)throw new Error('Duplicate review observation.');return {records,evicted:value.evicted};
}
async function read(file){const handle=await fs.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error('Review store is oversized or not a regular file.');const bytes=Buffer.alloc(stat.size+1);let length=0;while(length<bytes.length){const part=await handle.read(bytes,length,bytes.length-length,length);if(!part.bytesRead)break;length+=part.bytesRead;}if(length!==stat.size)throw new Error('Review store changed during reading.');return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length));}finally{await handle.close();}}
async function synced(file,raw){const handle=await fs.open(file,'wx');try{await handle.writeFile(raw,'utf8');await handle.sync();}finally{await handle.close();}}
class ContextReviewStore{
  constructor(directory){
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Review store requires an absolute app-data directory.');
    this.file=path.join(canonical(directory),'context-review.json');this.lease=process.platform==='win32'?this.file.toLowerCase():this.file;
    if(leases.has(this.lease))throw new Error('A review store already owns this profile path.');leases.add(this.lease);
    this.committed={records:[],evicted:0};this.pending=null;this.active=null;this.work=null;this.warning='';this.persistenceError='';this.loaded=false;this.closed=false;this.waiters=0;
  }
  async load(){
    if(this.closed)throw new Error('Review store is closed.');if(this.loading)return this.loading;
    this.loading=(async()=>{for(const file of [this.file,this.file+'.bak'])try{this.committed=parse(await read(file));this.loaded=true;return {...structuredClone(this.committed),warning:this.warning};}catch(error){if(error.code!=='ENOENT')this.warning='Review history was unreadable or invalid; previous generation was attempted.';}
      this.loaded=true;return {...structuredClone(this.committed),warning:this.warning};})();return this.loading;
  }
  list(){return this.committed.records.map(({before,after,...record})=>({...structuredClone(record),before:{state:before.state,...(before.reason?{reason:before.reason}:{})},after:{state:after.state,...(after.reason?{reason:after.reason}:{})}}));}
  get(key){const record=this.committed.records.find(record=>record.key===key);return record?structuredClone(record):null;}
  status(){return {warning:this.warning,records:this.committed.records.length,evicted:this.committed.evicted,pending:this.waiters};}
  enqueue(change,expectation){
    if(this.closed||!this.loaded)return Promise.reject(new Error(this.closed?'Review store is closed.':'Load review history first.'));
    if(this.waiters>=MAX_WAITERS)return Promise.reject(new Error('Review persistence queue is full; observation was not retained.'));
    let snapshot,raw;
    try{
      const base=this.pending?.snapshot||this.active?.snapshot||this.committed;
      snapshot=change(base);raw=encode(snapshot);
      while(snapshot.records.length>MAX_RECORDS||Buffer.byteLength(raw)>MAX_BYTES){if(snapshot.records.length<=1)throw new Error('Review observation exceeds the serialized storage limit.');snapshot={records:snapshot.records.slice(1),evicted:Math.min(Number.MAX_SAFE_INTEGER,snapshot.evicted+1)};raw=encode(snapshot);}
    }catch(error){return Promise.reject(error);}
    this.waiters++;
    const promise=new Promise((resolve,reject)=>{const waiter={resolve,reject,...expectation};if(this.pending){this.pending.snapshot=snapshot;this.pending.raw=raw;this.pending.waiters.push(waiter);}else this.pending={snapshot,raw,waiters:[waiter]};});
    if(!this.work)this.work=Promise.resolve().then(()=>this.drain());return promise;
  }
  capture(value){
    if(this.waiters>=MAX_WAITERS)return Promise.reject(new Error('Review persistence queue is full; observation was not retained.'));
    let record;try{record={...observation(value),decision:{value:'unreviewed',revision:0,updatedAt:null}};}catch(error){return Promise.reject(error);}
    return this.enqueue(base=>{
      const old=base.records.find(item=>item.key===record.key);if(old){const {decision,...existing}=old,{decision:ignored,...incoming}=record;if(JSON.stringify(existing)!==JSON.stringify(incoming))throw new Error('An observed review snapshot is immutable.');return base;}
      return {records:[...base.records,record],evicted:base.evicted};
    },{key:record.key,kind:'capture'});
  }
  decide({key,expectedRevision,decision}={}){
    return this.enqueue(base=>{
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision===Number.MAX_SAFE_INTEGER||!['unreviewed','acknowledged','needs-attention'].includes(decision))throw new Error('Invalid review decision request.');
      const record=base.records.find(record=>record.key===key);if(!record)throw new Error('Review observation is no longer retained.');if(record.decision.revision!==expectedRevision)throw new Error('Review decision changed; refresh before deciding.');
      return {records:base.records.map(item=>item===record?{...item,decision:{value:decision,revision:expectedRevision+1,updatedAt:new Date().toISOString()}}:item),evicted:base.evicted};
    },{key,kind:'decision',revision:expectedRevision+1});
  }
  async persist(raw){
    await fs.mkdir(path.dirname(this.file),{recursive:true});const temporary=this.file+'.'+randomUUID()+'.tmp',backup=temporary+'.bak';
    try{
      await synced(temporary,raw);let previous;
      try{const candidate=await read(this.file);parse(candidate);previous=candidate;}catch(error){if(error.code&&error.code!=='ENOENT')throw error;}
      if(previous){await synced(backup,previous);await replaceFile(backup,this.file+'.bak');}await replaceFile(temporary,this.file);
    }finally{await Promise.all([temporary,backup].map(file=>fs.unlink(file).catch(()=>{})));}
  }
  async drain(){
    try{while(this.pending){const batch=this.pending;this.pending=null;this.active=batch;
      try{
        await this.persist(batch.raw);this.committed=batch.snapshot;this.warning='';this.persistenceError='';
        for(const waiter of batch.waiters){this.waiters--;const record=this.committed.records.find(item=>item.key===waiter.key);
          if(waiter.kind==='capture')waiter.resolve({key:waiter.key,retained:!!record});
          else if(record?.decision.revision===waiter.revision)waiter.resolve(structuredClone(record));
          else waiter.reject(new Error('Review decision was superseded or evicted before persistence.'));
        }
      }catch(error){
        this.persistenceError=this.warning=`Review history was not saved: ${error.message}`;
        const rejected=[...batch.waiters,...(this.pending?.waiters||[])];this.pending=null;for(const waiter of rejected){this.waiters--;waiter.reject(error);}
      }finally{this.active=null;}
    }}finally{this.work=null;}
  }
  // Recovery notices describe existing history; only an unsuccessful write leaves work unsaved.
  async flush(){await this.work;if(this.persistenceError)throw new Error(this.persistenceError);return this.status();}
  async close(){this.closed=true;try{await this.flush();}finally{leases.delete(this.lease);}}
}
module.exports={ContextReviewStore,MAX_RECORDS,MAX_TEXT_BYTES,MAX_BYTES};
