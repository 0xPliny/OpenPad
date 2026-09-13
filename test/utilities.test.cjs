const test=require('node:test'),assert=require('node:assert/strict');
test('character panel handles Unicode scalars, supplementary bytes and invalid input',async()=>{
  const {scalar,characterInfo}=await import('../src/utilities-model.mjs');assert.equal(scalar('U+1F600'),'😀');assert.equal(scalar('03b1'),'α');for(const input of ['D800','110000','0','-1','1g'])assert.throws(()=>scalar(input));assert.deepEqual(characterInfo('😀'),[{character:'😀',code:'U+1F600',units:2,bytes:'f0 9f 98 80'}]);assert.equal(characterInfo('a'.repeat(1000)).length,256);
});
