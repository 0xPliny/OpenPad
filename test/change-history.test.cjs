const test=require('node:test'),assert=require('node:assert/strict');
test('change bars distinguish saved snapshots from later edits and handle undo-to-saved text',async()=>{
  const {EditorState}=await import('@codemirror/state'),{changeHistory,initializeHistory,acceptSavedHistory,historyKind}=await import('../src/change-history.mjs');
  let state=EditorState.create({doc:'one\ntwo\nthree',extensions:[changeHistory]});state=state.update({effects:initializeHistory.of({saved:state.doc,enabled:true})}).state;
  state=state.update({changes:{from:0,to:3,insert:'ONE'}}).state;const snapshot=state.doc;assert.equal(historyKind(state,state.doc.line(1)),'unsaved');assert.equal(historyKind(state,state.doc.line(3)),null);
  state=state.update({changes:{from:8,to:13,insert:'THREE'}}).state;state=state.update({effects:acceptSavedHistory.of(snapshot)}).state;assert.equal(historyKind(state,state.doc.line(1)),'saved');assert.equal(historyKind(state,state.doc.line(3)),'unsaved');
  state=state.update({changes:{from:8,to:13,insert:'three'}}).state;assert.equal(historyKind(state,state.doc.line(1)),'saved');assert.equal(historyKind(state,state.doc.line(3)),null);
});
test('change bars represent deleted terminal lines and pause beyond their bound',async()=>{
  const {EditorState}=await import('@codemirror/state'),{changeHistory,initializeHistory,historyKind}=await import('../src/change-history.mjs');
  let state=EditorState.create({doc:'a\nb',extensions:[changeHistory]});state=state.update({effects:initializeHistory.of({saved:state.doc,enabled:true})}).state;state=state.update({changes:{from:1,to:3}}).state;assert.equal(historyKind(state,state.doc.line(1)),'unsaved');
  state=state.update({changes:{from:0,to:1,insert:'x'.repeat(1_000_001)}}).state;assert.equal(state.field(changeHistory).paused,true);assert.deepEqual(state.field(changeHistory).unsaved,[]);
});
test('large-span fallback is labelled even if the dependency reports precise chunks',async()=>{
  const {EditorState}=await import('@codemirror/state'),{changeHistory,initializeHistory,historyApproximate}=await import('../src/change-history.mjs');
  const saved=EditorState.create({doc:'a'.repeat(90000)+'\nKEEP\n'+'b'.repeat(90000)}).doc;
  let state=EditorState.create({doc:'x'.repeat(90000)+'\nKEEP\n'+'y'.repeat(90000),extensions:[changeHistory]});state=state.update({effects:initializeHistory.of({saved,enabled:true})}).state;assert.equal(historyApproximate(state.field(changeHistory)),true);
});
