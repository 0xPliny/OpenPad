const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {textMd5,fileChecksums}=require('../src/checksums.cjs');
test('text MD5 and original encoded file bytes match fixed independent digests',async()=>{
  assert.equal(textMd5('abc'),'900150983cd24fb0d6963f7d28e17f72');assert.equal(textMd5(''),'d41d8cd98f00b204e9800998ecf8427e');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-hashes-')),file=path.join(root,'encoded.txt');
  try{
    await fs.writeFile(file,Buffer.from('fffe61000d000a00','hex'));const result=await fileChecksums(file);assert.equal(result.bytes,8);assert.deepEqual(result.values,{'SHA-256':'44f45785c4b9aa4bfe48cce74597051829645f3f13f3f4496c6300549342b636','SHA-512':'80c6d80ffb83a4ed7ca5fc7aea87ab7e6056cba254cd7e82738c13bb14c2bb9d8fff708c53b4cee1d115d537f82c5a70d470ec568ecf4fad381a09c5e1e447f5','MD5':'1cf77f2fdfad9260e8e182f4091e14e8'});
    await fs.writeFile(file,'');assert.equal((await fileChecksums(file)).values.MD5,'d41d8cd98f00b204e9800998ecf8427e');
    const handle=await fs.open(file,'w');await handle.truncate(32*1024*1024+1);await handle.close();await assert.rejects(fileChecksums(file),/32 MiB/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('file checksum rejects an append during streaming instead of reporting a stable file result',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-hash-race-')),file=path.join(root,'file.txt');await fs.writeFile(file,'abc');const open=fs.open;
  t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args),stream=handle.createReadStream.bind(handle);handle.createReadStream=options=>(async function*(){for await(const chunk of stream(options)){yield chunk;await fs.appendFile(file,'changed');}})();return handle;});
  try{await assert.rejects(fileChecksums(file),/changed/);assert.equal(await fs.readFile(file,'utf8'),'abcchanged');}finally{t.mock.restoreAll();await fs.rm(root,{recursive:true,force:true});}
});
