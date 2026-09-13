const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MarkRunner}=require('../src/mark-runner.cjs');
test('mark worker finds regex Unicode/multiline offsets and rejects overflow/invalid patterns',async()=>{
  const runner=new MarkRunner();
  const result=await runner.run({id:1,text:'α1\nB22\nkeep',options:{query:'[αB]\\d+',regex:true,caseSensitive:true}});assert.deepEqual(result.ranges,[{from:0,to:2},{from:3,to:6}]);
  assert.deepEqual((await runner.run({id:2,text:'a\nb',options:{query:'a.b',regex:true,dotAll:true}})).ranges,[{from:0,to:3}]);
  assert.deepEqual((await runner.run({id:3,text:'cat scatter CAT',options:{query:'cat',wholeWord:true}})).ranges,[{from:0,to:3},{from:12,to:15}]);
  assert.deepEqual((await runner.run({id:4,text:'abc',options:{query:'^',regex:true}})).ranges,[]);
  assert.match((await runner.run({id:5,text:'a',options:{query:'[',regex:true}})).error,/regular expression/i);
  assert.match((await runner.run({id:6,text:'a'.repeat(10001),options:{query:'a'}})).error,/10,000/);
});
test('mark worker cancellation is request-specific and a later request succeeds',async()=>{
  const runner=new MarkRunner();const pending=runner.run({id:10,text:'a'.repeat(100000)+'!',options:{query:'(a+)+$',regex:true}});runner.cancel(9);assert.equal(runner.job.id,10);runner.cancel(10);assert.deepEqual(await pending,{cancelled:true});
  assert.deepEqual((await runner.run({id:11,text:'abc',options:{query:'b'}})).ranges,[{from:1,to:2}]);
  const old=runner.run({id:12,text:'a'.repeat(100000)+'!',options:{query:'(a+)+$',regex:true}});const next=runner.run({id:13,text:'z',options:{query:'z'}});assert.deepEqual(await old,{cancelled:true});assert.deepEqual((await next).ranges,[{from:0,to:1}]);
});
test('pathological marking times out without blocking the caller',async()=>{
  const runner=new MarkRunner(100);const result=await runner.run({id:20,text:'a'.repeat(100000)+'!',options:{query:'(a+)+$',regex:true}});assert.match(result.error,/exceeded/);assert.equal(runner.job,null);
});
