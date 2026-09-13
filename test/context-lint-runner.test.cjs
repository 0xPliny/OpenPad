const test=require('node:test'),assert=require('node:assert/strict');
const {ContextLintRunner}=require('../src/context-lint-runner.cjs');
test('lint worker counts exact text, excludes literal special semantics and reports configured budgets',async t=>{
  const runner=new ContextLintRunner();t.after(()=>runner.close());
  const result=await runner.run({requestId:1,text:'<|endoftext|>',name:'AGENTS.md',tokenizer:'cl100k_base',tokenBudget:1});
  assert.equal(result.tokenCount,7);assert.equal(result.approximate,false);assert.equal(result.findings[0].code,'token-budget');
  const rough=await runner.run({requestId:2,text:'hello',tokenizer:'chars4'});assert.equal(rough.tokenCount,2);assert.equal(rough.approximate,true);
});
test('lint requests cancel, supersede, time out and reject invalid input without poisoning restart',async t=>{
  const runner=new ContextLintRunner();t.after(()=>runner.close());const first=runner.run({requestId:1,text:'TODO'}),next=runner.run({requestId:2,text:'ok',tokenizer:'chars4'});assert.equal((await first).cancelled,true);assert.equal((await next).error,undefined);
  const third=runner.run({requestId:3,text:'TODO'});assert.equal(runner.cancel(99),false);assert.equal(runner.cancel(3),true);assert.equal((await third).cancelled,true);
  assert.ok((await runner.run({requestId:4,text:'\ud800'})).error);assert.ok((await runner.run({requestId:5,text:'ok',tokenizer:'invalid'})).error);
  const timed=new ContextLintRunner(1);t.after(()=>timed.close());assert.match((await timed.run({requestId:1,text:'ok'})).error,/exceeded/);runner.close();assert.ok((await runner.run({requestId:6,text:'ok'})).error);
});
