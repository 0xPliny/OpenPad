const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {SessionStore} = require('../src/session.cjs');
const {decode,encode} = require('../src/files.cjs');
for (const encoding of ['utf8','utf16le','utf16be','windows1252']) for (const eol of ['LF','CRLF','CR']) test(`${encoding} / ${eol} round trip`,() => {
  const text = 'café €\nsecond\n';
  const bytes = encode(text,{encoding,eol,bom:encoding !== 'windows1252'});
  const doc = decode(bytes,encoding);
  assert.equal(doc.text,text); assert.deepEqual(encode(doc.text,doc),bytes);
});
test('mixed endings preserve exact bytes; line-count change requires explicit conversion',() => {
  const bytes = Buffer.from('one\r\ntwo\nthree\rfour'); const doc = decode(bytes);
  assert.equal(doc.eol,'Mixed'); assert.deepEqual(encode(doc.text,doc),bytes);
  assert.throws(() => encode(doc.text + '\nextra',doc),/Line count/);
  assert.equal(encode(doc.text,{...doc,eol:'LF'}).toString(),'one\ntwo\nthree\nfour');
});
test('unrepresentable encoding fails instead of replacing text with question marks',() => assert.throws(() => encode('世界',{encoding:'windows1252',eol:'LF'}),/cannot be represented/));
test('session writer serializes updates and falls back from corrupt latest generation',async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'openpad-recovery-'));
  try {
    const store = new SessionStore(dir);
    await Promise.all([store.save({docs:[{text:'first'}]}),store.save({docs:[{text:'second'}]})]);
    assert.equal((await store.load()).docs[0].text,'second');
    await fs.writeFile(path.join(dir,'session.json'),'broken');
    assert.equal((await store.load()).docs[0].text,'first');
    await store.save({docs:[{text:'third'}]});
    assert.equal((await store.load()).docs[0].text,'third');
    assert.equal(JSON.parse(JSON.parse(await fs.readFile(path.join(dir,'session.json.bak'),'utf8')).payload).docs[0].text,'first');
    for (const malformed of ['null','{"payload":null,"hash":"bad"}','{"payload":"{}","hash":"bad"}']) {
      await fs.writeFile(path.join(dir,'session.json'),malformed);
      assert.equal((await store.load()).docs[0].text,'first'); assert.ok(store.warning);
      await store.save({docs:[{text:'recovered'}]}); assert.equal((await store.load()).docs[0].text,'recovered');
    }
  } finally { await fs.rm(dir,{recursive:true}); }
});
test('folder worker reports skipped files and finds Unicode text',async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'openpad-search-'));
  try {
    await fs.writeFile(path.join(dir,'ok.txt'),'find 世界\nno\nfind');
    await fs.writeFile(path.join(dir,'binary.txt'),Buffer.from([0xff]));
    await fs.mkdir(path.join(dir,'node_modules')); await fs.writeFile(path.join(dir,'node_modules','skip.txt'),'find');
    const messages = await new Promise((resolve,reject) => { const worker = new Worker(path.resolve('src/search-worker.cjs'),{workerData:{root:dir,query:'find'}}); const results=[]; worker.on('message',m=>results.push(m)); worker.on('error',reject); worker.on('exit',code=>code ? reject(new Error(`worker exit ${code}`)) : resolve(results)); });
    assert.equal(messages.filter(m=>m.type==='match').length,2); const done=messages.at(-1); assert.equal(done.scanned,1); assert.equal(done.skipped,2); assert.equal(done.capped,false);
  } finally { await fs.rm(dir,{recursive:true}); }
});
test('pathological regex runs in a terminable worker',async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'openpad-cancel-'));
  try {
    await fs.writeFile(path.join(dir,'slow.txt'),'a'.repeat(100000)+'!');
    const worker = new Worker(path.resolve('src/search-worker.cjs'),{workerData:{root:dir,query:'(a+)+$',regex:true}});
    await new Promise((resolve,reject)=>{worker.on('message',message=>{if(message.type==='scanning-file') resolve();});worker.on('error',reject);});
    await new Promise(resolve=>setTimeout(resolve,100));
    const start=Date.now(); await worker.terminate(); assert.ok(Date.now()-start < 3000);
  } finally { await fs.rm(dir,{recursive:true}); }
});
