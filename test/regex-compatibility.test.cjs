const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const corpus=require('./fixtures/regex-compatibility.json');
const {scanMatches}=require('../src/search-model.cjs');
const {replacements}=require('../src/replacement-model.cjs');
const {preview}=require('../src/replacement-worker.cjs');

function workerSearch(options){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'../src/search-worker.cjs'),{workerData:options}),messages=[];
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Corpus search worker exceeded 5 seconds'));},5000);
    worker.on('message',message=>messages.push(message));worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('exit',code=>{clearTimeout(timer);code?reject(new Error(`Worker exit ${code}`)):resolve(messages);});
  });
}
function checkSearch(messages,expected,type,offset=0){
  if(expected.error){assert.equal(messages.at(-1)?.type,'error');assert.equal(messages.some(message=>message.type===type),false);return;}
  assert.equal(messages.at(-1)?.type,'done');assert.equal(messages.at(-1).skipped,0);assert.equal(messages.at(-1).capped,false);
  assert.deepEqual(messages.filter(message=>message.type===type).map(({from,to})=>[from-offset,to-offset]),expected.spans);
}
function checkPreview(plan,expected,before){
  assert.equal(plan.capped,false);assert.deepEqual(plan.skipped,[]);
  assert.equal(plan.entries.length,expected.after===before?0:1);
  assert.equal(plan.entries[0]?.after??before,expected.after);
}
test('regex corpus provenance distinguishes documentation from actual comparator observations',()=>{
  assert.equal(corpus.notepadObservation.status,'NOT_RUN');assert.equal(corpus.notepadObservation.version,null);
  assert.equal(new Set(corpus.cases.map(value=>value.id)).size,corpus.cases.length);
  for(const value of corpus.cases){assert.ok(value.boost.source.startsWith('https://'));assert.ok(['DOCUMENTED_NOT_EXECUTED','UNVERIFIED'].includes(value.boost.status));}
});
for(const fixture of corpus.cases)test(`regex migration: ${fixture.id}`,async()=>{
  const {input,options,expected}=fixture;
  if(expected.error){assert.throws(()=>scanMatches(input,options,1000,()=>{}),{name:expected.error});assert.throws(()=>replacements(input,options),{name:expected.error});}
  else{
    const spans=[];const count=scanMatches(input,options,1000,match=>spans.push([match.from,match.to]));assert.deepEqual(spans,expected.spans);assert.equal(count,spans.length);
    const result=replacements(input,options);assert.equal(result.after,expected.after);assert.equal(result.count,expected.spans.length);
  }
  const messages=await workerSearch({...options,buffers:[{id:'fixture',name:'Fixture',text:input,from:10}]});checkSearch(messages,expected,'buffer-match',10);
  if(expected.error)await assert.rejects(preview({buffers:[{id:'fixture',text:input}],options}),{name:expected.error});
  else checkPreview(await preview({buffers:[{id:'fixture',text:input}],options}),expected,input);
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpad-regex-corpus-'))),file=path.join(root,'fixture.txt');
  try{
    await fs.writeFile(file,input,'utf8');const diskExpected=fixture.diskExpected??expected,normalized=input.replace(/\r\n?/g,'\n');
    checkSearch(await workerSearch({...options,root}),diskExpected,'match');
    if(diskExpected.error)await assert.rejects(preview({root,options}),{name:diskExpected.error});
    else checkPreview(await preview({root,options}),diskExpected,normalized);
    assert.equal(await fs.readFile(file,'utf8'),input);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('corpus pathological expression remains cancellable in the actual search worker',async()=>{
  const worker=new Worker(path.join(__dirname,'../src/search-worker.cjs'),{workerData:{query:'(a+)+$',regex:true,buffers:[{id:'slow',text:'a'.repeat(100000)+'!'}]}});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker did not reach buffer scan')),5000);worker.on('message',message=>{if(message.type==='scanning-file'){clearTimeout(timer);resolve();}});worker.once('error',error=>{clearTimeout(timer);reject(error);});});
    await new Promise(resolve=>setTimeout(resolve,30));const start=Date.now();await worker.terminate();assert.ok(Date.now()-start<3000);
  }finally{await worker.terminate();}
});
