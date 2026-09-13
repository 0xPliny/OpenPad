const test=require('node:test');
const assert=require('node:assert/strict');
test('color ranges map through insertion and disappear on deletion; malformed recovery is filtered',async()=>{
  const {EditorState}=await import('@codemirror/state'),{marks,setMarks,validMarks}=await import('../src/marks.mjs');
  let state=EditorState.create({doc:'abc def ghi',extensions:[marks]});
  state=state.update({effects:setMarks.of([{from:4,to:7,color:2},{from:-1,to:3,color:1},{from:0,to:2,color:99},null])}).state;
  assert.deepEqual(state.field(marks),[{from:4,to:7,color:2}]);
  state=state.update({changes:{from:0,insert:'!'}}).state;assert.deepEqual(state.field(marks),[{from:5,to:8,color:2}]);
  state=state.update({changes:{from:5,to:8,insert:'new'}}).state;assert.deepEqual(state.field(marks),[]);
  assert.deepEqual(validMarks('bad',5),[]);
});
test('literal marks preserve Unicode offsets and reject runaway matches',async()=>{
  const {literalMarks}=await import('../src/marks.mjs');
  assert.deepEqual(literalMarks('😀a😀a','😀',3),[{from:0,to:2,color:3},{from:3,to:5,color:3}]);
  assert.throws(()=>literalMarks('a','',1));assert.throws(()=>literalMarks('a'.repeat(10001),'a',1),/10,000/);
});
