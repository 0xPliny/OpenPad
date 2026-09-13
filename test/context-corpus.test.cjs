const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ContextCorpusRunner}=require('../src/context-corpus-runner.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-corpus-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('exact independent reference counts, sorted per-file budgets and literal special tokens',async t=>{
  const root=await fixture(t),runner=new ContextCorpusRunner();t.after(()=>runner.close());
  await fs.writeFile(path.join(root,'one.md'),'antidisestablishmentarianism');await fs.writeFile(path.join(root,'two.md'),'2 + 2 = 4');
  let progress=0;for(const tokenizer of ['o200k_base','cl100k_base']){const result=await runner.run({requestId:1,root,tokenizer},()=>progress++);assert.equal(result.error,undefined);assert.equal(result.total,13);assert.equal(result.files[0].tokens,7);assert.equal(result.files[1].tokens,6);assert.equal(result.incomplete,false);assert.match(result.files[0].hash,/^[a-f0-9]{64}$/);}
  assert.ok(progress);await fs.writeFile(path.join(root,'special.md'),'<|endoftext|>');const result=await runner.run({requestId:2,root,tokenizer:'cl100k_base'});assert.equal(result.files.find(f=>f.path==='special.md').tokens,7);
});
test('scope excludes secrets, generated folders and escaped links; oversized and invalid UTF8 files are explicit',async t=>{
  const root=await fixture(t),outside=await fixture(t),runner=new ContextCorpusRunner();t.after(()=>runner.close());
  await fs.writeFile(path.join(root,'good.md'),'abcd');await fs.writeFile(path.join(root,'bad.md'),Buffer.from([0xff]));await fs.writeFile(path.join(root,'big.md'),Buffer.alloc(1024*1024+1));
  for(const name of ['.env','node_modules','secrets','old-ID_RSA-backup']){await fs.mkdir(path.join(root,name));await fs.writeFile(path.join(root,name,'hidden.md'),'secret');}
  await fs.writeFile(path.join(root,'id_rsa.md'),'synthetic excluded text');await fs.writeFile(path.join(root,'backup-ID_RSA.md'),'synthetic excluded text');
  await fs.writeFile(path.join(outside,'escape.md'),'secret');await fs.symlink(outside,path.join(root,'escape'),process.platform==='win32'?'junction':'dir');
  const result=await runner.run({requestId:1,root,tokenizer:'chars4'});assert.deepEqual(result.files.map(f=>f.path),['good.md']);assert.equal(result.total,1);assert.equal(result.approximate,true);assert.equal(result.incomplete,true);assert.ok(result.skipped.some(s=>s.path==='escape'&&/links/.test(s.reason)));assert.ok(result.skipped.some(s=>s.path==='big.md'&&/1 MiB/.test(s.reason)));assert.ok(result.skipped.some(s=>s.path==='bad.md'));
});
test('cancel, latest-wins, invalid request, closed runner and timeout return structured outcomes',async t=>{
  const root=await fixture(t),runner=new ContextCorpusRunner();t.after(()=>runner.close());await fs.writeFile(path.join(root,'one.md'),'hello');
  const first=runner.run({requestId:1,root});const second=runner.run({requestId:2,root,tokenizer:'chars4'});assert.equal((await first).cancelled,true);assert.equal((await second).total,2);
  const third=runner.run({requestId:3,root});assert.equal(runner.cancel(99),false);assert.equal(runner.cancel(3),true);assert.equal((await third).cancelled,true);
  assert.ok((await runner.run({requestId:4,root,include:['../*']})).error);runner.close();assert.ok((await runner.run({requestId:5,root})).error);
  const timeout=new ContextCorpusRunner(1);t.after(()=>timeout.close());assert.match((await timeout.run({requestId:1,root})).error,/time limit/);
});
test('raw disk hash and normalized decoded buffer hash preserve their distinct identities',async t=>{
  const {createHash}=require('node:crypto'),root=await fixture(t),runner=new ContextCorpusRunner();t.after(()=>runner.close());
  const bytes=Buffer.from('\uFEFFa\r\nb\r');await fs.writeFile(path.join(root,'bom.md'),bytes);
  const result=await runner.run({requestId:1,root,tokenizer:'chars4'}),file=result.files[0];
  assert.equal(file.hash,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(file.normalizedTextHash,createHash('sha256').update('a\nb\n').digest('hex'));
  assert.equal(file.bytes,bytes.length);assert.equal(file.lines,3);assert.equal(file.tokens,2);
});
test('root replacement during scan cannot certify the original corpus',async t=>{
  const parent=await fixture(t),root=path.join(parent,'root'),moved=path.join(parent,'old');await fs.mkdir(root);
  for(let i=0;i<100;i++)await fs.writeFile(path.join(root,`${i}.md`),'hello');
  const runner=new ContextCorpusRunner();t.after(()=>runner.close());let changed=false;
  const result=await runner.run({requestId:1,root,tokenizer:'chars4'},()=>{if(!changed){sync.renameSync(root,moved);sync.mkdirSync(root);changed=true;}});
  assert.equal(changed,true);assert.equal(result.incomplete,true);assert.match(result.error||result.skipped.map(s=>s.reason).join(' '),/root identity changed/);
});
