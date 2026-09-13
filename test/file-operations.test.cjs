const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {renameDocument,validName}=require('../src/file-operations.cjs');
const {hash}=require('../src/files.cjs');
test('rename preserves bytes, refuses existing targets and checks disk conflicts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-rename-'));
  try{
    const file=path.join(root,'old.txt'),bytes=Buffer.from('\ufeffsaved\r\n');await fs.writeFile(file,bytes);
    const old={path:file,name:'old.txt',hash:hash(bytes)},renamed=await renameDocument(old,'new.txt');
    assert.deepEqual(await fs.readFile(renamed.path),bytes);await assert.rejects(fs.stat(file),{code:'ENOENT'});
    await fs.writeFile(file,'keep');await assert.rejects(renameDocument(renamed,'old.txt'),{code:'EEXIST'});assert.equal(await fs.readFile(file,'utf8'),'keep');
    const cased=await renameDocument(renamed,'NEW.txt');assert.ok((await fs.readdir(root)).includes('NEW.txt'));assert.deepEqual(await fs.readFile(cased.path),bytes);
    await fs.writeFile(cased.path,'external');await assert.rejects(renameDocument(cased,'third.txt'),/changed on disk/);assert.equal(await fs.readFile(cased.path,'utf8'),'external');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('rename rejects traversal and Windows reserved filenames',()=>{
  for(const name of ['../outside','..','x/y','x\\y','NUL','COM1.txt','file.','file ','a:b',''])assert.throws(()=>validName(name));
  assert.equal(validName('世界 file.txt'),'世界 file.txt');
});
