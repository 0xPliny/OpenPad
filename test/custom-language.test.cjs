const test=require('node:test');
const assert=require('node:assert/strict');
const definition={name:'Test DSL',extensions:['dsl'],keywords:['PRINT'],types:['Number'],caseSensitive:false,lineComment:'#',blockComment:['/*','*/'],strings:['"'],fold:['BEGIN','END']};
test('custom lexer highlights literal rules and ignores folds inside strings/comments',async()=>{
  const {customParser,customFolds,validateLanguage}=await import('../src/custom-language.mjs'),{StringStream}=await import('@codemirror/language');
  const parser=customParser(definition),state=parser.startState(),stream=new StringStream('print Number 42 "END" # BEGIN',4,2),tokens=[];
  while(!stream.eol()){stream.start=stream.pos;const style=parser.token(stream,state);assert.ok(stream.pos>stream.start);if(style)tokens.push([stream.current(),style]);}
  assert.deepEqual(tokens,[['print','keyword'],['Number','typeName'],['42','number'],['"END"','string'],['# BEGIN','comment']]);
  const text='BEGIN\n PRINT "END"\n /* END\n BEGIN */\n BEGIN\n PRINT 1\n END\nEND';const folds=customFolds(text,definition);assert.equal(folds.length,2);assert.equal(folds.at(-1).from,5);assert.equal(text.slice(folds.at(-1).to),'END');
  assert.deepEqual(customFolds('BEGINNING\nENDING',definition),[]);
  for(const value of [{...definition,fold:['','END']},{...definition,fold:['BEGIN','BEGIN END']},{...definition,fold:['begin','BEGIN']},{...definition,strings:['xx']},{...definition,caseSensitive:'false'},{...definition,keywords:['bad word']}])assert.throws(()=>validateLanguage(value));
});
test('custom language installs valid highlighting and fold extensions',async()=>{
  const {EditorState}=await import('@codemirror/state'),{ensureSyntaxTree,foldable}=await import('@codemirror/language'),{customLanguage}=await import('../src/custom-language.mjs');
  const text='BEGIN\nPRINT 1\nEND',state=EditorState.create({doc:text,extensions:[customLanguage(definition)]});assert.ok(ensureSyntaxTree(state,text.length,100));assert.deepEqual(foldable(state,0,5),{from:5,to:14,line:0});
});
