const test=require('node:test');
const assert=require('node:assert/strict');
const {CommandRunner,expandCommand}=require('../src/command-runner.cjs');
const context={inherit:process.cwd(),selection:'a & b; $(literal)',name:'Unsaved'};
function execute(args,extra={}){return new Promise((resolve,reject)=>{const messages=[],runner=new CommandRunner(message=>{messages.push(message);if(message.type==='exit')resolve({messages,runner});});try{runner.start({name:'Test',executable:process.execPath,args,cwd:'inherit',timeout:5,...extra},context);}catch(error){reject(error);}});}
test('external commands pass literal arguments without a shell and capture stdout/stderr',async()=>{
  const {messages}=await execute(['-e','console.log(process.argv[1]);console.error("stderr")','${selection}']);
  assert.equal(messages.filter(m=>m.stream==='stdout').map(m=>m.text).join('').trim(),context.selection);assert.equal(messages.filter(m=>m.stream==='stderr').map(m=>m.text).join('').trim(),'stderr');assert.equal(messages.at(-1).code,0);
  assert.throws(()=>expandCommand({name:'X',executable:'node',args:['${file}']},context),/No file/);
});
test('external command output cap stops runaway output and timeout stops idle process',async()=>{
  const capped=await execute(['-e','process.stdout.write("x".repeat(2*1024*1024));setInterval(()=>{},1000)']);
  assert.match(capped.messages.at(-1).reason,/Output exceeded/);assert.ok(capped.messages.filter(m=>m.type==='output').reduce((n,m)=>n+Buffer.byteLength(m.text),0)<=1024*1024);
  const unicode=await execute(['-e','process.stdout.write("x".repeat(1024*1024-3)+"😀".repeat(10));setInterval(()=>{},1000)']);const text=unicode.messages.filter(m=>m.type==='output').map(m=>m.text).join('');assert.ok(Buffer.byteLength(text)<=1024*1024);assert.ok(!text.includes('\uFFFD'));
  const timeout=await execute(['-e','setInterval(()=>{},1000)'],{timeout:1});assert.match(timeout.messages.at(-1).reason,/Timeout/);assert.equal(timeout.runner.job,null);
});
test('external command failure is reported and runner accepts another command',async()=>{
  const first=await execute([],{executable:'openpad-no-such-executable-8137'});assert.match(first.messages.at(-1).error,/ENOENT/);assert.equal(first.runner.job,null);
  const result=await new Promise(resolve=>{first.runner.send=message=>{if(message.type==='exit')resolve(message);};first.runner.start({name:'Second',executable:process.execPath,args:['--version']},context);});assert.equal(result.code,0);
});
