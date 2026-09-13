const { app, BrowserWindow, Menu, dialog, ipcMain, clipboard, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { decode, writeDocument, hash } = require('./files.cjs');
const { SessionStore } = require('./session.cjs');
const { applyFiles } = require('./replacement-files.cjs');
const { renameDocument, checkDisk } = require('./file-operations.cjs');
const { printDocument } = require('./print.cjs');
const { parseLaunch } = require('./cli.cjs');
const {MarkRunner}=require('./mark-runner.cjs');
const {textMd5,fileChecksums}=require('./checksums.cjs');
const {readPage,pageBytes}=require('./large-file.cjs');
const {LargeSearchRunner}=require('./large-search-runner.cjs');
const {ContextMeterRunner}=require('./context-meter-runner.cjs');
const {ContextWatch}=require('./context-watch.cjs');
const {ContextCorpusSession}=require('./context-corpus-session.cjs');
const {ContextHistory}=require('./context-history.cjs');
const {ContextReviewStore}=require('./context-review.cjs');
const {ContextLintRunner}=require('./context-lint-runner.cjs');
const {McpLoopbackHost}=require('./mcp-host.cjs');
const {McpEditorBridge}=require('./mcp-editor-bridge.cjs');
const {McpContextService}=require('./mcp-context-service.cjs');
const {sessionReport}=require('./context-report.cjs');
const {within,latestRecorded,matchesText}=require('./context-observation.cjs');
let contextHistory,contextSessions=[],contextHistoryWarning='',contextHistoryTimer,contextHistoryMaxTimer;
let contextReview,reviewEnabled=false,reviewWarning='';
function retainReview(observation){if(reviewEnabled&&contextReview)contextReview.capture(observation).catch(error=>{reviewWarning=`Review snapshot was not retained: ${error.message}`;});}
function captureContextHistory(){const status=contextWatch.status();if(!status.root)return;const now=new Date().toISOString(),previous=contextSessions.find(session=>session.sessionId===status.sessionId);const session={root:status.root,sessionId:status.sessionId,sessionLabel:status.sessionLabel,startedAt:previous?.startedAt||now,updatedAt:now,status,events:contextWatch.getEvents()};contextSessions=[...contextSessions.filter(item=>item.sessionId!==session.sessionId),session].slice(-20);while(contextSessions.reduce((sum,item)=>sum+item.events.length,0)>10000)contextSessions.shift();}
async function saveContextHistory(){clearTimeout(contextHistoryTimer);clearTimeout(contextHistoryMaxTimer);contextHistoryMaxTimer=null;if(!contextHistory)return;captureContextHistory();try{await contextHistory.save({sessions:contextSessions});contextHistoryWarning='';}catch(error){contextHistoryWarning=`Activity history was not saved: ${error.message}`;}}
function scheduleContextHistory(){if(!contextHistory||!contextWatch.status().root)return;captureContextHistory();clearTimeout(contextHistoryTimer);contextHistoryTimer=setTimeout(saveContextHistory,500);if(!contextHistoryMaxTimer)contextHistoryMaxTimer=setTimeout(saveContextHistory,3000);}
const contextMeter=new ContextMeterRunner();
const contextLint=new ContextLintRunner();
const contextCorpus=new ContextCorpusSession();
const contextWatch=new ContextWatch({onObservation:retainReview,onStatus:status=>{if(!status.running){contextCorpus.invalidate();if(mcpHost||mcpService)void stopMcp().catch(()=>{});}scheduleContextHistory();if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('context-watch-event',{status});},onEvent:event=>{if(event.type==='issue'&&['watch','start'].includes(event.code))contextCorpus.invalidate();scheduleContextHistory();if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('context-watch-event',{event,status:contextWatch.status()});}});
const largeSearch=new LargeSearchRunner();
const markRunner=new MarkRunner();
const { replaceFile } = require('./replace-file.cjs');
const {CommandRunner,validateCommand}=require('./command-runner.cjs');
if (process.env.OPENPAD_USER_DATA) app.setPath('userData', process.env.OPENPAD_USER_DATA);
let win, store, initial, workspace, searchWorker,commandRunner;
let replacementJob, replacementPlan, replacementApplying = false;
function cancelReplacement() {
  replacementPlan = null;
  if (replacementJob) { const job = replacementJob; replacementJob = null; job.finish({cancelled:true}); job.worker.terminate(); }
}
let rendererReady = false;
const pendingFiles = [];
function launchFiles(argv, cwd) {
  try{return parseLaunch(argv.slice(process.defaultApp ? 2 : 1),cwd);}catch(error){return [{error:error.message}];}
}
function enqueueFiles(files) {
  pendingFiles.push(...files);
  if (rendererReady) command('open-external');
}
const startupFiles = launchFiles(process.argv,process.cwd());
const primaryInstance = app.requestSingleInstanceLock({ files:startupFiles });
if (!primaryInstance) app.quit();
else {
  enqueueFiles(startupFiles);
  app.on('second-instance', (_event, argv, cwd, data) => {
    enqueueFiles(Array.isArray(data?.files) ? data.files : launchFiles(argv,cwd));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('open-file', (event, file) => { event.preventDefault(); enqueueFiles([file]); });
}
let closing = false;
const documents = new Map();
const previews=new Map();
async function previewPage(id,offset=0,version){const file=previews.get(id);if(!file)throw new Error('Preview was closed; open the file again.');const {text,...preview}=await readPage(file,offset,pageBytes,version);return {id,name:`${path.basename(file)} (preview)`,text:text.replace(/\r\n?/g,'\n'),readOnly:true,large:true,preview,previewPath:file,previewInfo:`Read-only UTF-8 preview: bytes ${preview.offset.toLocaleString()}–${preview.end.toLocaleString()} of ${preview.size.toLocaleString()}. Page-local Find; whole-file exact search in toolbar. No editing.`};}
const monitorReads = new Map();
const allowedPaths = new Set();
const pathKey = file => process.platform === 'win32' ? file.toLowerCase() : file;
let mcpHost=null,mcpService=null,mcpGeneration=0,mcpLogs=[];
const mcpBridge=new McpEditorBridge((channel,value)=>{if(!win||win.isDestroyed()||win.webContents.isDestroyed())throw new Error('EDITOR_UNAVAILABLE');win.webContents.send(channel,value);});
function mcpState(){return {...(mcpHost?.status()||{running:false,url:null,active:0,inFlightTools:0,logSuppressed:0}),logs:mcpLogs.slice(-200)};}
function notifyMcp(){if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('mcp-state',mcpState());}
async function stopMcp(){mcpGeneration++;const host=mcpHost,service=mcpService;mcpHost=null;mcpService=null;mcpBridge.cancelAll();service?.stop();await host?.stop();notifyMcp();}
function mcpDocument(read,signal,create){
  if(signal?.aborted)throw new Error('CANCELLED');if(replacementApplying)throw new Error('EDITOR_BUSY');
  const existing=[...documents.values()].find(doc=>pathKey(doc.path)===pathKey(read.path));if(existing)return {...existing};
  if(!create)throw new Error('DOCUMENT_UNAVAILABLE');
  const doc={id:randomUUID(),...read.document,large:false};documents.set(doc.id,doc);allowedPaths.add(pathKey(doc.path));return {...doc};
}
async function startMcp(){
  await stopMcp();if(!contextWatch.status().running||!contextCorpus.scope)throw new Error('Start Agent Watch before enabling local MCP access.');
  const generation=mcpGeneration;const service=new McpContextService({watch:contextWatch,getScope:()=>contextCorpus.scope,
    openFile:(read,{signal})=>mcpBridge.call('open_file',{document:mcpDocument(read,signal,true)},signal),
    revealRange:(read,range,{signal})=>mcpBridge.call('reveal_range',{document:mcpDocument(read,signal,false),...range},signal),
    setStatus:(value,{signal})=>mcpBridge.call('set_status',value,signal),
    getProvenance:async(_request,{signal})=>{if(signal.aborted)throw new Error('CANCELLED');const status=contextWatch.status();return {sessionId:status.sessionId,events:contextWatch.getEvents(),complete:status.complete};}
  });
  const host=new McpLoopbackHost({onLog:entry=>{if(mcpHost!==host)return;mcpLogs.push(entry);mcpLogs=mcpLogs.slice(-200);notifyMcp();}});mcpLogs=[];mcpService=service;mcpHost=host;
  try{const connection=await host.start({tools:service.tools()});if(generation!==mcpGeneration||!contextWatch.status().running)throw new Error('MCP workspace changed while enabling.');notifyMcp();return {...mcpState(),...connection};}
  catch(error){service.stop();await host.stop();if(mcpHost===host){mcpHost=null;mcpService=null;}notifyMcp();throw error;}
}
ipcMain.on('mcp-reply',(event,value)=>{if(win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame)mcpBridge.receive(value);});
const MAX_EDIT_SIZE = 32 * 1024 * 1024;
function command(name) { win.webContents.send('command', name); }
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid caller');
    try { return await fn(...args); }
    catch (error) { await dialog.showMessageBox(win, { type: 'error', title: 'OpenPad', message: error.message }); return null; }
  });
}
async function readDocument(file, requested, id) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('Select a regular text file.');
  if (stat.size > MAX_EDIT_SIZE) throw new Error('Editable files are limited to 32 MiB. Use Open large file preview for larger files.');
  const decoded = decode(await fs.readFile(file), requested);
  return { id: id || randomUUID(), path: file, name: path.basename(file), ...decoded, large: stat.size > 1024 * 1024 };
}
async function openDocument(file, encoding,expectedHash) {
  if (replacementApplying) throw new Error('Wait for folder replacement to finish before opening a file.');
  file = await fs.realpath(file);
  const existing = [...documents.values()].find(d => pathKey(d.path) === pathKey(file));
  if (existing) return { id: existing.id };
  let doc;
  try { doc = await readDocument(file, encoding); }
  catch (error) {
    if (encoding || error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
    const choice = await dialog.showMessageBox(win, { type: 'question', message: 'This file is not valid UTF-8.', detail: 'Choose an explicit encoding; OpenPad will not guess using your Windows locale.', buttons: ['Windows-1252', 'UTF-16 LE', 'UTF-16 BE', 'Cancel'], cancelId: 3, defaultId: 3 });
    if (choice.response === 3) return null;
    doc = await readDocument(file, ['windows1252','utf16le','utf16be'][choice.response]);
  }
  if(expectedHash&&doc.hash!==expectedHash)throw new Error('The disk file changed after this search. Search again.');
  documents.set(doc.id, doc); allowedPaths.add(pathKey(file)); return doc;
}
async function listFolder(directory, depth = 0, result = []) {
  if (depth > 15 || result.length >= 10000) return result;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['.git','node_modules','dist','release'].includes(entry.name) || entry.isSymbolicLink()) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { try { await listFolder(file, depth + 1, result); } catch {} }
    else if (entry.isFile()) { result.push(file); allowedPaths.add(pathKey(file)); }
    if (result.length >= 10000) break;
  }
  return result;
}
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  store = new SessionStore(app.getPath('userData'));
  contextHistory=new ContextHistory(app.getPath('userData'));const recoveredContext=await contextHistory.load();contextSessions=recoveredContext.sessions;contextHistoryWarning=recoveredContext.warning||'';
  contextReview=new ContextReviewStore(app.getPath('userData'));const recoveredReview=await contextReview.load();reviewWarning=recoveredReview.warning||'';
  initial = await store.load();
  for (const doc of initial.docs) if (doc.path && !doc.readOnly) { documents.set(doc.id, doc); allowedPaths.add(pathKey(doc.path)); }
  win = new BrowserWindow({ width: 1280, height: 850, minWidth: 800, minHeight: 500, backgroundColor: '#15191f', title: 'OpenPad', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  commandRunner=new CommandRunner(message=>{if(!win.isDestroyed())win.webContents.send('command-result',message);});
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('render-process-gone',()=>{void stopMcp().catch(()=>{});});
  win.webContents.on('did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame&&mcpHost)void stopMcp().catch(()=>{});});
  win.on('close', event => { if (!closing) { event.preventDefault(); command('quit'); } });
  handle('bootstrap', () => ({ ...initial, recoveryWarning: store.warning }));
  handle('copy-text',text=>{if(typeof text!=='string')throw new Error('Invalid text');clipboard.writeText(text);return true;});
  handle('validate-commands',values=>{if(!Array.isArray(values)||values.length>30)throw new Error('Use a JSON array with at most 30 commands.');const definitions=values.map(validateCommand);if(new Set(definitions.map(d=>d.name)).size!==definitions.length)throw new Error('Command names must be unique.');return definitions;});
  handle('run-command',({definition,id,name,selection})=>{if(typeof selection!=='string'||selection.length>1024*1024)throw new Error('Selected text exceeds 1 MiB.');const doc=documents.get(id);return commandRunner.start(definition,{file:doc?.path,dir:doc?.path?path.dirname(doc.path):undefined,name:doc?.name||name,selection,workspace,inherit:process.cwd()});});
  handle('stop-command',id=>commandRunner.stop(id));
  handle('context-observation',async request=>{
    const doc=documents.get(request?.id);if(!doc||typeof request.text!=='string'||Buffer.byteLength(request.text,'utf8')>2*1024*1024)return null;
    let event;
    const watch=contextWatch.status(),inside=watch.root&&within(watch.root,doc.path);
    if(inside&&(watch.running||watch.issues>0))event=await contextWatch.latestObservation(doc.path);
    else event=latestRecorded(contextSessions,doc.path);
    return matchesText(event,request.text)?event:null;
  });
  handle('context-review-list',async()=>{try{await contextReview.flush();}catch(error){reviewWarning=error.message;}return {...contextReview.status(),records:contextReview.list(),warning:reviewWarning||contextReview.warning};});
  handle('context-review-get',key=>contextReview.get(key));
  handle('mcp-start',startMcp);
  handle('mcp-stop',stopMcp);
  handle('mcp-state',mcpState);
  handle('context-lint',request=>contextLint.run(request));
  handle('context-lint-cancel',id=>contextLint.cancel(id));
  handle('context-review-decide',request=>contextReview.decide(request));
  handle('context-corpus',request=>{if(!contextWatch.status().running){contextCorpus.invalidate();return {requestId:request?.requestId,error:'Choose an active watch folder before scanning.',incomplete:true};}return contextCorpus.run(request,progress=>{if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('context-corpus-progress',progress);});});
  handle('context-corpus-cancel',id=>contextCorpus.cancel(id));
  handle('context-corpus-open',async request=>{
    if(!contextWatch.status().running)throw new Error('The watch scope stopped; scan again.');
    if(replacementApplying)throw new Error('Wait for folder replacement before opening a result.');
    const data=await contextCorpus.open(request);
    const existing=[...documents.values()].find(doc=>pathKey(doc.path)===pathKey(data.path));
    if(existing)return {...existing,corpusText:data.corpusText};
    const {corpusText,...content}=data,doc={id:randomUUID(),...content,large:false};
    documents.set(doc.id,doc);allowedPaths.add(pathKey(doc.path));return {...doc,corpusText};
  });
  handle('context-meter',request=>contextMeter.run(request));
  handle('context-meter-cancel',id=>contextMeter.cancel(id));
  handle('context-watch-start',async options=>{const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(result.canceled)return null;contextCorpus.invalidate();reviewEnabled=false;await contextWatch.start(result.filePaths[0],options);reviewEnabled=options?.retainReview===true;await contextCorpus.setScope(contextWatch.status().root,options);return contextWatch.status();});
  handle('context-watch-stop',async()=>{reviewEnabled=false;contextCorpus.invalidate();await contextWatch.stop();await saveContextHistory();return contextWatch.status();});
  handle('context-watch-state',()=>({status:contextWatch.status(),events:contextWatch.getEvents(),reviewEnabled,historyWarning:contextHistoryWarning}));
  handle('context-history-export',async id=>{await saveContextHistory();const session=contextSessions.find(session=>session.sessionId===id);if(!session)throw new Error('This session is no longer retained.');const result=await dialog.showSaveDialog(win,{title:'Export to a new Markdown file',defaultPath:'OpenPad-session-report.md',filters:[{name:'Markdown',extensions:['md']}]});if(result.canceled)return null;const handle=await fs.open(result.filePath,'wx');try{await handle.writeFile(sessionReport(session),'utf8');await handle.sync();}finally{await handle.close();}return {path:result.filePath};});
  handle('context-history',async()=>{await saveContextHistory();return {sessions:contextSessions,warning:contextHistoryWarning};});
  handle('context-watch-session',async()=>{await saveContextHistory();const id=contextWatch.newSession();scheduleContextHistory();return id;});
  handle('context-watch-can-follow',async id=>{const doc=documents.get(id);return !!doc&&await contextWatch.hasPath(doc.path);});
  handle('context-watch-open',async id=>{const event=contextWatch.getEvents().find(event=>event.id===id);if(!event||!['create','modify'].includes(event.type))throw new Error('This activity entry can no longer be opened.');const file=path.resolve(contextWatch.status().root,event.path);if(!await contextWatch.hasPath(file))throw new Error('The file is no longer in the active watch scope.');return openDocument(file);});
  handle('monitor-read',async id=>{const old=documents.get(id);if(!old)return null;try{const doc=await readDocument(old.path,old.encoding,id);monitorReads.set(id,doc);return doc;}catch(error){return {error:error.message};}});
  handle('monitor-accept',id=>{const doc=monitorReads.get(id);monitorReads.delete(id);if(doc&&documents.has(id)){documents.set(id,doc);return true;}return false;});
  // Wait for restored buffers to exist before activating paths handed over by the OS.
  handle('take-open-files', async () => {
    rendererReady = true;
    const opened = [];
    for (const request of pendingFiles.splice(0)) {
      const file=typeof request==='string'?request:request.path;
      try { if(request.error)throw new Error(request.error);const doc = await openDocument(file,typeof request==='string'?undefined:request.encoding); if (doc) opened.push({...doc,launch:typeof request==='string'?{}:request}); }
      catch (error) { await dialog.showMessageBox(win,{type:'error',message:file?`Could not open ${path.basename(file)}`:'Invalid launch arguments',detail:error.message}); }
    }
    return opened;
  });
  handle('workspace-save', async name => {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Enter a workspace name.');
    const directory = path.join(app.getPath('userData'),'workspaces',hash(Buffer.from(name)));
    await new SessionStore(directory).save({ ...initial, name }); return true;
  });
  handle('workspace-list', async () => {
    const root = path.join(app.getPath('userData'),'workspaces');
    await fs.mkdir(root,{recursive:true});
    const list = [];
    for (const entry of await fs.readdir(root,{withFileTypes:true})) if (entry.isDirectory()) { const data = await new SessionStore(path.join(root,entry.name)).load(); if (data.name) list.push(data.name); }
    return list;
  });
  handle('workspace-load', async name => {
    const data = await new SessionStore(path.join(app.getPath('userData'),'workspaces',hash(Buffer.from(name)))).load();
    if (!data.name) throw new Error('Workspace not found.');
    // A switch retains the departing buffers independently of the rolling session backup.
    await new SessionStore(path.join(app.getPath('userData'),'workspaces',hash(Buffer.from('Before last workspace switch')))).save({ ...initial, name:'Before last workspace switch' });
    documents.clear();
    for (const doc of data.docs) if (doc.path) { documents.set(doc.id,doc); allowedPaths.add(pathKey(doc.path)); }
    return data;
  });
  handle('snapshot', async snapshot => {
    if (!Array.isArray(snapshot.docs)) throw new Error('Invalid snapshot');
    const docs = snapshot.docs.map(doc => { const saved = documents.get(doc.id); return { ...doc, ...(saved ? { path:saved.path, hash:saved.hash, originalEndings:saved.originalEndings } : {}) }; });
    initial = { ...snapshot, docs };
    return store.save(initial);
  });
  handle('open', async encoding => {
    if(encoding&&!require('./encodings.cjs').encodings.includes(encoding))throw new Error('Unsupported encoding');
    const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    const opened = [];
    if (!result.canceled) for (const file of result.filePaths) {
      try { const doc = await openDocument(file,encoding); if (doc) opened.push(doc); }
      catch (error) { await dialog.showMessageBox(win, { type: 'error', message: `Could not open ${path.basename(file)}`, detail: error.message }); }
    }
    return opened;
  });
  handle('open-path', async (file,options={}) => {
    const real = await fs.realpath(file);
    if (!allowedPaths.has(pathKey(real))) throw new Error('Choose this file through Open first.');
    return openDocument(real,options.encoding,options.hash);
  });
  handle('open-folder', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    workspace = await fs.realpath(result.filePaths[0]);
    return { root: workspace, files: await listFolder(workspace) };
  });
  handle('refresh-folder',async()=>{if(!workspace)throw new Error('Open a folder first.');return {root:workspace,files:await listFolder(workspace)};});
  handle('preview-page',({id,offset,version})=>previewPage(id,offset,version));
  handle('preview-search',({id,requestId,query})=>{const file=previews.get(id);if(!file)throw new Error('Preview was closed; open the file again.');return largeSearch.run({id:requestId,previewId:id,file,query},message=>{if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('preview-search-progress',{...message,requestId});});});
  handle('preview-search-cancel',requestId=>{largeSearch.cancel(requestId);return true;});
  handle('large-preview', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    if (result.canceled) return null;
    const file=await fs.realpath(result.filePaths[0]),id=randomUUID();previews.set(id,file);try{return await previewPage(id);}catch(error){previews.delete(id);throw error;}
  });
  handle('save', async ({ id, text, saveAs, encoding, eol, bom }) => {
    if (replacementApplying) throw new Error('Wait for folder replacement to finish before saving.');
    if (typeof text !== 'string' || typeof id !== 'string') throw new Error('Invalid document');
    const old = documents.get(id);
    let target = old?.path;
    if (!target || saveAs) {
      const result = await dialog.showSaveDialog(win, { defaultPath: target || 'Untitled.txt' });
      if (result.canceled) return null;
      target = result.filePath;
    }
    try { target = await fs.realpath(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if(old && !saveAs && pathKey(target)!==pathKey(old.path))throw new Error('The file path changed on disk. Use Save As to choose where your edits belong.');
    if ([...documents.values()].some(d => d.id !== id && pathKey(d.path) === pathKey(target))) throw new Error('That file is already open in another tab.');
    const meta = { ...(old || {}), bom: bom ?? old?.bom ?? false, eol: eol || old?.eol || 'LF', encoding: encoding || old?.encoding || 'utf8' };
    const fileHash = await writeDocument(target, text, meta, old && pathKey(old.path) === pathKey(target) ? old.hash : null);
    const doc = { id, path: target, name: path.basename(target), bom: meta.bom, eol: meta.eol, encoding: meta.encoding, originalEndings: meta.originalEndings, hash: fileHash };
    documents.set(id, doc); allowedPaths.add(pathKey(target)); return doc;
  });
  handle('reload', async ({ id, encoding }) => {
    const old = documents.get(id); if (!old) return null;
    const doc = await readDocument(old.path, encoding || old.encoding, id); documents.set(id, doc); return doc;
  });
  handle('save-copy', async ({id,text,encoding,eol,bom})=>{
    if(replacementApplying)throw new Error('Wait for folder replacement to finish.');
    if(typeof text!=='string' || text.length>MAX_EDIT_SIZE)throw new Error('Invalid copy content.');
    const old=documents.get(id);
    const result=await dialog.showSaveDialog(win,{title:'Save a copy — keep the current document binding',defaultPath:old?.path || 'Untitled.txt'});
    if(result.canceled)return null;
    let target=result.filePath;
    try{target=await fs.realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    if([...documents.values()].some(d=>pathKey(d.path)===pathKey(target)))throw new Error('Choose a file that is not open in a tab. Save Copy cannot overwrite the current document.');
    await writeDocument(target,text,{...old,encoding,eol,bom});allowedPaths.add(pathKey(target));return {path:target};
  });
  handle('rename-file',async({id,name})=>{
    if(replacementApplying)throw new Error('Wait for folder replacement to finish.');
    const old=documents.get(id);if(!old)throw new Error('Save this document first.');
    const doc=await renameDocument(old,name);documents.set(id,doc);allowedPaths.add(pathKey(doc.path));return {path:doc.path,name:doc.name};
  });
  handle('trash-file',async id=>{
    if(replacementApplying)throw new Error('Wait for folder replacement to finish.');
    const doc=documents.get(id);if(!doc)throw new Error('This buffer has no saved file.');
    const choice=await dialog.showMessageBox(win,{type:'question',message:`Move ${doc.name} to the Recycle Bin?`,detail:'The current buffer stays open as an unsaved document.',buttons:['Move to Recycle Bin','Cancel'],defaultId:1,cancelId:1});
    if(choice.response!==0)return null;
    await checkDisk(doc);await shell.trashItem(doc.path);documents.delete(id);monitorReads.delete(id);return true;
  });
  handle('reveal-file',id=>{const doc=documents.get(id);if(!doc)throw new Error('Save this document first.');shell.showItemInFolder(doc.path);return true;});
  handle('print-document',async({text,name,pdf})=>{
    let target;
    if(pdf){const result=await dialog.showSaveDialog(win,{title:'Export complete buffer as PDF',defaultPath:`${name || 'Untitled'}.pdf`,filters:[{name:'PDF',extensions:['pdf']}]});if(result.canceled)return null;target=result.filePath;try{target=await fs.realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;}if([...documents.values()].some(d=>pathKey(d.path)===pathKey(target)))throw new Error('PDF export cannot overwrite a file open in a tab.');}
    return printDocument({text,name,pdf:target,directory:path.join(app.getPath('userData'),'print-jobs')});
  });
  handle('import-definition',async()=>{const result=await dialog.showOpenDialog(win,{title:'Import OpenPad language JSON',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(result.canceled)return null;const file=result.filePaths[0];if((await fs.stat(file)).size>1024*1024)throw new Error('Definition exceeds 1 MiB.');return JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));});
  handle('export-definition',async value=>{const text=JSON.stringify(value,null,2);if(text.length>1024*1024)throw new Error('Definition exceeds 1 MiB.');const result=await dialog.showSaveDialog(win,{title:'Export OpenPad language JSON',defaultPath:'language.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled)return null;let target=result.filePath;try{target=await fs.realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;}if([...documents.values()].some(d=>pathKey(d.path)===pathKey(target)))throw new Error('Choose a destination that is not open in a tab.');const temp=`${target}.${randomUUID()}.tmp`;try{await fs.writeFile(temp,text,{flag:'wx'});await replaceFile(temp,target);}finally{await fs.unlink(temp).catch(()=>{});}return true;});
  handle('disk-state', async id => {
    const doc = documents.get(id); if (!doc) return 'unchanged';
    try { if((await fs.stat(doc.path)).size>MAX_EDIT_SIZE)return 'too large';return hash(await fs.readFile(doc.path)) === doc.hash ? 'unchanged' : 'changed'; }
    catch (error) { return error.code === 'ENOENT' ? 'missing' : 'unreadable'; }
  });
  handle('text-md5',text=>textMd5(text));
  handle('file-checksums',id=>{const doc=documents.get(id);if(!doc?.path)throw new Error('Save or open a disk file first.');return fileChecksums(doc.path);});
  handle('mark-matches',request=>markRunner.run(request));
  handle('cancel-marks',id=>{markRunner.cancel(id);return true;});
  handle('search', options => {
    if(options.buffers){if(!Array.isArray(options.buffers)||options.buffers.length>1000||options.buffers.some(b=>typeof b.text!=='string'||!Number.isInteger(b.from)||b.from<0)||options.buffers.reduce((n,b)=>n+b.text.length,0)>32*1024*1024)throw new Error('Buffer search exceeds the 32 MiB / 1,000-buffer limit.');}
    else if (!workspace) throw new Error('Open a folder first.');
    searchWorker?.terminate();
    const worker = new Worker(path.join(__dirname, 'search-worker.cjs'), { workerData: { ...options, root: workspace } });
    worker.requestId=options.requestId || 0;
    searchWorker = worker;
    worker.on('message', message => { if (worker !== searchWorker) return; if (message.path) allowedPaths.add(pathKey(message.path)); win.webContents.send('search-result', {...message,requestId:worker.requestId}); });
    worker.on('error', error => { if (worker === searchWorker) win.webContents.send('search-result', { type: 'error', message: error.message,requestId:worker.requestId }); });
    return true;
  });
  handle('cancel-search', async ({before}={}) => { const worker = searchWorker;if(before!==undefined && worker?.requestId>=before)return true;searchWorker = null; await worker?.terminate(); return true; });
  handle('replacement-cancel', () => { cancelReplacement(); return true; });
  handle('replacement-preview', async ({scope,buffers,options}) => {
    if (replacementApplying) return {error:'A folder replacement is still applying.'};
    cancelReplacement();
    if (!['folder','buffers'].includes(scope)) return {error:'Invalid preview scope.'};
    if (scope === 'folder' && !workspace) return {error:'Open a folder first.'};
    if (scope === 'buffers' && (!Array.isArray(buffers) || buffers.length > 1000 || buffers.some(b=>typeof b.text !== 'string') || buffers.reduce((n,b)=>n+b.text.length,0)>32*1024*1024)) return {error:'Buffer preview exceeds its size/count limit.'};
    const worker = new Worker(path.join(__dirname,'replacement-worker.cjs'),{workerData:{options,...(scope==='folder'?{root:workspace,blocked:[...documents.values()].map(d=>d.path).filter(Boolean)}:{buffers})}});
    const response = await new Promise(resolve=>{
      const timer = setTimeout(()=>{ if (replacementJob?.worker===worker) { replacementJob.finish({error:'Preview exceeded 10 seconds. Narrow the expression or scope.'}); worker.terminate(); } },10000);
      const finish = result=>{clearTimeout(timer);resolve(result);};
      replacementJob={worker,finish};
      worker.once('message',finish); worker.once('error',error=>finish({error:error.message}));
      worker.once('exit',code=>finish({error:`Preview worker exited (${code}).`}));
    });
    if (replacementJob?.worker !== worker) return {cancelled:true};
    replacementJob=null;
    if (!response.result) return response;
    replacementPlan={id:randomUUID(),scope,...response.result};
    return {id:replacementPlan.id,...response.result};
  });
  handle('replacement-apply', async ({id,selected}) => {
    if (replacementApplying || !replacementPlan || replacementPlan.id!==id || replacementPlan.scope!=='folder') return {error:'Preview is no longer available. Preview again.'};
    if (!Array.isArray(selected) || new Set(selected).size!==selected.length || !selected.length || selected.some(id=>!replacementPlan.entries.some(e=>e.id===id))) return {error:'Invalid file selection.'};
    const entries=replacementPlan.entries.filter(e=>selected.includes(e.id));
    if(entries.some(e=>[...documents.values()].some(d=>d.path && pathKey(d.path)===pathKey(e.path)))) return {error:'A selected file is open in a tab. Close it or use Open buffers scope, then preview again.'};
    replacementPlan=null; replacementApplying=true;
    try { return await applyFiles(entries,path.join(app.getPath('userData'),'replacement-recovery')); }
    catch(error) { return {error:error.message}; }
    finally { replacementApplying=false; }
  });
  handle('confirm-close', async name => (await dialog.showMessageBox(win, { type: 'question', message: `Save changes to ${name}?`, buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2 })).response);
  handle('confirm-reload', async () => (await dialog.showMessageBox(win, { type: 'question', message: 'Reload from disk and discard the current buffer?', buttons: ['Reload', 'Cancel'], defaultId: 1, cancelId: 1 })).response === 0);
  handle('forget', id => { documents.delete(id); if(largeSearch.job?.previewId===id)largeSearch.cancel();previews.delete(id); monitorReads.delete(id); return true; });
  handle('quit', async () => { if(replacementApplying)throw new Error('Wait for folder replacement to finish before quitting.');if(commandRunner.job)throw new Error('Stop the external command before quitting.');cancelReplacement();await stopMcp();contextCorpus.invalidate();await contextWatch.stop();await saveContextHistory();await contextReview.flush();await store.queue; await searchWorker?.terminate(); closing = true; win.close(); });
  const item = (label, name, accelerator) => ({ id:name, label, accelerator, click: () => command(name) });
  const menuTemplate = [
    { label: 'File', submenu: [item('New','new','CmdOrCtrl+N'), item('Open…','open','CmdOrCtrl+O'), item('Open with encoding…','openEncoding'), item('Open folder…','folder','CmdOrCtrl+Shift+O'), item('Open large file preview…','largePreview'), item('Quick open…','quickOpen','CmdOrCtrl+P'), item('Save','save','CmdOrCtrl+S'), item('Save As…','saveAs','CmdOrCtrl+Shift+S'), item('Save all','saveAll'), item('Reload from disk','reload'), item('Close tab','close','CmdOrCtrl+W'), { type:'separator' }, item('Exit','quit')] },
    { label: 'Edit', submenu: [item('Undo','undo','CmdOrCtrl+Z'), item('Redo','redo','CmdOrCtrl+Y'), {type:'separator'}, {role:'cut'}, {role:'copy'}, {role:'paste'}, {role:'selectAll'}, {type:'separator'}, item('Find / Replace','find','CmdOrCtrl+F'), item('Find in folder','folderSearch','CmdOrCtrl+Shift+F'), item('Preview replacement','replacePreview'), item('Go to line','goto','CmdOrCtrl+G'), item('Format JSON','formatJson'), item('Sort lines','sortLines'), item('Remove duplicate lines','dedupe'), item('Trim trailing whitespace','trim')] },
    { label: 'View', submenu: [item('Command palette','palette','CmdOrCtrl+Shift+P'), item('Settings','settings','CmdOrCtrl+,'), item('Keyboard shortcuts','shortcuts'), item('Compare buffers','compare'), item('Markdown preview','markdown'), item('Word wrap','wrap','Alt+Z'), item('Document map','documentMap'), item('Document visibility','visibility'), item('Pin / unpin tab','pin'), item('Name tab group','group'), item('Four editor panes','split'), item('Pane layout','paneLayout'), item('Save named workspace','saveWorkspace'), item('Open named workspace','loadWorkspace'), item('Encoding and line endings','encoding'), item('Reset layout','resetLayout'), item('Next tab','nextTab','Ctrl+Tab'), item('Previous tab','previousTab','Ctrl+Shift+Tab'), {role:'resetZoom'}, {role:'zoomIn'}, {role:'zoomOut'}, {role:'togglefullscreen'}] }
  ];
  menuTemplate.push({label:'Tools',submenu:[item('Unicode character panel','characterPanel'),item('Text checksums','checksum'),item('File checksums','fileChecksum')]});
  menuTemplate.push({label:'Marks',submenu:[item('Color marks','markText'),item('Next mark','markNext'),item('Previous mark','markPrevious'),item('Copy marked text','markCopy'),item('Clear all color marks','markClear')]});
  menuTemplate.push({label:'Bookmarks',submenu:[item('Toggle bookmark','bookmarkToggle','Ctrl+F2'),item('Next bookmark','bookmarkNext','Alt+F2'),item('Previous bookmark','bookmarkPrevious','Alt+Shift+F2'),item('Clear bookmarks','bookmarkClear'),item('Copy bookmarked lines','bookmarkCopy'),item('Remove bookmarked lines','bookmarkRemoveLines')]});
  menuTemplate.push({label:'Macro',submenu:[item('Start recording edits','macroStart'),item('Stop recording','macroStop'),item('Play editing macro','macroPlay'),item('Repeat editing macro','macroRepeat'),item('Save editing macro','macroSave'),item('Load editing macro','macroLoad')]});
  menuTemplate[1].submenu.push(item('Column insertion…','columnEditor','Alt+C'));
  menuTemplate[1].submenu.push(item('Replace across buffers or folder…','replaceAcross'));
  menuTemplate[0].submenu.splice(8,0,item('Save a copy…','saveCopy'),item('Rename file…','renameFile'),item('Move file to Recycle Bin…','trashFile'),item('Show file in Explorer','revealFile'),item('Reopen last closed file','reopenClosed','Ctrl+Shift+T'),item('Close other unpinned tabs','closeOthers'),item('Close all tabs','closeAll'));
  menuTemplate[2].submenu.push(item('Save current group','saveGroup'),item('Pin or unpin current group','pinGroup'),item('Close current group','closeGroup'));
  menuTemplate[2].submenu.push(item('Move tab left','tabLeft'),item('Move tab right','tabRight'));
  menuTemplate[2].submenu.push(item('Toggle read-only buffer','readOnly'));
  menuTemplate[0].submenu.splice(-1,0,item('Print…','print'),item('Export PDF…','exportPdf'));
  menuTemplate.push({label:'Text',submenu:[item('Transform text…','transform'),item('UPPERCASE','uppercase'),item('lowercase','lowercase'),item('Title Case','titleCase'),item('Join lines','joinLines'),item('Remove blank lines','removeBlank'),item('Tabs to spaces','tabsToSpaces'),item('Leading spaces to tabs','spacesToTabs')]});
  menuTemplate[2].submenu.push(item('Fold all','foldAll'),item('Unfold all','unfoldAll'),item('Fold at cursor','foldCode'),item('Unfold at cursor','unfoldCode'),item('Show whitespace','whitespace'));
  menuTemplate.push({label:'Language',submenu:[item('Function and class outline','outline'),item('Show completions','complete','Ctrl+Space'),item('Completion settings…','apiSettings'),item('Custom languages…','customLanguages')]});
  menuTemplate.push({label:'Run',submenu:[item('Run saved command…','runCommand','Ctrl+F5'),item('Stop command','stopCommand'),item('Configure commands…','commandSettings'),item('Show command output','commandOutput')]});
  menuTemplate[2].submenu.push(item('Monitor file (tail)','monitor'));
  for(const [name,label] of Object.entries({moveLineUp:'Move lines up',moveLineDown:'Move lines down',copyLineUp:'Duplicate lines up',copyLineDown:'Duplicate lines down',deleteLine:'Delete lines',indentMore:'Increase indentation',indentLess:'Decrease indentation',indentSelection:'Reindent selection',toggleLineComment:'Toggle line comment',toggleBlockComment:'Toggle block comment',selectLine:'Select line',selectParentSyntax:'Expand syntax selection',selectMatchingBracket:'Select to matching bracket',cursorMatchingBracket:'Go to matching bracket',addCursorAbove:'Add cursor above',addCursorBelow:'Add cursor below',simplifySelection:'Reduce to primary selection'}))menuTemplate[1].submenu.push(item(label,name));
  const menuCommands = menuTemplate.flatMap(menu=>menu.submenu).filter(entry=>entry.id);
  const defaults = Object.fromEntries(menuCommands.map(entry=>[entry.id,entry.accelerator || '']));
  function applyShortcuts(overrides = {}) {
    const reserved = new Set(['CTRL+C','CTRL+X','CTRL+V','CTRL+A','CTRL+0','CTRL+-','CTRL+=','CTRL+SHIFT+Z']);
    const used = new Set();
    const normalize = value=>value.toUpperCase().replace('CMDORCTRL','CTRL').split('+').sort().join('+');
    const values = menuCommands.map(entry => ({ ...entry, accelerator:overrides[entry.id] ?? defaults[entry.id] }));
    for (const entry of values) if (entry.accelerator) {
      if (!/^(?:(?:CmdOrCtrl|Ctrl|Alt|Shift)\+)+(?:[A-Z0-9,]|F(?:[1-9]|1[0-2])|Tab|Space)$/i.test(entry.accelerator)) throw new Error(`Invalid shortcut for ${entry.label}. Example: Ctrl+Alt+S`);
      const key=normalize(entry.accelerator);
      if ([...reserved].some(value=>normalize(value)===key) || used.has(key)) throw new Error(`Shortcut conflict: ${entry.accelerator}`);
      used.add(key);
    }
    const mapped = new Map(values.map(entry=>[entry.id,entry]));
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate.map(menu=>({...menu,submenu:menu.submenu.map(entry=>mapped.get(entry.id)||entry)}))));
    return Object.fromEntries(values.map(entry=>[entry.id,entry.accelerator]));
  }
  let currentShortcuts;
  try { currentShortcuts=applyShortcuts(initial.settings?.shortcuts); } catch { currentShortcuts=applyShortcuts(); }
  handle('shortcuts',()=>menuCommands.map(entry=>({id:entry.id,label:entry.label,accelerator:currentShortcuts[entry.id]})));
  handle('set-shortcuts',overrides=>{ currentShortcuts=applyShortcuts(overrides); return currentShortcuts; });
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => {void stopMcp().catch(()=>{});contextCorpus.close();contextMeter.close();contextLint.close();contextWatch.stop();markRunner.cancel();largeSearch.cancel();app.quit();});
