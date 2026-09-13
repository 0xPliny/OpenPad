const test=require('node:test'),assert=require('node:assert/strict');
const {McpEditorBridge}=require('../src/mcp-editor-bridge.cjs');
test('editor requests correlate replies, ignore late replies and cancel on scope stop',async()=>{
  const sent=[],bridge=new McpEditorBridge((type,data)=>sent.push({type,data})),signal=new AbortController();
  const first=bridge.call('set_status',{text:'test'},signal.signal),id=sent[0].data.id;assert.equal(bridge.receive({id:'wrong',result:{}}),false);assert.equal(bridge.receive({id,result:{shown:true}}),true);assert.deepEqual(await first,{shown:true});assert.equal(bridge.receive({id,result:{}}),false);
  const second=bridge.call('reveal_range',{},signal.signal);signal.abort();await assert.rejects(second,/CANCELLED/);assert.equal(sent.at(-1).type,'mcp-cancel');
  const third=bridge.call('open_file',{});bridge.cancelAll();await assert.rejects(third,/CANCELLED/);assert.equal(bridge.pending.size,0);
});
test('editor bridge rejects unknown operations, bounds inflight calls and sanitizes errors',async()=>{
  const sent=[],bridge=new McpEditorBridge((type,data)=>sent.push({type,data}));await assert.rejects(bridge.call('save',{}),/UNSUPPORTED/);
  const pending=Array.from({length:4},()=>bridge.call('open_file',{}));await assert.rejects(bridge.call('open_file',{}),/BUSY/);for(const message of sent)bridge.receive({id:message.data.id,error:'private-path-secret'});for(const promise of pending)await assert.rejects(promise,error=>error.message==='EDITOR_UNAVAILABLE');
});
