const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {McpContextService}=require('../src/mcp-context-service.cjs'),{ContextWatch}=require('../src/context-watch.cjs');
async function fixture(t,callbacks={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-mcp-service-'));await fs.writeFile(path.join(root,'AGENTS.md'),'# One\nhello\n\n# Empty\n');await fs.writeFile(path.join(root,'counts.md'),'2 + 2 = 4');
  const watch=new ContextWatch();await watch.start(root,{include:['**/*.md']});
  const service=new McpContextService({watch,getScope:()=>({root:watch.status().root,include:['**/*.md'],exclude:[]}),openFile:async read=>({opened:true,documentId:'doc',basis:'open-buffer',textHash:read.normalizedTextHash,lines:read.document.text.split('\n').length}),revealRange:async(read,args)=>({revealed:true,documentId:'doc',basis:'open-buffer',textHash:read.normalizedTextHash,fromLine:args.fromLine,toLine:args.toLine}),setStatus:async()=>({updated:true}),getProvenance:async()=>({sessionId:watch.status().sessionId,events:watch.getEvents(),complete:watch.status().complete}),...callbacks});
  t.after(async()=>{service.stop();await watch.stop();await fs.rm(root,{recursive:true,force:true});});
  const tools=Object.fromEntries(service.tools().map(tool=>[tool.name,tool]));return {root,watch,service,tools,call:(name,args,signal)=>tools[name].handler(args,{signal})};
}
test('seven explicit tools count supplied text/disk/unique heading without returning document text',async t=>{
  const {service,call}=await fixture(t);assert.equal(service.tools().length,7);
  const text=await call('count_tokens',{text:'antidisestablishmentarianism',tokenizer:'cl100k_base'});assert.equal(text.total,6);assert.equal(text.basis,'provided-text');
  const file=await call('count_tokens',{path:'counts.md',tokenizer:'o200k_base'});assert.equal(file.total,7);assert.equal(file.basis,'disk-snapshot');assert.equal(file.text,undefined);
  const section=await call('count_tokens',{path:'AGENTS.md',section:'One',tokenizer:'chars4'});assert.equal(section.section.line,1);assert.equal(section.section.from,0);assert.equal(section.total,4);
  await assert.rejects(call('count_tokens',{text:'# A\nx\n# A\ny',section:'A'}),/SECTION_NOT_UNIQUE/);await assert.rejects(call('count_tokens',{text:'x',path:'counts.md'}),/USE_TEXT_OR_PATH/);
});
test('lint and corpus reports are bounded with explicit basis and incomplete coverage',async t=>{
  const {root,call}=await fixture(t);const lint=await call('lint_agent_file',{path:'AGENTS.md',limit:1});assert.equal(lint.basis,'disk-snapshot');assert.equal(lint.findings.length,1);assert.ok(lint.findings[0].message.length<=500);
  await fs.writeFile(path.join(root,'bad.md'),Buffer.from([255]));const budget=await call('get_context_budget',{tokenizer:'chars4',limit:1});assert.equal(budget.files.length,1);assert.equal(budget.fileCount,2);assert.equal(budget.incomplete,true);assert.equal(budget.basis,'disk-snapshots');assert.equal(budget.writer,'unknown');assert.equal(budget.truncated,true);
});
test('workspace authorization precedes editor callbacks and expected hash is forwarded',async t=>{
  let opened=0,expected;const {call}=await fixture(t,{openFile:async read=>{opened++;return {opened:true,documentId:'doc',basis:'open-buffer',textHash:read.normalizedTextHash,lines:1};},revealRange:async(read,args)=>{expected=args.expectedTextHash;return {revealed:true,documentId:'doc',basis:'open-buffer',textHash:read.normalizedTextHash,fromLine:args.fromLine,toLine:args.toLine};}});
  await assert.rejects(call('open_file',{path:'../outside.md'}),/INVALID_WORKSPACE_PATH/);await assert.rejects(call('open_file',{path:'.env'}),/FILE_NOT_IN_WATCH_SCOPE/);assert.equal(opened,0);
  const result=await call('open_file',{path:'AGENTS.md'});assert.equal(opened,1);assert.equal(result.text,undefined);
  await call('reveal_range',{path:'AGENTS.md',fromLine:1,toLine:2,expectedTextHash:'a'.repeat(64)});assert.equal(expected,'a'.repeat(64));await assert.rejects(call('reveal_range',{path:'AGENTS.md',fromLine:2,toLine:1}),/INVALID_RANGE/);
  await assert.rejects(call('set_status',{message:'bad\nstatus'}),/INVALID_STATUS/);assert.deepEqual(await call('set_status',{message:'Reviewing'}),{updated:true});
});
test('provenance strips contents/messages and callback outputs are schema validated',async t=>{
  const {call}=await fixture(t,{getProvenance:async()=>({sessionId:'session',complete:false,events:Array.from({length:150},(_,i)=>({id:i,type:'modify',path:'AGENTS.md',timestamp:'2026-09-12T00:00:00.000Z',message:'SECRET',text:'SECRET'}))}),setStatus:async()=>({updated:'SECRET'})});
  const result=await call('get_session_provenance',{limit:100});assert.equal(result.events.length,100);assert.equal(result.truncated,true);assert.equal(result.writer,'unknown');assert.equal(JSON.stringify(result).includes('SECRET'),false);await assert.rejects(call('set_status',{message:'hello'}),/INVALID_SERVICE_RESULT/);
});
test('concurrent worker calls do not cancel each other; abort and changed scope reject stale results',async t=>{
  const {call,watch,service}=await fixture(t);
  const [a,b]=await Promise.all([call('count_tokens',{text:'2 + 2 = 4',tokenizer:'cl100k_base'}),call('count_tokens',{text:'antidisestablishmentarianism',tokenizer:'o200k_base'})]);assert.equal(a.total,7);assert.equal(b.total,6);
  const controller=new AbortController(),pending=call('count_tokens',{text:'hello'},controller.signal);controller.abort();await assert.rejects(pending,/CANCELLED/);
  const stale=call('count_tokens',{text:'hello'});watch.generation++;await assert.rejects(stale,/WORKSPACE_CHANGED/);service.stop();await assert.rejects(call('set_status',{message:'x'}),/CANCELLED/);
});
test('service stop aborts injected editor operations as well as workers',async t=>{
  let ready,aborted=false;const started=new Promise(resolve=>ready=resolve);
  const {call,service}=await fixture(t,{setStatus:async(_args,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve({updated:true});});ready();})});
  const pending=call('set_status',{message:'Pending'});await started;service.stop();await assert.rejects(pending,/CANCELLED/);assert.equal(aborted,true);
});
test('lint token budgets measure actual text and schema rejects caller-supplied counts',async t=>{
  const {tools,call}=await fixture(t),Ajv=require('ajv'),ajv=new Ajv({strict:true});
  for(const tool of Object.values(tools)){ajv.compile(tool.inputSchema);ajv.compile(tool.outputSchema);}
  const valid=ajv.compile(tools.lint_agent_file.inputSchema);assert.equal(valid({text:'2 + 2 = 4',tokenBudget:1,tokenizer:'cl100k_base'}),true);assert.equal(valid({text:'2 + 2 = 4',tokenBudget:1,tokenCount:0}),false);
  for(const source of [{text:'2 + 2 = 4'},{path:'counts.md'}]){
    const result=await call('lint_agent_file',{...source,tokenBudget:1,tokenizer:'cl100k_base'}),finding=result.findings.find(f=>f.code==='token-budget');
    assert.ok(finding);assert.match(finding.message,/Measured 7 tokens using cl100k_base/);assert.equal(finding.confidence,'measured-count');assert.equal(result.text,undefined);
  }
  const heuristic=await call('lint_agent_file',{text:'2 + 2 = 4',tokenBudget:1,tokenizer:'chars4'});assert.equal(heuristic.findings[0].confidence,'heuristic');assert.match(heuristic.findings[0].message,/heuristic/);
  const controller=new AbortController(),pending=call('lint_agent_file',{text:'2 + 2 = 4',tokenBudget:1},controller.signal);controller.abort();await assert.rejects(pending,/CANCELLED/);
});
test('corpus budget rejects a replaced root while the original watch remains active',async t=>{
  const {root,watch,call}=await fixture(t),moved=root+'-original';t.after(()=>fs.rm(moved,{recursive:true,force:true}));
  await fs.rename(root,moved);await fs.mkdir(root);await fs.writeFile(path.join(root,'replacement.md'),'replacement tree');
  assert.equal(watch.status().running,true);await assert.rejects(call('get_context_budget',{tokenizer:'chars4'}),/root identity changed/);
});
test('corpus budget revalidates the original root after the worker completes',async t=>{
  const {root,watch,service,call}=await fixture(t),moved=root+'-original';t.after(()=>fs.rm(moved,{recursive:true,force:true}));
  const runWorker=service.runWorker.bind(service);service.runWorker=async(...args)=>{const result=await runWorker(...args);await fs.rename(root,moved);await fs.mkdir(root);await fs.writeFile(path.join(root,'replacement.md'),'replacement tree');return result;};
  await assert.rejects(call('get_context_budget',{tokenizer:'chars4'}),/root identity changed/);assert.equal(watch.status().running,true);
});
test('provenance preserves observed ranges, null reasons and omitted metadata without leaking text',async t=>{
  const base={type:'modify',path:'AGENTS.md',timestamp:'2026-09-12T00:00:00.000Z'},events=[
    {...base,id:1,lines:3,lineDelta:0,ranges:{before:{fromLine:2,toLine:3,text:'SECRET'},after:{fromLine:2,toLine:3},deletionAnchor:null,approximate:false,text:'SECRET'},afterTextHash:'a'.repeat(64),rangeReason:null,message:'SECRET'},
    {...base,id:2,ranges:null,afterTextHash:'b'.repeat(64),rangeReason:'previous-snapshot-unavailable'},
    {...base,id:3},
    {...base,id:4,type:'delete',lines:0,lineDelta:-3,ranges:{before:{fromLine:1,toLine:4},after:{fromLine:1,toLine:1},deletionAnchor:1,approximate:false},afterTextHash:null,rangeReason:null},
    {...base,id:5,ranges:null,afterTextHash:'c'.repeat(64),rangeReason:'no-text-change'}
  ];
  const {call,tools}=await fixture(t,{getProvenance:async()=>({sessionId:'session',complete:false,events})});
  const result=await call('get_session_provenance',{});assert.equal(result.writer,'unknown');assert.deepEqual(result.events[0].ranges,{before:{fromLine:2,toLine:3},after:{fromLine:2,toLine:3},deletionAnchor:null,approximate:false});assert.equal(result.events[0].afterTextHash,'a'.repeat(64));
  assert.equal(result.events[1].ranges,null);assert.equal(result.events[1].rangeReason,'previous-snapshot-unavailable');assert.equal(Object.hasOwn(result.events[2],'ranges'),false);assert.equal(Object.hasOwn(result.events[2],'afterTextHash'),false);
  assert.equal(result.events[3].afterTextHash,null);assert.equal(result.events[3].ranges.deletionAnchor,1);assert.equal(result.events[4].rangeReason,'no-text-change');assert.equal(JSON.stringify(result).includes('SECRET'),false);assert.match(result.note,/\[fromLine,toLine\)/);
  const Ajv=require('ajv'),validate=new Ajv({strict:true}).compile(tools.get_session_provenance.outputSchema);assert.equal(validate(result),true,JSON.stringify(validate.errors));
});
test('provenance rejects malformed ranges, incomplete metadata and mismatched deletion hashes',async t=>{
  let event;const {call}=await fixture(t,{getProvenance:async()=>({sessionId:'session',events:[event],complete:false})});
  const base={id:1,type:'modify',path:'AGENTS.md',timestamp:'2026-09-12T00:00:00.000Z',lines:3,lineDelta:0,ranges:{before:{fromLine:2,toLine:3},after:{fromLine:2,toLine:3},deletionAnchor:null,approximate:false},afterTextHash:'a'.repeat(64),rangeReason:null};
  for(const mutation of [e=>delete e.rangeReason,e=>e.ranges.before=null,e=>e.ranges.after.toLine=99,e=>e.afterTextHash=null,e=>e.ranges.deletionAnchor=2]){event=structuredClone(base);mutation(event);await assert.rejects(call('get_session_provenance',{}),/INVALID_PROVENANCE/);}
});
