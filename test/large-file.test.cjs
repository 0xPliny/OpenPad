const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {readPage,pageBytes}=require('../src/large-file.cjs');
test('bounded UTF-8 pages retain complete characters, internal BOM and CRLF boundaries',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-pages-')),file=path.join(root,'unicode.txt'),text='abc😀dé\r\n漢字\ufefftail😀';await fs.writeFile(file,'\ufeff'+text);
  try{
    for(let limit=4;limit<12;limit++){let offset=0,result='';for(let count=0;count<100;count++){const page=await readPage(file,offset,limit);assert.equal(page.offset,offset);assert.ok(page.end>offset);assert.ok(page.end-offset<=limit);assert.ok(!page.text.includes('�'));result+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}assert.equal(result,text);}
    const page=await readPage(file,7,8);assert.equal(page.offset,6);assert.ok(page.text.startsWith('😀'));await assert.rejects(readPage(file,-1),/nonnegative/);
    await fs.writeFile(file,'');const {version,...empty}=await readPage(file);assert.equal(version.size,0);assert.deepEqual(empty,{text:'',offset:0,end:0,size:0,nextOffset:null,previousOffset:null});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('sparse gigabyte file can be read at its tail without loading earlier bytes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-tail-page-')),file=path.join(root,'huge.txt'),size=1024*1024*1024,tail=Buffer.from('TAIL 😀');const handle=await fs.open(file,'w');await handle.truncate(size);await handle.write(tail,0,tail.length,size-tail.length);await handle.close();
  try{const page=await readPage(file,size-tail.length);assert.equal(page.text,'TAIL 😀');assert.equal(page.size,size);assert.equal(page.end,size);assert.equal(page.nextOffset,null);assert.ok(page.previousOffset>0);assert.ok(page.end-page.offset<=pageBytes);}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('page read rejects a file changed during bounded IO',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-page-race-')),file=path.join(root,'file.txt');await fs.writeFile(file,'abc');const open=fs.open;
  t.mock.method(fs,'open',async(...args)=>{const handle=await open(...args),read=handle.read.bind(handle);handle.read=async(...args)=>{const result=await read(...args);await fs.appendFile(file,'changed');return result;};return handle;});
  try{await assert.rejects(readPage(file),/changed/);}finally{t.mock.restoreAll();await fs.rm(root,{recursive:true,force:true});}
});
