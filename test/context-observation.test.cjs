const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{createHash}=require('node:crypto');
const {within,latestRecorded,matchesText}=require('../src/context-observation.cjs');
test('latest matching path evidence cannot bypass a later unknown range, deletion or ancestor failure',()=>{
  const root=path.resolve('test-artifacts/observation'),file=path.join(root,'notes','AGENTS.md'),event={type:'modify',path:'notes/AGENTS.md',ranges:{after:{fromLine:1,toLine:2}},afterTextHash:createHash('sha256').update('known').digest('hex')};
  for(const later of [{type:'modify',path:event.path,ranges:null},{type:'delete',path:event.path},{type:'issue',path:'notes'},{type:'issue',path:''}]){
    const selected=latestRecorded([{root,events:[event,later]}],file);assert.equal(selected,later);assert.equal(matchesText(selected,'known'),false);
  }
  assert.equal(latestRecorded([{root,events:[event,{type:'issue',path:'other'}]}],file),event);
  assert.equal(matchesText(event,'known'),true);assert.equal(matchesText(event,'changed'),false);
  assert.equal(within(root,root+'-sibling/AGENTS.md'),false);assert.equal(within(root,file),true);
});
