const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {findLiteral}=require('../src/large-search-worker.cjs');const {LargeSearchRunner}=require('../src/large-search-runner.cjs');const {readPage,pageBytes}=require('../src/large-file.cjs');
test('whole-file UTF-8 search crosses chunks without duplicated overlapping matches and rejects stale navigation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-full-search-')),file=path.join(root,'file.txt');
  try{
    await fs.writeFile(file,'.'.repeat(65534)+'😀 needle END');const found=await findLiteral(file,'😀 needle');assert.deepEqual(found.matches,[{from:65534,to:65545}]);assert.equal(found.capped,false);assert.ok((await readPage(file,65534,pageBytes,found.version)).text.startsWith('😀 needle'));
    await fs.appendFile(file,'changed');await assert.rejects(readPage(file,65534,pageBytes,found.version),/stale/);
    await fs.writeFile(file,'.'.repeat(65533)+'aaaaa');assert.deepEqual((await findLiteral(file,'aaa')).matches,[{from:65533,to:65536}]);
    assert.equal((await findLiteral(file,'A')).matches.length,0);await assert.rejects(findLiteral(file,'\ud800'),/Unicode/);await assert.rejects(findLiteral(file,''),/Unicode/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('whole-file search reports match caps and empty-file completion',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-search-cap-')),file=path.join(root,'file.txt');
  try{await fs.writeFile(file,'x'.repeat(2000));const result=await findLiteral(file,'x');assert.equal(result.matches.length,1000);assert.equal(result.capped,true);await fs.writeFile(file,'');const empty=await findLiteral(file,'x');assert.equal(empty.matches.length,0);assert.equal(empty.bytesRead,0);assert.equal(empty.capped,false);}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('whole-file worker cancels after progress and restarts; timeout returns no partial results',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-search-cancel-')),file=path.join(root,'file.txt'),runner=new LargeSearchRunner();const handle=await fs.open(file,'w');await handle.truncate(64*1024*1024);await handle.close();
  try{
    let progress=0;const pending=runner.run({id:1,previewId:'test',file,query:'unmatched'},message=>{progress=message.bytesRead;runner.cancel(1);});runner.cancel(0);assert.equal(runner.job.id,1);assert.deepEqual(await pending,{cancelled:true});assert.ok(progress>=4*1024*1024);
    await fs.writeFile(file,'abc');assert.deepEqual((await runner.run({id:2,previewId:'test',file,query:'b'})).result.matches,[{from:1,to:2}]);
    const timeout=new LargeSearchRunner(1);const result=await timeout.run({id:3,file,query:'b'});assert.match(result.error,/exceeded/);assert.equal(result.result,undefined);
  }finally{runner.cancel();await fs.rm(root,{recursive:true,force:true});}
});

test('whole-file search rejects content changed during IO',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-search-race-')),file=path.join(root,'file.txt');await fs.writeFile(file,'abc');const open=fs.open;
  t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args),read=handle.read.bind(handle);handle.read=async(...args)=>{const result=await read(...args);await fs.appendFile(file,'changed');return result;};return handle;});
  try{await assert.rejects(findLiteral(file,'b'),/changed/);}finally{t.mock.restoreAll();await fs.rm(root,{recursive:true,force:true});}
});
