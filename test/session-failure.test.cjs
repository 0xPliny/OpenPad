const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {SessionStore}=require('../src/session.cjs'),{hash}=require('../src/files.cjs');
const {fork}=require('node:child_process');
test('a structurally invalid primary cannot replace a valid backup when next commit fails',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-session-failure-')),store=new SessionStore(root);const rename=fs.rename;
  try{
    await store.save({docs:[{text:'recover me'}]});await store.save({docs:[{text:'latest'}]});
    const payload=JSON.stringify({version:1,docs:null});await fs.writeFile(store.file,JSON.stringify({payload,hash:hash(Buffer.from(payload))}));
    fs.rename=async(from,to)=>{if(to===store.file)throw Object.assign(new Error('injected commit failure'),{code:'EIO'});return rename(from,to);};
    await assert.rejects(store.save({docs:[{text:'next'}]}),/injected/);fs.rename=rename;
    assert.equal((await store.load()).docs[0]?.text,'recover me');assert.equal((await fs.readdir(root)).some(name=>name.endsWith('.tmp')),false);
    await store.save({docs:[{text:'recovered write'}]});assert.equal((await store.load()).docs[0].text,'recovered write');
  }finally{fs.rename=rename;await fs.rm(root,{recursive:true,force:true});}
});
test('abrupt process stops at each snapshot promotion stage retain a complete generation',async t=>{
  for(const phase of ['temp-synced','backup-synced','backup-promoted','before-primary','primary-promoted'])await t.test(phase,async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-session-crash-')),store=new SessionStore(root);let child;
    try{
      await store.save({docs:[{text:'older generation'}]});await store.save({docs:[{text:'last committed'}]});
      child=fork(path.join(__dirname,'session-crash-helper.cjs'),[root,phase],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
      await new Promise((resolve,reject)=>{let reached=false,errors='';const timeout=setTimeout(()=>{child.kill();reject(new Error(`Crash phase not reached: ${phase}; ${errors}`));},10000);child.stderr.on('data',chunk=>errors+=chunk);child.on('message',message=>{if(message.phase===phase){reached=true;child.kill();}});child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reached?resolve():reject(new Error(`Worker exited before ${phase}: ${errors}`));});});
      assert.equal((await store.load()).docs[0].text,phase==='primary-promoted'?'next generation':'last committed');
      await fs.writeFile(store.file,'corrupt primary');assert.equal((await store.load()).docs[0].text,['temp-synced','backup-synced'].includes(phase)?'older generation':'last committed');
    }finally{if(child?.exitCode===null&&!child.killed)child.kill();await fs.rm(root,{recursive:true,force:true});}
  });
});
test('renderer-invalid metadata is rejected before snapshot promotion',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-session-shape-')),store=new SessionStore(root);
  try{await store.save({docs:[{text:'valid'}]});for(const patch of [{saved:42},{path:42},{name:42},{selection:-1},{bookmarks:{}},{language:{}}])await assert.rejects(store.save({docs:[{text:'invalid',...patch}]}),/Invalid recovery/);await assert.rejects(store.save({docs:[{text:'invalid',group:'work'}],settings:{collapsedGroups:null}}),/Invalid recovery/);assert.equal((await store.load()).docs[0].text,'valid');}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('ambiguous file identities and invalid workspace names cannot become recovery generations',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-session-identity-')),store=new SessionStore(root);
  try{
    await store.save({docs:[{id:'good',text:'retained'}]});
    for(const docs of [[{id:'duplicate',text:'one'},{id:'duplicate',text:'two'}],[{id:'',text:'empty ID'}],[{path:'C:\\example.txt',text:'missing ID'}]])await assert.rejects(store.save({docs}),/Invalid recovery/);
    await assert.rejects(store.save({name:42,docs:[]}),/Invalid recovery/);
    assert.equal((await store.load()).docs[0].text,'retained');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
