const test=require('node:test');
const assert=require('node:assert/strict');
const {replaceFile}=require('../src/replace-file.cjs');
test('Windows transient sharing failure retries and checks conflicts before retry',async()=>{
  let calls=0,checks=0;
  await replaceFile('temp','target',async()=>{checks++;},{platform:'win32',delay:async()=>{},rename:async()=>{if(++calls<3)throw Object.assign(new Error('sharing'),{code:'EPERM'});}});
  assert.equal(calls,3);assert.equal(checks,3);
  calls=0;checks=0;
  await assert.rejects(replaceFile('temp','target',async()=>{if(++checks===2)throw new Error('external change');},{platform:'win32',delay:async()=>{},rename:async()=>{calls++;throw Object.assign(new Error('sharing'),{code:'EPERM'});}}),/external change/);
  assert.equal(calls,1);
});
test('replacement reports permanent failure and never retries unrelated errors',async()=>{
  let calls=0;
  await assert.rejects(replaceFile('temp','target',undefined,{platform:'win32',delay:async()=>{},rename:async()=>{calls++;throw Object.assign(new Error('denied'),{code:'EACCES'});}}),/denied/);
  assert.equal(calls,6);calls=0;
  await assert.rejects(replaceFile('temp','target',undefined,{platform:'win32',delay:async()=>{},rename:async()=>{calls++;throw Object.assign(new Error('missing'),{code:'ENOENT'});}}),/missing/);
  assert.equal(calls,1);
});
