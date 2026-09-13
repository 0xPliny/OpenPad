const {_electron:electron}=require('playwright');
const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');
const {pollDesktop}=require('./desktop-poll.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-mcp-ui-')),folder=path.join(root,'workspace'),file=path.join(folder,'AGENTS.md'),profile=path.join(root,'profile');let app,client;
  await fs.mkdir(folder);await fs.writeFile(file,'# Rules\nOriginal context\nThird line\n');await fs.writeFile(path.join(folder,'count.md'),'2 + 2 = 4');
  await fs.writeFile(path.join(folder,'id_rsa.md'),'Synthetic excluded fixture.');
  async function launch(){app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[file]}:{args:[path.resolve('.'),file]}),env:{...process.env,OPENPAD_USER_DATA:profile}});const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.waitForSelector('body[data-ready="true"]');await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);return page;}
  const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
  try{
    let page=await launch();assert.equal((await page.evaluate(()=>window.desktop.mcpState())).running,false);
    await command('contextWatch');await page.getByRole('button',{name:'Choose watch folder',exact:true}).click();await pollDesktop(page,async()=>{const state=await window.desktop.contextWatchState();return state.status.complete;});
    await command('mcp');await page.getByRole('button',{name:'Enable / rotate token',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#mcp-token').value.length>0);
    const url=await page.locator('#mcp-url').inputValue(),token=await page.locator('#mcp-token').inputValue();assert.equal(new URL(url).hostname,'127.0.0.1');await page.locator('#dialog-close').click();
    client=new Client({name:'openpad-desktop-test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const tools=(await client.listTools()).tools.map(tool=>tool.name).sort();assert.deepEqual(tools,['count_tokens','get_context_budget','get_session_provenance','lint_agent_file','open_file','reveal_range','set_status']);
    const call=(name,args)=>client.callTool({name,arguments:args});let result=await call('count_tokens',{path:'count.md',tokenizer:'cl100k_base'});assert.equal(result.structuredContent.total,7);assert.equal(result.structuredContent.basis,'disk-snapshot');
    await page.locator('#editor .cm-content').fill('Unsaved context\nSecond line\n');result=await call('open_file',{path:'AGENTS.md'});assert.equal(result.isError,undefined);const opened=result.structuredContent;assert.equal(opened.basis,'open-buffer');assert.equal(await page.locator('#editor .cm-content').textContent(),'Unsaved contextSecond line');
    assert.equal((await call('reveal_range',{path:'AGENTS.md',fromLine:2,toLine:2,expectedTextHash:'0'.repeat(64)})).isError,true);
    result=await call('reveal_range',{path:'AGENTS.md',fromLine:2,toLine:2,expectedTextHash:opened.textHash});assert.equal(result.structuredContent.revealed,true);assert.equal(result.structuredContent.fromLine,2);
    const canary='MCP_STATUS_CANARY';assert.equal((await call('set_status',{message:canary})).structuredContent.updated,true);assert.equal(await page.locator('#mcp-agent-status').textContent(),'Agent: '+canary);
    result=await call('lint_agent_file',{path:'count.md',tokenBudget:1,tokenizer:'cl100k_base'});assert.equal(result.structuredContent.findings[0].code,'token-budget');
    result=await call('get_context_budget',{});assert.equal(result.structuredContent.fileCount,2);assert.equal(result.structuredContent.basis,'disk-snapshots');
    assert.equal((await call('open_file',{path:'../outside.md'})).isError,true);
    assert.equal((await call('open_file',{path:'id_rsa.md'})).isError,true);assert.equal((await call('count_tokens',{path:'id_rsa.md'})).isError,true);
    await fs.writeFile(path.join(folder,'count.md'),'disk update');await pollDesktop(page,async()=>{const state=await window.desktop.contextWatchState();return state.events.some(event=>event.path==='count.md'&&event.type==='modify');});result=await call('get_session_provenance',{});assert.equal(result.structuredContent.writer,'unknown');assert.equal(result.structuredContent.events.some(event=>event.path==='count.md'),true);
    const observed=result.structuredContent.events.find(event=>event.path==='count.md'&&event.type==='modify');assert.deepEqual(observed.ranges,{before:{fromLine:1,toLine:2},after:{fromLine:1,toLine:2},deletionAnchor:null,approximate:false});assert.equal(observed.rangeReason,null);assert.equal(observed.afterTextHash,require('node:crypto').createHash('sha256').update('disk update').digest('hex'));
    await command('mcp');assert.equal((await call('open_file',{path:'count.md'})).isError,true);await page.locator('#dialog-close').click();assert.equal((await call('open_file',{path:'count.md'})).structuredContent.opened,true);await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('count.md'));assert.equal(await page.locator('#editor .cm-content').textContent(),'disk update');
    const logs=JSON.stringify((await page.evaluate(()=>window.desktop.mcpState())).logs);for(const secret of [token,canary,'AGENTS.md','count.md','Unsaved context'])assert.equal(logs.includes(secret),false);
    await page.evaluate(()=>window.desktop.contextWatchStop());await pollDesktop(page,async()=>!(await window.desktop.mcpState()).running);await client.close();client=null;
    let denied=false;try{const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{"jsonrpc":"2.0","id":99,"method":"ping"}',signal:AbortSignal.timeout(2000)});denied=!response.ok;}catch{denied=true;}assert.equal(denied,true);assert.equal(await page.locator('#mcp-agent-status').textContent(),'');
    await command('quit');await app.close();app=null;page=await launch();assert.equal((await page.evaluate(()=>window.desktop.mcpState())).running,false);assert.equal(await fs.readFile(file,'utf8'),'# Rules\nOriginal context\nThird line\n');
    console.log('PASS: opt-in actual MCP client tools, exact counts, dirty-buffer preservation, stale selection refusal, status labeling, scoped reads, redacted metadata, modal refusal/reopen and watch-stop/restart revocation.');
  }finally{await client?.close().catch(()=>{});if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
