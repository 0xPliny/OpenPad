const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ContextHistory}=require('../src/context-history.cjs');
function snapshot(id='session-1',bytes=3){return {sessions:[{root:path.resolve('workspace'),sessionId:id,sessionLabel:'Session',events:[{id:1,timestamp:'2026-09-12T12:00:00.000Z',sessionId:id,actor:'unknown',type:'create',path:'AGENTS.md',bytes,lines:1,byteDelta:bytes,lineDelta:1}]}]};}
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-history-'));return {root,store:new ContextHistory(root),async cleanup(){await fs.rm(root,{recursive:true,force:true});}};}
test('checksummed activity round-trips metadata and recovers a corrupt primary',async()=>{
  const f=await fixture();try{assert.deepEqual(await f.store.load(),{sessions:[]});await f.store.save(snapshot());await f.store.save(snapshot('session-2'));assert.deepEqual(await f.store.load(),snapshot('session-2'));await fs.writeFile(f.store.file,'corrupt');const loaded=await f.store.load();assert.deepEqual(loaded.sessions,snapshot().sessions);assert.match(loaded.warning,/invalid/);
    await f.store.save(snapshot('session-3'));await fs.writeFile(f.store.file,'corrupt again');assert.deepEqual((await f.store.load()).sessions,snapshot().sessions);
  }finally{await f.cleanup();}
});
test('rapid saves preserve call order and capture caller state before asynchronous IO',async()=>{
  const f=await fixture();try{const first=snapshot();const jobs=[f.store.save(first),f.store.save(snapshot('second')),f.store.save(snapshot('third'))];first.sessions[0].events[0].bytes=999;await Promise.all(jobs);assert.deepEqual(await f.store.load(),snapshot('third'));await fs.writeFile(f.store.file,'bad');assert.deepEqual((await f.store.load()).sessions,snapshot('second').sessions);}finally{await f.cleanup();}
});
test('failed primary replacement preserves a recoverable previous generation and later saves recover',async t=>{
  const f=await fixture();try{await f.store.save(snapshot());await f.store.save(snapshot('second'));const rename=fs.rename;t.mock.method(fs,'rename',async(from,to)=>{if(to===f.store.file)throw Object.assign(new Error('injected failure'),{code:'EIO'});return rename(from,to);});await assert.rejects(f.store.save(snapshot('third')),/injected/);t.mock.restoreAll();assert.deepEqual(await f.store.load(),snapshot('second'));await fs.writeFile(f.store.file,'bad');assert.deepEqual((await f.store.load()).sessions,snapshot('second').sessions);await f.store.save(snapshot('fourth'));assert.deepEqual(await f.store.load(),snapshot('fourth'));assert.deepEqual((await fs.readdir(f.root)).sort(),['context-history.json','context-history.json.bak']);}finally{t.mock.restoreAll();await f.cleanup();}
});
test('strict validation rejects content, malformed events and excess sessions without damaging history',async()=>{
  const f=await fixture();try{await f.store.save(snapshot());const invalid=[];let data=snapshot();data.sessions[0].text='private contents';invalid.push(data);data=snapshot();data.sessions[0].events[0].actor='Claude';invalid.push(data);data=snapshot();data.sessions[0].events[0].path='../outside.md';invalid.push(data);data=snapshot();data.sessions[0].events[0].byteDelta=Infinity;invalid.push(data);data=snapshot();data.sessions[0].events[0].sessionId='different';invalid.push(data);data=snapshot();data.sessions[0].status={running:'yes'};invalid.push(data);invalid.push({sessions:Array.from({length:21},(_,i)=>snapshot(String(i)).sessions[0])});for(const value of invalid)await assert.rejects(f.store.save(value),/Invalid/);assert.deepEqual(await f.store.load(),snapshot());}finally{await f.cleanup();}
});
test('separate stores share canonical-path write order and oversized input is not read',async()=>{
  const f=await fixture();try{const second=new ContextHistory(await fs.realpath(f.root));await Promise.all([f.store.save(snapshot()),second.save(snapshot('other')),f.store.save(snapshot('last'))]);const result=await second.load();assert.equal(result.sessions[0].sessionId,'last');const handle=await fs.open(f.store.file,'w');await handle.truncate(5*1024*1024);await handle.close();const fallback=await f.store.load();assert.equal(fallback.sessions[0].sessionId,'other');assert.ok(fallback.warning);}finally{await f.cleanup();}
});
test('a stopped writer and an obsolete lock file cannot prevent restart load and save',async()=>{
  const f=await fixture();let child;
  try{
    await f.store.save(snapshot());await fs.writeFile(f.store.file+'.lock','obsolete lock, retained');
    const source=`const fs=require('node:fs/promises');const {ContextHistory}=require(process.argv[1]);const store=new ContextHistory(process.argv[2]);const rename=fs.rename;fs.rename=async(from,to)=>{if(to===store.file){process.send('ready');await new Promise(()=>{});}return rename(from,to);};setInterval(()=>{},1000);store.save(JSON.parse(process.argv[3])).catch(error=>{process.send({error:error.message});});`;
    child=require('node:child_process').spawn(process.execPath,['-e',source,require.resolve('../src/context-history.cjs'),f.root,JSON.stringify(snapshot('interrupted'))],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Child writer did not reach promotion')),5000);child.once('message',message=>{clearTimeout(timer);if(message==='ready')resolve();else reject(new Error(JSON.stringify(message)));});child.once('error',reject);});
    const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;child=null;
    const restarted=new ContextHistory(f.root);assert.deepEqual(await restarted.load(),snapshot());await restarted.save(snapshot('restarted'));assert.deepEqual(await restarted.load(),snapshot('restarted'));assert.equal(await fs.readFile(f.store.file+'.lock','utf8'),'obsolete lock, retained');
  }finally{if(child){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}await f.cleanup();}
});
test('valid checksums cannot certify malformed metadata and both corrupt generations remain visible',async()=>{
  const f=await fixture();try{await f.store.save(snapshot());await f.store.save(snapshot('second'));const payload=JSON.stringify({sessions:[{text:'must not load'}]});await fs.writeFile(f.store.file,JSON.stringify({version:1,payload,sha256:require('node:crypto').createHash('sha256').update(payload).digest('hex')}));assert.deepEqual((await f.store.load()).sessions,snapshot().sessions);await fs.writeFile(f.store.file+'.bak','also corrupt');const result=await f.store.load();assert.deepEqual(result.sessions,[]);assert.ok(result.warning);}finally{await f.cleanup();}
});
test('observed ranges and normalized text hashes persist without decoded snapshots and reject invalid spans',async()=>{
  const f=await fixture();try{
    const data=snapshot(),event=data.sessions[0].events[0];event.ranges={before:{fromLine:1,toLine:1},after:{fromLine:1,toLine:2},deletionAnchor:null,approximate:false};event.rangeReason=null;event.afterTextHash=require('node:crypto').createHash('sha256').update('abc').digest('hex');data.sessions[0].status={snapshotBytes:6,snapshotFiles:1,snapshotEvictions:2,limits:{maxSnapshotBytes:16*1024*1024,maxScanBytes:64*1024*1024}};
    await f.store.save(data);assert.deepEqual(await f.store.load(),data);const serialized=await fs.readFile(f.store.file,'utf8');assert.ok(!serialized.includes('"text"'));
    const bad=structuredClone(data);bad.sessions[0].events[0].ranges.after.toLine=99;await assert.rejects(f.store.save(bad),/range/);
    const content=structuredClone(data);content.sessions[0].events[0].ranges.text='contents';await assert.rejects(f.store.save(content),/range/);
    const memory=structuredClone(data);memory.sessions[0].status.snapshotBytes=17*1024*1024;await assert.rejects(f.store.save(memory),/memory/);
    const absent=structuredClone(data);absent.sessions[0].events[0].ranges=null;absent.sessions[0].events[0].rangeReason='previous-snapshot-unavailable';await f.store.save(absent);assert.deepEqual(await f.store.load(),absent);
  }finally{await f.cleanup();}
});
