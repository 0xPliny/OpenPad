const fs=require('node:fs/promises');
const {realpathSync}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {replaceFile}=require('./replace-file.cjs');
const MAX_BYTES=4*1024*1024;
// Electron owns the profile's process lock. These queues coordinate stores inside that process only.
const queues=new Map();
function canonicalDirectory(directory){
  const suffix=[];let current=path.resolve(directory);
  for(;;)try{return path.join(realpathSync.native(current),...suffix);}
  catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(current);if(parent===current)throw error;suffix.unshift(path.basename(current));current=parent;}
}
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const timestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value));
const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
const hash=value=>createHash('sha256').update(value).digest('hex');
function validate(snapshot){
  if(!keys(snapshot,['sessions'])||!Array.isArray(snapshot.sessions)||snapshot.sessions.length>20)throw new Error('Invalid activity-history sessions.');
  const ids=new Set();let count=0;
  for(const session of snapshot.sessions){
    if(!keys(session,['root','sessionId','sessionLabel','startedAt','updatedAt','status','events'])||!text(session.root,4096)||!path.isAbsolute(session.root)||!text(session.sessionId,128)||!session.sessionId||ids.has(session.sessionId)||!Array.isArray(session.events)||session.events.length>2000)throw new Error('Invalid activity-history session metadata.');
    ids.add(session.sessionId);
    if(session.sessionLabel!==undefined&&!text(session.sessionLabel,120))throw new Error('Invalid activity session label.');
    for(const key of ['startedAt','updatedAt'])if(session[key]!==undefined&&!timestamp(session[key]))throw new Error('Invalid activity session timestamp.');
    if(session.status!==undefined){
      const status=session.status,flags=['running','baselineScanning','busy','complete'],numbers=['trackedFiles','snapshotBytes','snapshotFiles','snapshotEvictions','queuedPaths','retainedEvents','droppedEvents','issues','overflows'];
      if(!keys(status,[...flags,...numbers,'root','sessionId','sessionLabel','limits']))throw new Error('Invalid activity status fields.');
      for(const key of flags)if(status[key]!==undefined&&typeof status[key]!=='boolean')throw new Error('Invalid activity status flag.');
      for(const key of numbers)if(status[key]!==undefined&&!integer(status[key]))throw new Error('Invalid activity status count.');
      if(status.root!==undefined&&status.root!==session.root||status.sessionId!==undefined&&status.sessionId!==session.sessionId||status.sessionLabel!==undefined&&(!text(status.sessionLabel,120)||status.sessionLabel!==(session.sessionLabel||'')))throw new Error('Activity status belongs to a different session.');
      if(status.limits!==undefined&&(!keys(status.limits,['maxFiles','maxFileBytes','maxScanBytes','maxSnapshotBytes','maxScanEntries','maxQueue','maxEvents','debounceMs','maxDepth'])||Object.values(status.limits).some(value=>!integer(value)||value<1||value>1024*1024*1024)))throw new Error('Invalid activity limits.');
      if((status.limits?.maxSnapshotBytes||0)>16*1024*1024||(status.snapshotBytes||0)>(status.limits?.maxSnapshotBytes||16*1024*1024))throw new Error('Invalid snapshot memory accounting.');
    }
    let previous=0;
    for(const event of session.events){
      if(++count>10000)throw new Error('Activity history exceeds the event limit.');
      if(!keys(event,['id','timestamp','sessionId','actor','type','path','bytes','lines','byteDelta','lineDelta','code','message','ranges','rangeReason','afterTextHash'])||!integer(event.id)||event.id<=previous||!timestamp(event.timestamp)||event.sessionId!==session.sessionId||event.actor!=='unknown'||!text(event.path,2048)||event.path.includes('\\')||path.isAbsolute(event.path)||event.path.split('/').some(part=>part==='..'||part==='.')||!['create','modify','delete','issue'].includes(event.type))throw new Error('Invalid activity event metadata.');
      previous=event.id;
      if(event.type==='issue'){
        if(!['overflow','oversize','read','watch','start','path','scan'].includes(event.code)||!text(event.message,1024)||['bytes','lines','byteDelta','lineDelta','ranges','rangeReason','afterTextHash'].some(key=>event[key]!==undefined))throw new Error('Invalid activity issue.');
      }else if(!event.path||!integer(event.bytes)||!integer(event.lines)||!Number.isSafeInteger(event.byteDelta)||!Number.isSafeInteger(event.lineDelta)||event.code!==undefined||event.message!==undefined)throw new Error('Invalid activity change counts.');
      if(event.ranges!==undefined){
        if(event.type==='delete'?event.afterTextHash!==null:typeof event.afterTextHash!=='string'||!/^[a-f0-9]{64}$/.test(event.afterTextHash))throw new Error('Invalid observed text hash.');
        if(event.ranges===null){if(!['previous-snapshot-unavailable','session-boundary','no-text-change'].includes(event.rangeReason))throw new Error('Invalid unavailable-range reason.');}
        else{
          const r=event.ranges,oldLines=event.lines-event.lineDelta;
          const interval=(value,max)=>keys(value,['fromLine','toLine'])&&integer(value.fromLine)&&value.fromLine>=1&&integer(value.toLine)&&value.toLine>=value.fromLine&&value.toLine<=max+1;
          if(!integer(oldLines)||!keys(r,['before','after','deletionAnchor','approximate'])||!interval(r.before,oldLines)||!interval(r.after,event.lines)||r.before.fromLine!==r.after.fromLine||typeof r.approximate!=='boolean'||event.rangeReason!==null)throw new Error('Invalid observed line range.');
          const deletion=r.after.fromLine===r.after.toLine&&r.before.fromLine<r.before.toLine;
          if(deletion?(!integer(r.deletionAnchor)||r.deletionAnchor<1||r.deletionAnchor>Math.max(1,event.lines)):r.deletionAnchor!==null)throw new Error('Invalid deletion anchor.');
        }
      }else if(event.rangeReason!==undefined||event.afterTextHash!==undefined)throw new Error('Observed range metadata is incomplete.');
    }
  }
  return snapshot;
}
function envelope(snapshot){const payload=JSON.stringify(validate(snapshot)),raw=JSON.stringify({version:1,payload,sha256:hash(payload)});if(Buffer.byteLength(raw)>MAX_BYTES)throw new Error('Activity history exceeds the byte limit.');return raw;}
function parse(raw){const data=JSON.parse(raw);if(!keys(data,['version','payload','sha256'])||data.version!==1||typeof data.payload!=='string'||hash(data.payload)!==data.sha256)throw new Error('Activity history checksum failed.');return validate(JSON.parse(data.payload));}
async function readBounded(file){
  const handle=await fs.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error('Activity history is oversized or not a regular file.');const buffer=Buffer.alloc(stat.size+1);let total=0;while(total<buffer.length){const {bytesRead}=await handle.read(buffer,total,buffer.length-total,total);if(!bytesRead)break;total+=bytesRead;}if(total!==stat.size)throw new Error('Activity history changed during reading.');return buffer.subarray(0,total).toString('utf8');}finally{await handle.close();}
}
async function writeSynced(file,raw){const handle=await fs.open(file,'wx');try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}}
class ContextHistory {
  constructor(directory){if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Activity history requires an absolute app-data directory.');this.file=path.join(canonicalDirectory(directory),'context-history.json');this.queueKey=process.platform==='win32'?this.file.toLowerCase():this.file;}
  async load(){
    await queues.get(this.queueKey)?.catch(()=>{});let warning;
    for(const file of [this.file,this.file+'.bak'])try{const snapshot=parse(await readBounded(file));return {...snapshot,...(warning?{warning}:{} )};}catch(error){if(error.code!=='ENOENT'||file===this.file+'.bak'&&warning)warning='Activity history was unreadable or invalid; the previous snapshot was attempted.';}
    return {sessions:[],...(warning?{warning}:{})};
  }
  save(snapshot){
    let raw;try{raw=envelope(snapshot);}catch(error){return Promise.reject(error);}
    const queued=(queues.get(this.queueKey)||Promise.resolve()).catch(()=>{}).then(async()=>{
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      const temporary=this.file+'.'+randomUUID()+'.tmp',backup=temporary+'.bak';
      try{
        await writeSynced(temporary,raw);
        let previous;
        try{const candidate=await readBounded(this.file);parse(candidate);previous=candidate;}catch(error){if(error.code&&error.code!=='ENOENT')throw error;}
        // Never replace the good fallback with a corrupt primary generation.
        if(previous){await writeSynced(backup,previous);await replaceFile(backup,this.file+'.bak');}
        await replaceFile(temporary,this.file);
        return true;
      }finally{await Promise.all([temporary,backup].map(file=>fs.unlink(file).catch(()=>{})));}
    });
    queues.set(this.queueKey,queued);
    const cleanup=()=>{if(queues.get(this.queueKey)===queued)queues.delete(this.queueKey);};
    queued.then(cleanup,cleanup);
    return queued;
  }
}
module.exports={ContextHistory};
