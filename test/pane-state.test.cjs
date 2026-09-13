const test=require('node:test'),assert=require('node:assert/strict');
test('peer selections map independently while canonical undo and shared effects stay identical',async()=>{
  const {EditorState,Compartment}=await import('@codemirror/state'),{history,historyField,undo,redo,isolateHistory}=await import('@codemirror/commands');
  const {peerState}=await import('../src/pane-state.mjs');const readonly=new Compartment();let main=EditorState.create({doc:'alpha\nbeta',extensions:[history(),readonly.of(EditorState.readOnly.of(false))]});let peer=main.update({selection:{anchor:8}}).state;
  const first=main.update({changes:{from:0,insert:'X'},selection:{anchor:1},annotations:isolateHistory.of('full')});main=first.state;peer=peerState(main,peer,first.changes);assert.equal(main.selection.main.head,1);assert.equal(peer.selection.main.head,9);assert.equal(peer.field(historyField),main.field(historyField));
  const second=peer.update({changes:{from:peer.selection.main.head,insert:'Y'},selection:{anchor:10},annotations:isolateHistory.of('full')});peer=second.state;main=peerState(peer,main,second.changes);assert.equal(main.selection.main.head,1);assert.equal(peer.selection.main.head,10);
  const host={get state(){return main;},dispatch:tr=>{main=tr.state;peer=peerState(main,peer,tr.changes);}};assert.equal(undo(host),true);assert.equal(main.doc.toString(),'Xalpha\nbeta');assert.equal(peer.doc,main.doc);assert.equal(redo(host),true);assert.equal(main.doc.toString(),'Xalpha\nbeYta');assert.equal(peer.field(historyField),main.field(historyField));
  main=main.update({effects:readonly.reconfigure(EditorState.readOnly.of(true))}).state;peer=peerState(main,peer);assert.equal(peer.readOnly,true);
});
test('fallback pane mapping handles reload replacements and rejects wrong-generation changes',async()=>{
  const {EditorState}=await import('@codemirror/state');const {peerState,documentChanges}=await import('../src/pane-state.mjs');const before=EditorState.create({doc:'start\nkeep\nend',selection:{anchor:8}}),after=EditorState.create({doc:'new\nstart\nkeep\nend'});
  assert.equal(peerState(after,before).selection.main.head,12);const middle=EditorState.create({doc:'aaa\nKEEP\nzzz',selection:{anchor:6}}),separated=EditorState.create({doc:'AAA\nKEEP\nZZZ'});assert.equal(peerState(separated,middle).selection.main.head,6);const changes=documentChanges(before.doc,after.doc);assert.equal(changes.apply(before.doc).toString(),after.doc.toString());assert.throws(()=>peerState(after,before,after.changes([])),/generations/);
});
test('saved view positions clamp to current text and malformed selection/scroll falls back safely',async()=>{
  const {EditorSelection}=await import('@codemirror/state'),{restoredSelection,scrollPosition}=await import('../src/pane-state.mjs');const fallback=EditorSelection.single(2);
  assert.equal(restoredSelection({ranges:[{anchor:10,head:20}],main:0},5,fallback).main.head,5);
  for(const invalid of [null,{},42,{ranges:[]},{ranges:[null]},{ranges:[{anchor:'bad',head:2}]}])assert.equal(restoredSelection(invalid,5,fallback),fallback);
  assert.deepEqual(scrollPosition({top:'bad',left:-1}),{top:0,left:0});assert.deepEqual(scrollPosition({top:45,left:22}),{top:45,left:22});
});
test('scroll restoration completes even when animation frames are suspended',async()=>{
  const {EditorState}=await import('@codemirror/state'),{restoreScroll}=await import('../src/pane-state.mjs');const original=global.requestAnimationFrame;global.requestAnimationFrame=()=>0;
  try{const view={state:EditorState.create({doc:'text'}),dom:{isConnected:true},scrollDOM:{scrollTop:0,scrollLeft:0},requestMeasure(){}};await restoreScroll(view,{top:40,left:12});assert.equal(view.scrollDOM.scrollTop,40);assert.equal(view.scrollDOM.scrollLeft,12);}finally{if(original)global.requestAnimationFrame=original;else delete global.requestAnimationFrame;}
});
