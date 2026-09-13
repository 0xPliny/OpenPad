const test=require('node:test');
const assert=require('node:assert/strict');
test('parsed outlines find declarations and ignore comment/string decoys across language fixtures',async()=>{
  const {EditorState}=await import('@codemirror/state'),{outline}=await import('../src/language-model.mjs');
  for(const [name,module,fn,text,expected] of [
    ['JavaScript','@codemirror/lang-javascript','javascript','// function fake() {}\nconst text="class Fake {}";\nclass Thing { method(x) { return x; } }\nfunction greet(name) {}',['Thing','method','greet']],
    ['Python','@codemirror/lang-python','python','# def fake():\nclass Thing:\n def method(self):\n  pass\ndef greet(name):\n pass',['Thing','method','greet']],
    ['C++','@codemirror/lang-cpp','cpp','// int fake() {}\nclass Thing { int method(int x) {return x;} };\nint greet(int x) { return x; }',['Thing','method','greet']],
    ['Java','@codemirror/lang-java','java','class Thing { public int method(int x) {return x;} }',['Thing','method']],
    ['Rust','@codemirror/lang-rust','rust','struct Thing {x: i32}\nfn greet(x: i32) -> i32 { x }',['Thing','greet']],
    ['Go','@codemirror/lang-go','go','package main\nfunc greet(x int) int { return x }\ntype Thing struct { X int }',['greet','Thing']]
  ]){
    const state=EditorState.create({doc:text,extensions:[(await import(module))[fn]()]});const result=outline(state,name);assert.equal(result.complete,true,name);assert.deepEqual(result.symbols.map(s=>s.name),expected,name);for(const symbol of result.symbols)assert.equal(state.doc.sliceString(symbol.from,symbol.from+symbol.name.length),symbol.name);
  }
  const js=await import('@codemirror/lang-javascript');const ts=EditorState.create({doc:'class Thing { method(x: number): number { return x; } }',extensions:[js.javascript({typescript:true})]});assert.deepEqual(outline(ts,'TypeScript').symbols.map(s=>s.name),['Thing','method']);
  assert.equal(outline(EditorState.create({doc:'plain'}),'').unsupported,true);
});
test('API completion accepts only bounded data and returns literal insertion/signature',async()=>{
  const {EditorState}=await import('@codemirror/state'),{CompletionContext}=await import('@codemirror/autocomplete'),{validateAPI,apiCompletion}=await import('../src/language-model.mjs');
  const entries=validateAPI([{label:'greet',detail:'greet(name)',info:'Local API',apply:'greet()'}]);
  const state=EditorState.create({doc:'gre'}),result=apiCompletion(new CompletionContext(state,3,true),entries);assert.equal(result.from,0);assert.equal(result.options[0].apply,'greet()');
  for(const invalid of [{},[{label:'bad name'}],[{label:'a'},{label:'a'}],[{label:'a',apply:42}]])assert.throws(()=>validateAPI(invalid));
  const locked=EditorState.create({doc:'gre',extensions:[EditorState.readOnly.of(true)]});assert.equal(apiCompletion(new CompletionContext(locked,3,true),entries),null);
});
test('language settings recovery skips malformed definitions without losing valid entries',async()=>{
  const {restoreLanguageSettings}=await import('../src/language-settings.mjs');
  const result=restoreLanguageSettings({customLanguages:{Bad:{name:'Bad',extensions:null},Good:{name:'Good',extensions:['ok']}},apiEntries:{'*':'bad',Python:[{label:'greet'}]}});
  assert.deepEqual(Object.keys(result.settings.customLanguages),['Good']);assert.deepEqual(Object.keys(result.settings.apiEntries),['Python']);assert.equal(result.warnings.length,2);
});
