const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EditorState,EditorSelection}=require('@codemirror/state');
const model=import('../src/editing-model.mjs');
test('column insertion pads ragged lines without splitting Unicode',async()=>{
  const {columnChanges}=await model;const state=EditorState.create({doc:'🌱a\nb\n'});
  const result=state.update({changes:columnChanges(state.doc.toString(),{startLine:1,endLine:3,column:3,value:'X'})}).state;
  assert.equal(result.doc.toString(),'🌱aX\nb X\n  X');
});
test('column number sequence supports repeat, negative steps and zero padding',async()=>{
  const {columnChanges}=await model;const state=EditorState.create({doc:'a\nb\nc\nd'});
  assert.equal(state.update({changes:columnChanges(state.doc.toString(),{startLine:1,endLine:4,column:1,mode:'number',start:2,step:-3,repeat:2,width:3})}).state.doc.toString(),'002a\n002b\n-001c\n-001d');
  assert.throws(()=>columnChanges('a',{startLine:1,endLine:4,column:1}),/Invalid/);
});
test('tab-stop columns split only intersected tabs and keep combining clusters intact',async()=>{
  const {columnChanges,insertionColumn}=await model;
  const apply=(text,column,tabSize=4)=>EditorState.create({doc:text}).update({changes:columnChanges(text,{startLine:1,endLine:text.split('\n').length,column,columnMode:'tabs',tabSize,value:'X'})}).newDoc.toString();
  assert.equal(apply('\ta\nb\n',3),'  X  a\nb X\n  X');
  assert.equal(apply('\ta',5),'\tXa');assert.equal(apply('\ta',1),'X\ta');
  assert.equal(apply('a\tb',3),'a X  b');assert.equal(apply('\ta',3,2),'\tXa');
  assert.equal(apply('e\u0301z\n🌱z',2),'e\u0301Xz\n🌱Xz');assert.equal(insertionColumn('e\u0301\t',4),5);
  assert.throws(()=>apply('a',2,0),/tab width/);
});
test('macro text and cursor steps replay relative to the current cursor',async()=>{
  const {macroStep,replayMacro}=await model;
  const state=EditorState.create({doc:'aa',selection:{anchor:1}});
  const typing=state.update({changes:{from:1,insert:'X'},selection:{anchor:2}});
  const movement=typing.state.update({selection:{anchor:3}});
  const target=EditorState.create({doc:'bb',selection:{anchor:0}});
  const result=replayMacro(target,[macroStep(typing),macroStep(movement)]);
  assert.equal(result.doc.toString(),'Xbb');assert.equal(result.selection.main.head,2);assert.equal(target.doc.toString(),'bb');
});
test('invalid macro and repeat limits do not partially mutate target',async()=>{
  const {replayMacro}=await model;const state=EditorState.create({doc:'abc'});
  const steps=[{changes:[{from:0,to:0,insert:'X'}],ranges:[{anchor:1,head:1}]},{changes:[{from:-100,to:0,insert:''}],ranges:[{anchor:0,head:0}]}];
  assert.throws(()=>replayMacro(state,steps),/outside/);assert.equal(state.doc.toString(),'abc');assert.throws(()=>replayMacro(state,steps,1001),/limited/);
});
test('multi-cursor macro preserves primary cursor over multiple steps',async()=>{
  const {macroStep,replayMacro}=await model;
  const state=EditorState.create({doc:'ab\ncd',extensions:EditorState.allowMultipleSelections.of(true),selection:EditorSelection.create([EditorSelection.cursor(1),EditorSelection.cursor(4)],1)});
  const first=state.update(state.replaceSelection('X'));const second=first.state.update(first.state.replaceSelection('Y'));
  const result=replayMacro(state,[macroStep(first),macroStep(second)]);
  assert.equal(result.doc.toString(),second.newDoc.toString());assert.equal(result.selection.mainIndex,1);
});
test('cursor-only macro leaves bookmark positions and document identity intact',async()=>{
  const {macroStep,replayMacro}=await model;const state=EditorState.create({doc:'a\nb\nc'});
  const step=state.update({selection:{anchor:1}});const result=replayMacro(state,[macroStep(step)]);
  assert.equal(result.changes.empty,true);assert.equal(result.changes.mapPos(2,1),2);assert.equal(result.doc,state.doc);
});

