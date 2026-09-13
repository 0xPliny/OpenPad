const test=require('node:test');
const assert=require('node:assert/strict');
const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {scanMatches}=require('../src/search-model.cjs');
test('search finds all occurrences, multiline/zero-width regex and Unicode whole words',()=>{
  const run=(text,options)=>{const matches=[];scanMatches(text,options,1000,m=>matches.push(m));return matches;};
  assert.deepEqual(run('one one\none',{query:'one'}).map(m=>[m.line,m.column]),[[1,1],[1,5],[2,1]]);
  assert.deepEqual(run('a\nb\nc',{query:'a\\nb',regex:true}).map(m=>[m.from,m.to]),[[0,3]]);
  assert.deepEqual(run('😀\nx',{query:'^',regex:true}).map(m=>m.from),[0,3]);
  assert.equal(run('cat cats écat caté 😀cat',{query:'cat',wholeWord:true}).length,2);
  assert.equal(run('a\nb',{query:'a.b',regex:true,dotAll:true}).length,1);
});
test('buffer worker uses snapshot offsets and can be cancelled during pathological regex',async()=>{
  const run=options=>new Promise((resolve,reject)=>{const worker=new Worker(path.resolve('src/search-worker.cjs'),{workerData:options}),messages=[];worker.on('message',m=>messages.push(m));worker.on('error',reject);worker.on('exit',code=>code?reject(new Error(`exit ${code}`)):resolve(messages));});
  const messages=await run({query:'a+',regex:true,buffers:[{id:'one',name:'One',text:'aa bb a',from:10}]});
  assert.deepEqual(messages.filter(m=>m.type==='buffer-match').map(m=>[m.from,m.to]),[[10,12],[16,17]]);assert.equal(messages.at(-1).scope,'buffers');
  const worker=new Worker(path.resolve('src/search-worker.cjs'),{workerData:{query:'(a+)+$',regex:true,buffers:[{id:'slow',text:'a'.repeat(100000)+'!',from:0}]}});
  await new Promise((resolve,reject)=>{worker.on('message',m=>{if(m.type==='scanning-file')resolve();});worker.on('error',reject);});await new Promise(resolve=>setTimeout(resolve,100));const start=Date.now();await worker.terminate();assert.ok(Date.now()-start<3000);
});
