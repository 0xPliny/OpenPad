const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {ContextReviewStore,MAX_BYTES}=require('../src/context-review.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
const present=text=>({state:'present',text,rawHash:hash(text)});
function observation(id=1){return {root:path.resolve('watched'),event:{sessionId:'session-1',id,type:'modify',path:'AGENTS.md',timestamp:'2026-09-12T12:00:00.000Z',actor:'unknown'},before:present('before'),after:present('after')};}
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-review-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
test('immutable snapshots and decisions round-trip separately with normalized hashes',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();const input=observation();input.after=present('a\r\nb');const saved=store.capture(input);input.after.text='mutated caller';assert.equal(store.get('session-1:1'),null);assert.deepEqual(await saved,{key:'session-1:1',retained:true});
  assert.equal(store.get('session-1:1').after.text,'a\nb');assert.equal(store.get('session-1:1').after.textHash,hash('a\nb'));assert.equal(store.list()[0].after.text,undefined);
  const decision=await store.decide({key:'session-1:1',expectedRevision:0,decision:'acknowledged'});assert.equal(decision.decision.revision,1);
  await assert.rejects(store.decide({key:'session-1:1',expectedRevision:0,decision:'needs-attention'}),/changed/);await assert.rejects(store.capture(observation()),/immutable/);
  const copy=store.get('session-1:1');copy.after.text='external mutation';assert.equal(store.get(copy.key).after.text,'a\nb');await store.close();
  const restarted=new ContextReviewStore(directory);const loaded=await restarted.load();assert.equal(loaded.records[0].decision.value,'acknowledged');assert.equal(loaded.records[0].after.text,'a\nb');await restarted.close();
});
test('absent, unavailable, empty text and oversized sides stay distinct',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();
  const created=observation(1);created.event.type='create';created.before={state:'absent'};created.after=present('');await store.capture(created);
  const deleted=observation(2);deleted.event.type='delete';deleted.before={state:'unavailable',reason:'previous-snapshot-unavailable',rawHash:hash('unknown')};deleted.after={state:'absent'};await store.capture(deleted);
  const large=observation(3);large.after=present('x'.repeat(1024*1024+1));await store.capture(large);
  assert.equal(store.get('session-1:1').after.text,'');assert.equal(store.get('session-1:1').before.state,'absent');assert.equal(store.get('session-1:2').before.state,'unavailable');assert.equal(store.get('session-1:3').after.reason,'snapshot-size-limit');
  const wrong=observation(4);wrong.after={state:'absent'};await assert.rejects(store.capture(wrong),/Absent/);
  const partial=observation(5);partial.event.type='create';partial.before={state:'unavailable',reason:'session-boundary'};await store.capture(partial);assert.equal(store.get('session-1:5').before.state,'unavailable');await store.close();
});
test('coalescing, bounded admission, eviction and superseded decisions never falsely confirm a decision',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();let writes=0;const persist=store.persist.bind(store);store.persist=async raw=>{writes++;await persist(raw);};
  const jobs=Array.from({length:256},(_,i)=>store.capture(observation(i+1)));await assert.rejects(store.capture(observation(257)),/queue is full/);const results=await Promise.all(jobs);
  assert.equal(writes,1);assert.equal(store.list().length,128);assert.equal(store.status().evicted,128);assert.equal(results[0].retained,false);assert.equal(results.at(-1).retained,true);
  const first=store.decide({key:'session-1:256',expectedRevision:0,decision:'acknowledged'}),second=store.decide({key:'session-1:256',expectedRevision:1,decision:'needs-attention'});
  await assert.rejects(first,/superseded/);assert.equal((await second).decision.value,'needs-attention');await store.close();
});
test('serialized storage stays bounded even when JSON escaping expands snapshot text',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();
  for(let i=1;i<=6;i++){const entry=observation(i);entry.before=present('\n'.repeat(500000));entry.after=present('"'.repeat(500000));await store.capture(entry);}
  assert.ok((await fs.stat(store.file)).size<=MAX_BYTES);assert.ok(store.status().evicted>0);await store.close();
});
test('failed persistence leaves committed decisions unchanged and rejects dependent queued work',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();await store.capture(observation());const persist=store.persist.bind(store);let release;
  store.persist=()=>new Promise((resolve,reject)=>{release=()=>reject(new Error('injected disk failure'));});
  const first=store.decide({key:'session-1:1',expectedRevision:0,decision:'acknowledged'});await new Promise(resolve=>setImmediate(resolve));const second=store.capture(observation(2));release();
  await assert.rejects(first,/disk failure/);await assert.rejects(second,/disk failure/);assert.equal(store.get('session-1:1').decision.revision,0);assert.equal(store.get('session-1:2'),null);assert.match(store.status().warning,/not saved/);await assert.rejects(store.flush(),/not saved/);
  store.persist=persist;await store.decide({key:'session-1:1',expectedRevision:0,decision:'needs-attention'});assert.equal(store.status().warning,'');await store.close();
});
test('corruption recovery, forged checksummed schema rejection and exclusive profile ownership',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();assert.throws(()=>new ContextReviewStore(directory),/already owns/);await store.capture(observation());await store.decide({key:'session-1:1',expectedRevision:0,decision:'acknowledged'});await store.close();
  await fs.writeFile(path.join(directory,'context-review.json'),'corrupt');const restored=new ContextReviewStore(directory);const recovered=await restored.load();assert.equal(recovered.records[0].decision.revision,0);assert.ok(recovered.warning);await restored.capture(observation(2));await restored.close();
  const payload=JSON.stringify({records:[{...recovered.records[0],unexpected:'not allowed'}],evicted:0}),forged=JSON.stringify({version:1,payload,sha256:hash(payload)});
  for(const suffix of ['', '.bak'])await fs.writeFile(path.join(directory,'context-review.json'+suffix),forged);
  const invalid=new ContextReviewStore(directory);assert.equal((await invalid.load()).records.length,0);assert.ok(invalid.status().warning);assert.ok((await invalid.flush()).warning);await invalid.close();
  assert.equal(await fs.readFile(path.join(directory,'context-review.json'),'utf8'),forged);
});
test('failed primary replacement retains the prior durable decision and permits recovery',async t=>{
  const directory=await fixture(t),store=new ContextReviewStore(directory);await store.load();await store.capture(observation());
  const rename=fs.rename;fs.rename=async(source,target)=>{if(target===store.file)throw Object.assign(new Error('injected replacement failure'),{code:'EIO'});return rename(source,target);};
  try{await assert.rejects(store.decide({key:'session-1:1',expectedRevision:0,decision:'acknowledged'}),/replacement failure/);}finally{fs.rename=rename;}
  assert.equal(store.get('session-1:1').decision.revision,0);assert.equal((await fs.readdir(directory)).some(name=>name.includes('.tmp')),false);await assert.rejects(store.close(),/not saved/);
  const restarted=new ContextReviewStore(directory);assert.equal((await restarted.load()).records[0].decision.revision,0);await restarted.decide({key:'session-1:1',expectedRevision:0,decision:'needs-attention'});await restarted.close();
});
test('advisory fallback recovery permits flush and close without hiding its warning or rewriting history',async t=>{
  const directory=await fixture(t),original=new ContextReviewStore(directory);await original.load();await original.capture(observation());await original.decide({key:'session-1:1',expectedRevision:0,decision:'acknowledged'});await original.close();
  await fs.writeFile(path.join(directory,'context-review.json'),'corrupt primary');
  const recovered=new ContextReviewStore(directory),loaded=await recovered.load();assert.equal(loaded.records[0].decision.revision,0);assert.ok(loaded.warning);
  const status=await recovered.flush();assert.equal(status.warning,loaded.warning);await recovered.close();assert.equal(recovered.status().warning,loaded.warning);
  assert.equal(await fs.readFile(path.join(directory,'context-review.json'),'utf8'),'corrupt primary');
});
