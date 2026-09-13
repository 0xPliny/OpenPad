const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {replacements} = require('../src/replacement-model.cjs');
const {preview} = require('../src/replacement-worker.cjs');
const {applyFiles} = require('../src/replacement-files.cjs');
const {encode,writeDocument} = require('../src/files.cjs');
test('replacement captures match JavaScript semantics including empty and Unicode matches',()=>{
  const text='aa 12\n😀 42';
  for(const query of ['(?<number>\\d+)', '^', '(?=😀)', 'a*', '(a)(a)', '(\\d)(\\d)']){
    const replacement='$<number>:$1:$2:$12:$$:$&';
    assert.equal(replacements(text,{query,replacement,regex:true}).after,text.replace(new RegExp(query,'gmu'),replacement));
  }
  assert.equal(replacements('red\nblue',{query:'red\nblue',replacement:'$1'}).after,'$1');
  assert.equal(replacements('Cat cat cats écat caté cat_ 😀cat',{query:'cat',replacement:'X',wholeWord:true,caseSensitive:false}).after,'X X cats écat caté cat_ 😀X');
  assert.equal(replacements('a\nb',{query:'a.b',replacement:'x',regex:true,dotAll:true}).after,'x');
  assert.throws(()=>replacements('a',{query:'[',regex:true}));
  assert.throws(()=>replacements('a'.repeat(100001),{query:'a',replacement:'x'}),/100,000/);
});
test('folder replacement preserves bytes, skips open files, and preflights every selected file',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpad-batch-')));
  try{
    const folder=path.join(root,'files');await fs.mkdir(folder);
    const original=new Map();
    for(const [name,meta,text] of [
      ['utf8.txt',{encoding:'utf8',eol:'CRLF',bom:true},'old\nold'],
      ['le.txt',{encoding:'utf16le',eol:'CR',bom:true},'old\nold'],
      ['be.txt',{encoding:'utf16be',eol:'LF',bom:true},'old\nold'],
      ['mixed.txt',{encoding:'utf8',eol:'Mixed',originalEndings:['\r\n','\n'],bom:false},'old\nold\n'],
      ['open.txt',{encoding:'utf8',eol:'LF',bom:false},'old']
    ]){const file=path.join(folder,name),bytes=encode(text,meta);original.set(file,bytes);await fs.writeFile(file,bytes);}
    const plan=await preview({root:folder,blocked:[path.join(folder,'open.txt')],options:{query:'old',replacement:'new'}});
    assert.equal(plan.entries.length,4);assert.match(plan.skipped[0].reason,/Open in/);
    const changed=plan.entries.at(-1);await fs.writeFile(changed.path,'external');
    await assert.rejects(applyFiles(plan.entries,path.join(root,'recovery')),/changed after preview/);
    for(const entry of plan.entries.slice(0,-1))assert.deepEqual(await fs.readFile(entry.path),original.get(entry.path));
    await fs.writeFile(changed.path,original.get(changed.path));
    const result=await applyFiles(plan.entries,path.join(root,'recovery'));assert.equal(result.ok,true);
    for(let i=0;i<plan.entries.length;i++){const entry=plan.entries[i];assert.deepEqual(await fs.readFile(entry.path),encode(entry.after,entry.meta));assert.deepEqual(await fs.readFile(path.join(result.recovery,`${i}.original`)),original.get(entry.path));}
    assert.deepEqual(await fs.readFile(path.join(folder,'open.txt')),original.get(path.join(folder,'open.txt')));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('failed batch restores prior writes and preserves external edits detected before rollback',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpad-rollback-')));
  try{
    const folder=path.join(root,'files');await fs.mkdir(folder);
    await fs.writeFile(path.join(folder,'a.txt'),'old');await fs.writeFile(path.join(folder,'b.txt'),'old');
    for(const external of [false,true]){
      const plan=await preview({root:folder,options:{query:'old',replacement:'new'}});let writes=0;
      const result=await applyFiles(plan.entries,path.join(root,'recovery'),async(...args)=>{
        if(++writes===2){if(external)await fs.writeFile(plan.entries[0].path,'external');throw new Error('Injected write failure');}
        return writeDocument(...args);
      });
      assert.equal(result.ok,false);assert.equal(result.rollback[0].restored,!external);
      assert.equal(await fs.readFile(plan.entries[0].path,'utf8'),external?'external':'old');
      assert.equal(await fs.readFile(plan.entries[1].path,'utf8'),'old');
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('explicit legacy encoding rejects lossy replacements and mixed EOL line-count changes',async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpad-legacy-')));
  try{
    await fs.writeFile(path.join(root,'legacy.txt'),encode('café old',{encoding:'windows1252',eol:'LF'}));
    const good=await preview({root,options:{query:'old',replacement:'new',encoding:'windows1252'}});assert.equal(good.entries.length,1);
    const lossy=await preview({root,options:{query:'old',replacement:'😀',encoding:'windows1252'}});assert.equal(lossy.entries.length,0);assert.match(lossy.skipped[0].reason,/cannot be represented/);
    await fs.writeFile(path.join(root,'mixed.txt'),Buffer.from('old\r\nx\n'));
    const mixed=await preview({root,options:{query:'old',replacement:'new\nline'}});assert.equal(mixed.entries.length,0);assert.ok(mixed.skipped.some(e=>e.reason.includes('Line count changed')));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
