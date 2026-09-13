const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {ContextCorpusSession}=require('../src/context-corpus-session.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-corpus-session-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const session=new ContextCorpusSession();t.after(()=>session.close());return {root,session};}
test('scan uses stored native scope and reopen returns normalized verified snapshot',async t=>{
  const {root,session}=await fixture(t),file=path.join(root,'one.md');await fs.writeFile(file,'\uFEFFa\r\nb');
  assert.ok((await session.run({requestId:0})).error);await session.setScope(root,{include:['**/*.md'],exclude:[]});
  const result=await session.run({requestId:1,root:path.dirname(root),include:['**/*'],tokenizer:'chars4'});assert.equal(result.files.length,1);assert.equal(result.root,await fs.realpath(root));
  const opened=await session.open({requestId:1,path:'one.md'});assert.equal(opened.corpusText,'a\nb');assert.equal(opened.bom,true);assert.equal(opened.hash,result.files[0].hash);
  await assert.rejects(session.open({requestId:1,path:'../one.md'}),/no longer available/);
  await fs.writeFile(file,'\uFEFFx\r\nb');await assert.rejects(session.open({requestId:1,path:'one.md'}),/changed/);
});
test('scope invalidation and superseding scans reject old open requests',async t=>{
  const {root,session}=await fixture(t);await fs.writeFile(path.join(root,'one.md'),'hello');await session.setScope(root);
  const first=session.run({requestId:1});session.invalidate();assert.equal((await first).cancelled,true);
  await session.setScope(root);await session.run({requestId:2,tokenizer:'chars4'});await session.run({requestId:3,tokenizer:'chars4'});await assert.rejects(session.open({requestId:2,path:'one.md'}),/no longer available/);
  assert.equal(session.cancel(2),false);assert.equal((await session.open({requestId:3,path:'one.md'})).text,'hello');session.cancel(3);await assert.rejects(session.open({requestId:3,path:'one.md'}),/no longer available/);
});
test('reopen rejects ancestor link escape, root replacement and oversize replacement',async t=>{
  const {root,session}=await fixture(t),nested=path.join(root,'nested');await fs.mkdir(nested);await fs.writeFile(path.join(nested,'one.md'),'hello');await session.setScope(root);await session.run({requestId:1,tokenizer:'chars4'});
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-corpus-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'one.md'),'hello');await fs.rename(nested,path.join(root,'old'));await fs.symlink(outside,nested,process.platform==='win32'?'junction':'dir');
  await assert.rejects(session.open({requestId:1,path:'nested/one.md'}),/symbolic link/);
  await session.run({requestId:2,tokenizer:'chars4'});await fs.writeFile(path.join(root,'old','one.md'),Buffer.alloc(1024*1024+1));await assert.rejects(session.open({requestId:2,path:'old/one.md'}),/changed/);
  const moved=root+'-moved';t.after(()=>fs.rm(moved,{recursive:true,force:true}));await fs.rename(root,moved);await fs.mkdir(root);await assert.rejects(session.open({requestId:2,path:'old/one.md'}),/root changed/);
  assert.match((await session.run({requestId:3,tokenizer:'chars4'})).error,/root changed/);
});
