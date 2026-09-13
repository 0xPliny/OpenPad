const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ContextWatch}=require('../src/context-watch.cjs');
const {replaceFile}=require('../src/replace-file.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate){const end=Date.now()+6000;while(Date.now()<end){const value=predicate();if(value)return value;await sleep(30);}assert.fail('Timed out waiting for filesystem event');}
async function fixture(options={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-watch-'));const watch=new ContextWatch({debounceMs:30,...options});return {root,watch,async cleanup(){await watch.stop();await fs.rm(root,{recursive:true,force:true});}};}

test('real recursive events track atomic saves, creation, deletion and stop with metadata-only events',async()=>{
  const f=await fixture(),{root,watch}=f;try{
    const file=path.join(root,'AGENTS.md');await fs.writeFile(file,'one\n');await watch.start(root);assert.equal(watch.status().trackedFiles,1);assert.deepEqual(watch.getEvents(),[]);
    // Exercise observation after atomic replacement; transient Windows sharing errors belong to the writer's retry policy.
    await fs.writeFile(path.join(root,'temp.swap'),'one\ntwo\n');await replaceFile(path.join(root,'temp.swap'),file);
    const edit=await waitFor(()=>watch.getEvents().find(e=>e.type==='modify'));assert.equal(edit.path,'AGENTS.md');assert.equal(edit.byteDelta,4);assert.equal(edit.lineDelta,1);assert.equal(edit.actor,'unknown');assert.ok(edit.timestamp);assert.equal(edit.sessionId,watch.status().sessionId);
    await fs.mkdir(path.join(root,'new'));await fs.writeFile(path.join(root,'new','context.md'),'hello');await waitFor(()=>watch.getEvents().some(e=>e.type==='create'&&e.path==='new/context.md'));
    await fs.rm(path.join(root,'new'),{recursive:true});await waitFor(()=>watch.getEvents().some(e=>e.type==='delete'&&e.path==='new/context.md'));
    const metadata=[...watch.entries.values()][0];assert.deepEqual(Object.keys(metadata).sort(),['bytes','hash','lines','path']);
    assert.equal(await watch.hasPath(file),true);assert.equal(await watch.hasPath(path.join(root,'missing.md')),false);
    const oldSession=watch.status().sessionId;assert.notEqual(watch.newSession('Agent session'),oldSession);assert.equal(watch.status().sessionLabel,'Agent session');assert.deepEqual(watch.getEvents(),[]);
    await watch.stop();await fs.appendFile(file,'ignored');await sleep(180);assert.deepEqual(watch.getEvents(),[]);assert.equal(watch.status().running,false);
  }finally{await f.cleanup();}
});

test('observed line spans trim matching edges, flag grouped changes and anchor deletions',async()=>{
  const f=await fixture();try{
    const file=path.join(f.root,'AGENTS.md');await fs.writeFile(file,'head\r\none\r\nmiddle\r\ntwo\r\ntail');await f.watch.start(f.root);
    await fs.writeFile(file,'head\r\nONE\r\nmiddle\r\nTWO\r\ntail');
    const changed=await waitFor(()=>f.watch.getEvents().find(e=>e.type==='modify'));
    assert.deepEqual(changed.ranges,{before:{fromLine:2,toLine:5},after:{fromLine:2,toLine:5},deletionAnchor:null,approximate:true});assert.equal(changed.rangeReason,null);
    assert.equal(changed.afterTextHash,require('node:crypto').createHash('sha256').update('head\nONE\nmiddle\nTWO\ntail').digest('hex'));
    await waitFor(()=>!f.watch.status().busy&&!f.watch.status().queuedPaths);
    const returned=await f.watch.latestObservation(file);assert.equal(returned.id,changed.id);returned.ranges.before.fromLine=100;assert.equal((await f.watch.latestObservation(file)).ranges.before.fromLine,2);
    f.watch.enqueue('AGENTS.md');assert.equal(await f.watch.latestObservation(file),null);await waitFor(()=>!f.watch.status().busy&&!f.watch.status().queuedPaths);assert.equal((await f.watch.latestObservation(file)).id,changed.id);
    await fs.writeFile(file,'head\ntail');const removed=await waitFor(()=>f.watch.getEvents().find(e=>e.id>changed.id&&e.type==='modify'));
    assert.deepEqual(removed.ranges,{before:{fromLine:2,toLine:5},after:{fromLine:2,toLine:2},deletionAnchor:2,approximate:false});
    f.watch.newSession('Next');assert.equal(await f.watch.latestObservation(file),null);await fs.writeFile(file,'HEAD\ntail');const boundary=await waitFor(()=>f.watch.getEvents().find(e=>e.type==='modify'));assert.equal(boundary.ranges,null);assert.equal(boundary.rangeReason,'previous-snapshot-unavailable');
    await fs.writeFile(file,'HEAD\nTAIL');const next=await waitFor(()=>f.watch.getEvents().find(e=>e.id>boundary.id&&e.type==='modify'));assert.equal(next.ranges.after.fromLine,2);assert.equal(next.ranges.after.toLine,3);
  }finally{await f.cleanup();}
});

test('snapshot budget, oversize gaps and byte-only changes never fabricate changed lines',async()=>{
  const f=await fixture({maxSnapshotBytes:12,maxFileBytes:20});try{
    const a=path.join(f.root,'a.md'),b=path.join(f.root,'b.md');await fs.writeFile(a,'aa\nb');await f.watch.start(f.root);assert.equal(f.watch.status().snapshotBytes,8);
    await fs.writeFile(b,'cc\nd');await waitFor(()=>f.watch.getEvents().some(e=>e.type==='create'));assert.equal(f.watch.status().snapshotFiles,1);assert.equal(f.watch.status().snapshotBytes,8);assert.equal(f.watch.status().snapshotEvictions,1);
    await fs.writeFile(a,'AA\nb');const missing=await waitFor(()=>f.watch.getEvents().find(e=>e.type==='modify'&&e.path==='a.md'));assert.equal(missing.ranges,null);assert.equal(missing.rangeReason,'previous-snapshot-unavailable');
    await fs.writeFile(a,'A'.repeat(21));await waitFor(()=>f.watch.getEvents().some(e=>e.path==='a.md'&&e.code==='oversize'));assert.equal(await f.watch.latestObservation(a),null);
    await fs.writeFile(a,'AA\nb');await waitFor(()=>!f.watch.status().busy&&!f.watch.status().queuedPaths);await sleep(100);
    await fs.writeFile(a,Buffer.from('\ufeffAA\r\nb'));const bytesOnly=await waitFor(()=>f.watch.getEvents().find(e=>e.id>missing.id&&e.type==='modify'&&e.path==='a.md'));assert.equal(bytesOnly.ranges,null);assert.equal(bytesOnly.rangeReason,'no-text-change');
    assert.ok(f.watch.status().snapshotBytes<=12);await f.watch.stop();assert.equal(f.watch.status().snapshotBytes,0);assert.equal(await f.watch.latestObservation(a),null);
  }finally{await f.cleanup();}
});

test('an event queued during a controlled read hides provenance until the newest read drains',async t=>{
  const f=await fixture();let release;
  try{
    const file=path.join(f.root,'AGENTS.md');await fs.writeFile(file,'before');await f.watch.start(f.root);
    await fs.writeFile(file,'first');await waitFor(()=>f.watch.getEvents().some(e=>e.type==='modify'));await waitFor(()=>!f.watch.status().busy&&!f.watch.status().queuedPaths);
    const first=await f.watch.latestObservation(file);assert.ok(first);
    const open=fs.open;let intercepted=false,entered;
    const reading=new Promise(resolve=>{entered=resolve;});
    t.mock.method(fs,'open',async(...args)=>{
      const handle=await open(...args);
      if(args[1]==='r'&&path.basename(String(args[0]))==='AGENTS.md'&&!intercepted){
        intercepted=true;const read=handle.read.bind(handle);
        handle.read=async(...readArgs)=>{await new Promise(resolve=>{release=resolve;entered();});handle.read=read;return read(...readArgs);};
      }
      return handle;
    });
    f.watch.enqueue('AGENTS.md');await reading;
    f.watch.enqueue('AGENTS.md');assert.equal(f.watch.status().busy,true);assert.equal(f.watch.status().queuedPaths,1);assert.equal(await f.watch.latestObservation(file),null);
    // A different disk version lands while the first read is blocked; its consistency check may reject it.
    await fs.writeFile(file,'newest validated content');release();release=null;
    await waitFor(()=>!f.watch.status().busy&&!f.watch.status().queuedPaths);
    const newest=await f.watch.latestObservation(file);assert.ok(newest);assert.equal(newest.afterTextHash,require('node:crypto').createHash('sha256').update('newest validated content').digest('hex'));assert.notEqual(newest.id,first.id);
  }finally{release?.();t.mock.restoreAll();await f.cleanup();}
});

test('filters exclude secrets, generated directories and escaped symlinks while reporting oversized files',async()=>{
  const f=await fixture({maxFileBytes:20}),outside=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-outside-'));try{
    for(const name of ['node_modules','.git','secrets','skip']){await fs.mkdir(path.join(f.root,name));await fs.writeFile(path.join(f.root,name,'hidden.md'),'hidden');}
    await fs.writeFile(path.join(outside,'escape.md'),'outside');await fs.symlink(outside,path.join(f.root,'linked'),process.platform==='win32'?'junction':'dir');
    await fs.writeFile(path.join(f.root,'large.md'),'a'.repeat(21));await fs.writeFile(path.join(f.root,'allowed.md'),'yes');await fs.writeFile(path.join(f.root,'.env.md'),'secret');
    await f.watch.start(f.root,{exclude:['skip/**']});assert.equal(f.watch.status().trackedFiles,1);assert.equal(f.watch.status().complete,false);assert.ok(f.watch.getEvents().some(e=>e.code==='oversize'));assert.ok(f.watch.getEvents().some(e=>e.path==='linked'&&e.type==='issue'));
    const before=f.watch.getEvents().length;await fs.writeFile(path.join(outside,'new.md'),'escaped');await fs.appendFile(path.join(f.root,'secrets','hidden.md'),'secret');await sleep(180);assert.equal(f.watch.getEvents().length,before);
    await assert.rejects(f.watch.safe('../'+path.basename(outside)+'/escape.md'),/leaves watched root/);
  }finally{await f.cleanup();await fs.rm(outside,{recursive:true,force:true});}
});

test('bounded event history, queue and baseline limits are visible',async()=>{
  const notified=[],f=await fixture({maxEvents:2,maxFiles:1,maxQueue:1,onEvent:event=>notified.push(event)});try{
    await fs.writeFile(path.join(f.root,'a.md'),'a');await fs.writeFile(path.join(f.root,'b.md'),'b');await f.watch.start(f.root);assert.equal(f.watch.status().trackedFiles,1);assert.ok(f.watch.status().overflows);
    f.watch.enqueue('one.md');f.watch.enqueue('two.md');assert.ok(f.watch.getEvents().some(e=>e.code==='overflow'&&e.path==='two.md'));
    await waitFor(()=>!f.watch.status().queuedPaths&&!f.watch.status().busy);
    for(let i=0;i<3;i++){await fs.writeFile(path.join(f.root,'a.md'),'a'.repeat(i+2));await waitFor(()=>f.watch.getEvents().some(e=>e.type==='modify'&&e.bytes===i+2));}
    assert.equal(f.watch.getEvents().length,2);assert.ok(f.watch.status().droppedEvents>0);assert.ok(notified.length>2);assert.equal(f.watch.getEvents({after:f.watch.getEvents().at(-1).id}).length,0);
  }finally{await f.cleanup();}
});

test('create and delete deltas, UTF-8 rejection and watch-root identity replacement are reported',async()=>{
  const f=await fixture();try{
    await f.watch.start(f.root);const file=path.join(f.root,'new.md');await fs.writeFile(file,'hi\r\nthere');const created=await waitFor(()=>f.watch.getEvents().find(e=>e.type==='create'));assert.equal(created.byteDelta,9);assert.equal(created.lineDelta,2);
    await fs.unlink(file);const deleted=await waitFor(()=>f.watch.getEvents().find(e=>e.type==='delete'));assert.equal(deleted.byteDelta,-9);assert.equal(deleted.lineDelta,-2);
    await fs.writeFile(path.join(f.root,'invalid.md'),Buffer.from([255]));await waitFor(()=>f.watch.getEvents().some(e=>e.type==='issue'&&e.path==='invalid.md'));
    assert.throws(()=>f.watch.relative(path.join(f.root,'..','outside.md')),/leaves watched root/);
    f.watch.rootIdentity='replaced';await assert.rejects(f.watch.safe('invalid.md'),/root identity changed/);
  }finally{await f.cleanup();}
});

test('baseline byte and traversal caps cannot report complete coverage',async()=>{
  for(const options of [{maxScanBytes:3},{maxScanEntries:1}]){
    const f=await fixture(options);try{await fs.writeFile(path.join(f.root,'a.md'),'four');await f.watch.start(f.root);assert.equal(f.watch.status().complete,false);assert.ok(f.watch.getEvents().some(e=>e.code==='overflow'));assert.equal(f.watch.status().trackedFiles,0);}finally{await f.cleanup();}
  }
});

test('review callback captures immutable before/after text without adding content to activity events',async()=>{
  const observed=[],f=await fixture({onObservation:value=>observed.push(value)});try{
    const file=path.join(f.root,'AGENTS.md');await fs.writeFile(file,'private before\r\n');await f.watch.start(f.root);
    await fs.writeFile(file,'private after\r\n');await waitFor(()=>observed.length===1);
    assert.equal(observed[0].before.text,'private before\n');assert.equal(observed[0].after.text,'private after\n');assert.equal(observed[0].event.actor,'unknown');
    assert.equal(JSON.stringify(f.watch.getEvents()).includes('private'),false);
    await fs.unlink(file);await waitFor(()=>observed.length===2);assert.equal(observed[1].before.text,'private after\n');assert.deepEqual(observed[1].after,{state:'absent'});
    await fs.writeFile(file,'');await waitFor(()=>observed.length===3);assert.deepEqual(observed[2].before,{state:'absent'});assert.equal(observed[2].after.state,'present');assert.equal(observed[2].after.text,'');
    f.watch.newSession();await fs.writeFile(file,'after boundary');await waitFor(()=>observed.length===4);assert.equal(observed[3].before.state,'unavailable');assert.equal(observed[3].after.text,'after boundary');
  }finally{await f.cleanup();}
});
