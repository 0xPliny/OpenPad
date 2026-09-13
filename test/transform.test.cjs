const test=require('node:test');
const assert=require('node:assert/strict');
test('text transformations preserve newline shape and use numeric/natural ordering',async()=>{
  const {transform}=await import('../src/transform-model.mjs');
  assert.equal(transform('10\n2\n1\n','numeric'),'1\n2\n10\n');
  assert.equal(transform('item10\nitem2\nitem1','natural'),'item1\nitem2\nitem10');
  assert.equal(transform('b\na\nb\n','unique'),'b\na\n');
  assert.equal(transform('a\n\n \nb\n','empty'),'a\n \nb\n');
  assert.equal(transform('a\n\n \nb\n','blank'),'a\nb\n');
  assert.equal(transform(' one\n two \n','join'),'one two\n');
  assert.throws(()=>transform('2\ninvalid','numeric'),/finite number/);
});
test('case and tab conversion handle Unicode without splitting surrogate pairs',async()=>{
  const {transform}=await import('../src/transform-model.mjs');
  assert.equal(transform('élan STRASSE 😀','title'),'Élan Strasse 😀');
  assert.equal(transform('ABC élan','invert'),'abc ÉLAN');
  assert.equal(transform('😀\tX\na\tY','tabs',4),'😀   X\na   Y');
  assert.equal(transform('      x\n  \tx\ninside    unchanged','spaces',4),'\t  x\n\tx\ninside    unchanged');
  assert.equal(transform('\n \n','blank'),'');
});

test('multiple selections transform separately and overlapping line expansions transform once',async()=>{
  const {EditorState,EditorSelection}=await import('@codemirror/state');
  const {transformationChanges}=await import('../src/transform-model.mjs');
  const state=(doc,ranges)=>EditorState.create({doc,extensions:EditorState.allowMultipleSelections.of(true),selection:EditorSelection.create(ranges.map(([a,b])=>EditorSelection.range(a,b)))});
  const run=(value,operation)=>value.update({changes:transformationChanges(value,operation)}).newDoc.toString();
  assert.equal(run(state('élan / straße / keep',[[0,4],[7,13]]),'upper'),'ÉLAN / STRASSE / keep');
  assert.equal(run(state('one two\nKEEP',[[0,1],[4,5]]),'tabs'),'one two\nKEEP');
  assert.equal(run(state('b\na\nc\nKEEP',[[0,3],[4,5]]),'sort'),'a\nb\nc\nKEEP');
  assert.equal(run(state('c\nb\na\nKEEP',[[0,3],[4,5]]),'reverse'),'b\nc\na\nKEEP');
  assert.equal(run(state('one  two  \nKEEP',[[0,1],[5,6]]),'trim'),'one  two\nKEEP');
  assert.equal(run(state('aa bb',[[0,2],[4,4]]),'upper'),'AA bb');
  assert.equal(run(state('aa bb',[[0,0],[3,3]]),'upper'),'AA BB');
  assert.equal(run(state('a\n \nb\n \nc',[[2,3],[6,7]]),'blank'),'a\nb\nc');
  assert.equal(run(state('a\n ',[[2,3]]),'blank'),'a');
  assert.equal(run(state('a\n \n ',[[2,3],[4,5]]),'blank'),'a');
  assert.equal(run(state('a\n\nb\n\nc',[[2,3],[5,6]]),'empty'),'a\nb\nc');
  assert.equal(run(state('a\n \nb',[[2,3]]),'empty'),'a\n \nb');
  const invalid=state('2\n1\nx',[[0,3],[4,5]]);assert.throws(()=>transformationChanges(invalid,'numeric'),/finite number/);assert.equal(invalid.doc.toString(),'2\n1\nx');
});
