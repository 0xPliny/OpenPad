const path=require('node:path'),{Worker}=require('node:worker_threads');
const {readMcpWorkspaceFile}=require('./mcp-workspace.cjs');
const {ContextMeterRunner}=require('./context-meter-runner.cjs');
const {ContextCorpusRunner}=require('./context-corpus-runner.cjs');
const string=(maxLength=2048)=>({type:'string',maxLength}),integer=(maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum:0,maximum});
const tokenizer={enum:['o200k_base','cl100k_base','chars4']},object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const textSource={text:string(65536),path:string(),name:string(256)};
const sourceChoice={oneOf:[{properties:{text:{}},required:['text']},{properties:{path:{}},required:['path']}]};
const MAX_OUTPUT=80*1024;
function validOutput(value,schema){
  if(schema.anyOf)return schema.anyOf.some(branch=>validOutput(value,branch));
  if(schema.const!==undefined&&value!==schema.const||schema.enum&&!schema.enum.includes(value))return false;
  if(schema.type==='string')return typeof value==='string'&&value.isWellFormed()&&value.length<=(schema.maxLength??Infinity)&&(!schema.pattern||new RegExp(schema.pattern).test(value));
  if(schema.type==='integer')return Number.isSafeInteger(value)&&value>=(schema.minimum??-Infinity)&&value<=(schema.maximum??Infinity);
  if(schema.type==='boolean')return typeof value==='boolean';
  if(schema.type==='array')return Array.isArray(value)&&value.length<=(schema.maxItems??Infinity)&&value.every(item=>validOutput(item,schema.items));
  if(schema.type==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&(schema.required||[]).every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>Object.hasOwn(schema.properties,key)&&validOutput(value[key],schema.properties[key]));
  return schema.const!==undefined||!!schema.enum;
}
function provenanceEvent(event){
  const result={id:event.id,type:event.type,path:event.path,timestamp:event.timestamp};
  const fields=['ranges','afterTextHash','rangeReason'],present=fields.filter(key=>Object.hasOwn(event,key));
  if(!present.length)return result;
  if(present.length!==fields.length||event.type==='issue')throw new Error('INVALID_PROVENANCE_RANGES');
  if(event.type==='delete'?event.afterTextHash!==null:typeof event.afterTextHash!=='string'||!/^[a-f0-9]{64}$/.test(event.afterTextHash))throw new Error('INVALID_PROVENANCE_HASH');
  if(event.ranges===null){
    if(!['previous-snapshot-unavailable','session-boundary','no-text-change'].includes(event.rangeReason))throw new Error('INVALID_PROVENANCE_RANGE_REASON');
    return {...result,ranges:null,afterTextHash:event.afterTextHash,rangeReason:event.rangeReason};
  }
  const range=event.ranges,interval=value=>value&&Number.isSafeInteger(value.fromLine)&&value.fromLine>=1&&Number.isSafeInteger(value.toLine)&&value.toLine>=value.fromLine;
  if(!range||!interval(range.before)||!interval(range.after)||range.before.fromLine!==range.after.fromLine||event.rangeReason!==null||typeof range.approximate!=='boolean')throw new Error('INVALID_PROVENANCE_RANGES');
  const deletion=range.after.fromLine===range.after.toLine&&range.before.fromLine<range.before.toLine;
  if(deletion?(!Number.isSafeInteger(range.deletionAnchor)||range.deletionAnchor<1):range.deletionAnchor!==null)throw new Error('INVALID_PROVENANCE_ANCHOR');
  if(event.lines!==undefined||event.lineDelta!==undefined){
    const beforeLines=event.lines-event.lineDelta;
    if(!Number.isSafeInteger(event.lines)||event.lines<0||!Number.isSafeInteger(event.lineDelta)||!Number.isSafeInteger(beforeLines)||beforeLines<0||range.before.toLine>beforeLines+1||range.after.toLine>event.lines+1||(deletion&&range.deletionAnchor>Math.max(1,event.lines)))throw new Error('INVALID_PROVENANCE_BOUNDS');
  }
  return {...result,ranges:{before:{fromLine:range.before.fromLine,toLine:range.before.toLine},after:{fromLine:range.after.fromLine,toLine:range.after.toLine},deletionAnchor:range.deletionAnchor,approximate:range.approximate},afterTextHash:event.afterTextHash,rangeReason:null};
}
class McpContextService{
  constructor({watch,getScope,openFile,revealRange,setStatus,getProvenance}){
    this.watch=watch;this.getScope=getScope;this.callbacks={openFile,revealRange,setStatus,getProvenance};this.generation=watch.generation;this.root=watch.status().root;this.closed=false;this.jobs=new Set();
  }
  check(signal){if(signal?.aborted||this.closed)throw new Error('CANCELLED');const status=this.watch.status();if(!status.running||this.watch.generation!==this.generation||status.root!==this.root)throw new Error('WORKSPACE_CHANGED');}
  stop(){this.closed=true;for(const cancel of this.jobs)cancel();this.jobs.clear();}
  async source(args,signal){
    this.check(signal);if((typeof args.text==='string')===(typeof args.path==='string'))throw new Error('USE_TEXT_OR_PATH');
    if(typeof args.path==='string'){const read=await readMcpWorkspaceFile(this.watch,args.path,signal);this.check(signal);return {text:read.text,name:path.basename(read.path),basis:'disk-snapshot',read};}
    if(!args.text.isWellFormed()||Buffer.byteLength(args.text)>65536)throw new Error('TEXT_LIMIT');return {text:args.text,name:args.name||'',basis:'provided-text'};
  }
  async runWorker(runner,request,signal){
    this.check(signal);const cancel=()=>runner.close();this.jobs.add(cancel);signal?.addEventListener('abort',cancel,{once:true});
    try{const result=await runner.run({requestId:1,...request});this.check(signal);if(result.error||result.cancelled)throw new Error('CONTEXT_OPERATION_FAILED');return result;}
    finally{signal?.removeEventListener('abort',cancel);this.jobs.delete(cancel);runner.close();}
  }
  async lint(args,signal){
    this.check(signal);let worker,timer,cancel;
    const result=await new Promise((resolve,reject)=>{
      worker=new Worker("const {parentPort,workerData}=require('node:worker_threads');try{parentPort.postMessage({result:require(workerData.module).lintContext(workerData.args)});}catch{parentPort.postMessage({error:true});}",{eval:true,workerData:{module:path.join(__dirname,'context-lint.cjs'),args},resourceLimits:{maxOldGenerationSizeMb:128}});
      let done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);worker.terminate().catch(()=>{});error?reject(new Error(error)):resolve(value);};
      cancel=()=>finish('CANCELLED');this.jobs.add(cancel);signal?.addEventListener('abort',cancel,{once:true});
      timer=setTimeout(()=>finish('LINT_TIMEOUT'),10000);worker.once('message',message=>message.error?finish('LINT_FAILED'):finish(null,message.result));worker.once('error',()=>finish('LINT_FAILED'));worker.once('exit',()=>finish('LINT_FAILED'));
      if(signal?.aborted||this.closed)cancel();
    }).finally(()=>{signal?.removeEventListener('abort',cancel);this.jobs.delete(cancel);});this.check(signal);return result;
  }
  trim(result,field){while(result[field].length&&Buffer.byteLength(JSON.stringify(result))>MAX_OUTPUT){result[field].pop();result.truncated=true;}return result;}
  tool(name,description,inputSchema,outputSchema,operation){return {name,description,inputSchema,outputSchema,handler:async(args,{signal}={})=>{
    this.check(signal);const local=new AbortController(),cancel=()=>local.abort();this.jobs.add(cancel);signal?.addEventListener('abort',cancel,{once:true});
    try{const result=await operation(args,local.signal);this.check(local.signal);if(!validOutput(result,outputSchema))throw new Error('INVALID_SERVICE_RESULT');if(Buffer.byteLength(JSON.stringify(result))>MAX_OUTPUT)throw new Error('RESULT_LIMIT');return result;}
    finally{signal?.removeEventListener('abort',cancel);this.jobs.delete(cancel);}
  }};}
  tools(){
    const basis={enum:['provided-text','disk-snapshot']},hash={type:'string',pattern:'^[a-f0-9]{64}$'},boolean={type:'boolean'};
    const line={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},interval=object({fromLine:line,toLine:line},['fromLine','toLine']);
    const ranges={anyOf:[{const:null},object({before:interval,after:interval,deletionAnchor:{anyOf:[{const:null},line]},approximate:boolean},['before','after','deletionAnchor','approximate'])]};
    const eventSchema=object({id:integer(),type:{enum:['create','modify','delete','issue']},path:string(),timestamp:string(40),ranges,afterTextHash:{anyOf:[hash,{const:null}]},rangeReason:{enum:[null,'previous-snapshot-unavailable','session-boundary','no-text-change']}},['id','type','path','timestamp']);
    return [
      this.tool('count_tokens','Count a supplied text or watched relative file using a named tokenizer. Example: {path:"AGENTS.md",tokenizer:"o200k_base"}. Optional section selects one uniquely named Markdown heading; no document text is returned.',{...object({...textSource,tokenizer,section:string(256)}),...sourceChoice},object({total:integer(),tokenizer,approximate:boolean,basis,lines:integer(),section:object({line:integer(),from:integer(),to:integer()},['line','from','to']),note:string(500)},['total','tokenizer','approximate','basis','lines','note']),async(args,signal)=>{
        const source=await this.source(args,signal),result=await this.runWorker(new ContextMeterRunner(),{text:source.text,tokenizer:args.tokenizer||'o200k_base'},signal);let total=result.total,section;
        if(args.section!==undefined){const matches=result.sections.filter(item=>item.level>0&&item.title===args.section);if(matches.length!==1)throw new Error('SECTION_NOT_UNIQUE');const match=matches[0];total=match.tokens;section={line:match.line,from:match.from,to:match.to};}
        return {total,tokenizer:result.tokenizer,approximate:result.approximate,basis:source.basis,lines:result.lines,...(section?{section}:{}),note:(result.approximate?'Heuristic Unicode code points / 4; not an exact model tokenizer. ':'Exact selected encoding; ')+ 'chat/tool framing excluded. Section subtrees overlap and are not additive.'};
      }),
      this.tool('lint_agent_file','Return advisory findings for supplied text or a watched relative file. Example: {path:"AGENTS.md",lineBudget:300}. Budgets are caller preferences, not mandatory file rules. Token budgets measure source text with tokenizer (default o200k_base); dates require today plus dateAgeDays.',{...object({...textSource,tokenizer,tokenBudget:integer(),lineBudget:integer(),today:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},dateAgeDays:integer(),limit:{type:'integer',minimum:1,maximum:100}}),...sourceChoice},object({basis,recognized:boolean,lines:integer(),findings:{type:'array',maxItems:100,items:object({id:string(128),code:string(64),severity:{const:'advisory'},message:string(500),line:integer(),from:integer(),to:integer(),confidence:string(64)},['id','code','severity','message','line','from','to','confidence'])},truncated:boolean,note:string(500)},['basis','recognized','lines','findings','truncated','note']),async(args,signal)=>{
        const source=await this.source(args,signal),limit=args.limit??100;if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('INVALID_LIMIT');
        const measured=args.tokenBudget!==undefined?await this.runWorker(new ContextMeterRunner(),{text:source.text,tokenizer:args.tokenizer||'o200k_base'},signal):null;
        const result=await this.lint({text:source.text,name:source.name,tokenCount:measured?.total,tokenBudget:args.tokenBudget,lineBudget:args.lineBudget,today:args.today,dateAgeDays:args.dateAgeDays},signal);
        return this.trim({basis:source.basis,recognized:result.recognized,lines:result.lines,findings:result.findings.slice(0,limit).map(f=>({id:f.id,code:f.code,severity:'advisory',message:(f.code==='token-budget'&&measured?`Measured ${measured.total} tokens using ${measured.tokenizer}${measured.approximate?' (heuristic)':''}; exceeds your configured budget of ${args.tokenBudget}.`:f.message).slice(0,500).toWellFormed(),line:f.line,from:f.from,to:f.to,confidence:f.code==='token-budget'&&measured?(measured.approximate?'heuristic':'measured-count'):f.confidence||'advisory'})),truncated:result.truncated||result.findings.length>limit,note:result.note.slice(0,500)},'findings');
      }),
      this.tool('get_context_budget','Count successful UTF-8 file snapshots in the native-selected watch scope. Example: {tokenizer:"cl100k_base",limit:20}. Reports heaviest files and incomplete coverage; it does not read unsaved buffers.',object({tokenizer,limit:{type:'integer',minimum:1,maximum:100}}),object({total:integer(),tokenizer,approximate:boolean,basis:{const:'disk-snapshots'},writer:{const:'unknown'},fileCount:integer(),files:{type:'array',maxItems:100,items:object({path:string(),tokens:integer(),bytes:integer(),lines:integer()},['path','tokens','bytes','lines'])},skippedCount:integer(),incomplete:boolean,truncated:boolean,note:string(500)},['total','tokenizer','approximate','basis','writer','fileCount','files','skippedCount','incomplete','truncated','note']),async(args,signal)=>{
        const scope=structuredClone(this.getScope()),limit=args.limit??20;if(!scope||scope.root!==this.root)throw new Error('WORKSPACE_CHANGED');if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('INVALID_LIMIT');
        await this.watch.safe('');this.check(signal);
        const result=await this.runWorker(new ContextCorpusRunner(10000),{root:scope.root,include:scope.include,exclude:scope.exclude,tokenizer:args.tokenizer||'o200k_base'},signal);
        await this.watch.safe('');this.check(signal);
        return this.trim({total:result.total,tokenizer:result.tokenizer,approximate:result.approximate,basis:'disk-snapshots',writer:'unknown',fileCount:result.files.length,files:result.files.slice(0,limit).map(({path,tokens,bytes,lines})=>({path,tokens,bytes,lines})),skippedCount:result.skippedCount,incomplete:result.incomplete,truncated:result.files.length>limit,note:'Counts cover successful individual disk snapshots, not an atomic folder snapshot or unsaved buffers. Chat/tool framing excluded.'},'files');
      }),
      this.tool('open_file','Open a watched relative UTF-8 file in OpenPad. Example: {path:"AGENTS.md"}. Existing dirty buffers are preserved; the result contains editor metadata only.',object({path:string()},['path']),object({opened:{const:true},documentId:string(128),basis:{const:'open-buffer'},textHash:hash,lines:integer()},['opened','documentId','basis','textHash','lines']),async(args,signal)=>{const read=await readMcpWorkspaceFile(this.watch,args.path,signal);this.check(signal);const result=await this.callbacks.openFile(read,{signal});return {opened:result.opened,documentId:result.documentId,basis:result.basis,textHash:result.textHash,lines:result.lines};}),
      this.tool('reveal_range','Reveal inclusive 1-based lines in a watched file without editing. Example: {path:"AGENTS.md",fromLine:5,toLine:8,expectedTextHash:"..."}. An expected normalized buffer hash rejects stale selections.',object({path:string(),fromLine:{type:'integer',minimum:1},toLine:{type:'integer',minimum:1},expectedTextHash:hash},['path','fromLine','toLine']),object({revealed:{const:true},documentId:string(128),basis:{const:'open-buffer'},textHash:hash,fromLine:integer(),toLine:integer()},['revealed','documentId','basis','textHash','fromLine','toLine']),async(args,signal)=>{
        if(!Number.isSafeInteger(args.fromLine)||!Number.isSafeInteger(args.toLine)||args.fromLine<1||args.toLine<args.fromLine)throw new Error('INVALID_RANGE');if(args.expectedTextHash!==undefined&&(typeof args.expectedTextHash!=='string'||!/^[a-f0-9]{64}$/.test(args.expectedTextHash)))throw new Error('INVALID_HASH');const read=await readMcpWorkspaceFile(this.watch,args.path,signal);this.check(signal);
        const result=await this.callbacks.revealRange(read,{fromLine:args.fromLine,toLine:args.toLine,expectedTextHash:args.expectedTextHash},{signal});return {revealed:result.revealed,documentId:result.documentId,basis:result.basis,textHash:result.textHash,fromLine:result.fromLine,toLine:result.toLine};
      }),
      this.tool('set_status','Show a short temporary status message in OpenPad. Example: {message:"Reviewing AGENTS.md"}. This does not change files or acknowledge reviews.',object({message:string(200)},['message']),object({updated:{const:true}},['updated']),async(args,signal)=>{if(typeof args.message!=='string'||args.message.length>200||/[\x00-\x1f\x7f]/.test(args.message))throw new Error('INVALID_STATUS');const result=await this.callbacks.setStatus({message:args.message},{signal});return {updated:result.updated};}),
      this.tool('get_session_provenance','List bounded metadata for the current observed watch session. Example: {limit:20}. Available before/after ranges use 1-based lines with exclusive toLine; null ranges have an explicit reason. Writer identity is unknown.',object({limit:{type:'integer',minimum:1,maximum:100}}),object({sessionId:string(128),writer:{const:'unknown'},complete:boolean,events:{type:'array',maxItems:100,items:eventSchema},truncated:boolean,note:string(500)},['sessionId','writer','complete','events','truncated','note']),async(args,signal)=>{
        const limit=args.limit??20;if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('INVALID_LIMIT');const result=await this.callbacks.getProvenance({limit},{signal});
        if(!result||!Array.isArray(result.events)||result.events.length>10000)throw new Error('INVALID_PROVENANCE');
        return this.trim({sessionId:result.sessionId,writer:'unknown',complete:result.complete===true,events:result.events.slice(-limit).map(provenanceEvent),truncated:result.events.length>limit,note:'Observed metadata, not a complete audit trail; writer unknown. Before/after use 1-based [fromLine,toLine) intervals; deletionAnchor is a 1-based display line. Missing range fields mean no recorded range metadata; null ranges carry rangeReason. afterTextHash hashes decoded UTF-8 normalized to LF, and is null for deletion. Hashes describe observations, not necessarily current disk or buffer text.'},'events');
      })
    ];
  }
}
module.exports={McpContextService};
