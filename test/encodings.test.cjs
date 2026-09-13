const test=require('node:test'),assert=require('node:assert/strict');
const {decode,encode}=require('../src/files.cjs');
const {encodings,boms}=require('../src/encodings.cjs');
const fixtures=[['windows1251','cff0e8e2e5f2','Привет'],['shiftjis','93fa967b','日本'],['gbk','d6d0b9fa','中国'],['big5','a4a4a4e5','中文'],['euckr','c7d1b1b9','한국'],['windows1253','e1e2','αβ'],['windows1255','f9ece5ed','שלום'],['utf32le','4100000000f60100','A😀'],['utf32be','000000410001f600','A😀']];
for(const [encoding,hex,text] of fixtures)test(`${encoding} matches independent byte fixture`,()=>{const bytes=Buffer.from(hex,'hex'),doc=decode(bytes,encoding);assert.equal(doc.text,text);assert.deepEqual(encode(text,doc),bytes);});
test('all listed encodings round-trip ASCII with CRLF; Unicode BOM detection is longest first',()=>{
  for(const encoding of encodings){const meta={encoding,eol:'CRLF',bom:false},bytes=encode('A\nB',meta);assert.equal(decode(bytes,encoding).text,'A\nB');assert.deepEqual(encode(decode(bytes,encoding).text,{...meta}),bytes);}
  for(const encoding of Object.keys(boms)){const bytes=encode('A😀\n',{encoding,eol:'LF',bom:true}),doc=decode(bytes);assert.equal(doc.encoding,encoding);assert.equal(doc.text,'A😀\n');assert.deepEqual(encode(doc.text,doc),bytes);}
});
test('malformed legacy/UTF-32, conflicting BOM and lossy conversion are rejected',()=>{
  assert.throws(()=>decode(Buffer.from([0x82]),'shiftjis'),/round-trip/);
  assert.throws(()=>decode(Buffer.from([0x41,0,0]),'utf32le'),/round-trip/);
  assert.throws(()=>decode(Buffer.from([0xff,0xfe,0x41,0]),'windows1252'),/byte order mark/);
  assert.throws(()=>encode('😀',{encoding:'shiftjis',eol:'LF',bom:false}),/represented/);
  assert.throws(()=>encode('a',{encoding:'windows1251',eol:'LF',bom:true}),/byte order mark/);
  for(const [encoding,hex] of [['utf32le','00d80000'],['utf32le','00dc0000'],['utf32be','0000d800'],['utf32be','00110000']])assert.throws(()=>decode(Buffer.from(hex,'hex'),encoding),/Unicode scalar/);
  for(const encoding of ['utf32le','utf32be'])assert.throws(()=>encode('\ud800',{encoding,eol:'LF',bom:false}),/surrogate/);
});