test('until-end macros advance, delete or insert-and-advance with atomic composed edits',async()=>{
  const {replayMacro}=await model,step=(head,changes=[])=>({changes,ranges:[{anchor:head,head}]});
  const state=EditorState.create({doc:'abc'});
  const forward=replayMacro(state,[step(1)],'end');assert.equal(forward.selection.main.head,3);assert.equal(forward.repetitions,3);assert.equal(forward.doc,state.doc);
  const deleted=replayMacro(state,[step(0,[{from:0,to:1,insert:''}])],'end');assert.equal(deleted.doc.toString(),'');assert.equal(deleted.repetitions,3);
  const inserted=replayMacro(state,[step(2,[{from:0,to:0,insert:'X'}])],'end');assert.equal(inserted.doc.toString(),'XaXbXc');assert.equal(inserted.repetitions,3);assert.equal(state.doc.toString(),'abc');assert.equal(inserted.changes.apply(state.doc).toString(),'XaXbXc');
  const atEnd=state.update({selection:{anchor:3}}).state;assert.equal(replayMacro(atEnd,[step(1)],'end').repetitions,0);
});
test('until-end macro failures discard late simulated edits and reject nonprogress',async()=>{
  const {replayMacro}=await model,step=(head,changes=[])=>({changes,ranges:[{anchor:head,head}]});
  const state=EditorState.create({doc:'abc'});
  for(const steps of [[step(1,[{from:0,to:0,insert:'X'}])],[step(0)],[step(1),step(-1)],[step(2,[{from:0,to:1,insert:'X'}])]])assert.throws(()=>replayMacro(state,steps,'end'),/toward|leave/);
  assert.equal(state.doc.toString(),'abc');
  const complete=replayMacro(EditorState.create({doc:'a'}),[step(1),step(1,[{from:0,to:0,insert:'!'}])],'end');assert.equal(complete.doc.toString(),'a!');assert.equal(complete.repetitions,1);
  assert.throws(()=>replayMacro(EditorState.create({doc:'a'}),[step(1),step(1)],'end'),/leave/);
});
test('until-end macro budgets count actual repetitions and steps',async()=>{
  const {replayMacro}=await model,step={changes:[],ranges:[{anchor:1,head:1}]};
  assert.equal(replayMacro(EditorState.create({doc:'a'.repeat(1000)}),[step],'end').repetitions,1000);
  assert.throws(()=>replayMacro(EditorState.create({doc:'a'.repeat(1001)}),[step],'end'),/limited/);
  assert.equal(replayMacro(EditorState.create({doc:'a'.repeat(11)}),Array(11).fill(step),'end').repetitions,1);
  assert.equal(replayMacro(EditorState.create({doc:'a'.repeat(10000)}),Array(10).fill(step),'end').repetitions,1000);
  assert.throws(()=>replayMacro(EditorState.create({doc:'a'.repeat(10001)}),Array(11).fill(step),'end'),/limited/);
});

test('until-end follows primary head, preserves multi-primary index and rejects oversized output',async()=>{
  const {replayMacro}=await model,forward={changes:[],ranges:[{anchor:1,head:1}]};
  const reversed=EditorState.create({doc:'abc',selection:EditorSelection.range(3,0)});assert.equal(replayMacro(reversed,[forward],'end').repetitions,3);
  const multiple=EditorState.create({doc:'abcdef',extensions:EditorState.allowMultipleSelections.of(true),selection:EditorSelection.create([EditorSelection.cursor(0),EditorSelection.cursor(3)],1)});
  const result=replayMacro(multiple,[{changes:[],mainIndex:1,ranges:[{anchor:-2,head:-2},{anchor:1,head:1}]}],'end');assert.equal(result.repetitions,3);assert.equal(result.selection.mainIndex,1);assert.deepEqual(result.selection.ranges.map(range=>range.head),[3,6]);
  const large=EditorState.create({doc:'x'.repeat(32*1024*1024)});assert.throws(()=>replayMacro(large,[{changes:[{from:0,to:0,insert:'X'}],ranges:[{anchor:2,head:2}]}],'end'),/exceeds/);assert.equal(large.doc.length,32*1024*1024);
});
