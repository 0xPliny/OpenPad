import {installProvenance} from './context-provenance.mjs';
import {installCorpus} from './context-corpus-ui.js';
import {installReview} from './context-review-ui.js';
import {installLint} from './context-lint-ui.js';
import {EditorState} from '@codemirror/state';

export function installContext(ctx,ui){
  installProvenance(ctx);
  installCorpus(ctx,ui);
  installReview(ctx,ui);
  installLint(ctx,ui);
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,labels}=ui;
  const meter=document.createElement('button');meter.id='context-token-count';meter.textContent='Tokens: pending';meter.onclick=()=>ctx.run(commands.contextBudget);$('footer>div').prepend(meter);
  let timer,request=0,cached,watchStatus,feed=[],followQueue=Promise.resolve();
  const tokenizers=['o200k_base','cl100k_base','chars4'];
  const tokenizer=()=>tokenizers.includes(settings.contextTokenizer)?settings.contextTokenizer:'o200k_base';
  const threshold=()=>Number.isSafeInteger(settings.contextTokenBudget)&&settings.contextTokenBudget>0?settings.contextTokenBudget:8000;
  const lineThreshold=()=>Number.isSafeInteger(settings.contextLineBudget)&&settings.contextLineBudget>0?settings.contextLineBudget:500;
  const node=(tag,text)=>{const item=document.createElement(tag);item.textContent=text;return item;};
  function updateMeter(){
    clearTimeout(timer);const old=request++;window.desktop.cancelContextMeter(old);cached=null;meter.textContent='Tokens: pending';
    timer=setTimeout(async()=>{
      const doc=ctx.active;if(!doc)return;const original=doc.state.doc,id=request;
      if(original.length>1024*1024){meter.textContent='Tokens: over 1 MiB limit';return;}
      const result=await window.desktop.contextMeter({requestId:id,text:original.toString(),tokenizer:tokenizer()});
      if(id!==request||ctx.active!==doc||doc.state.doc!==original)return;
      if(!result||result.cancelled){meter.textContent='Tokens: unavailable';return;}
      if(result.error){meter.textContent='Tokens: unavailable';meter.title=result.error;return;}
      cached={doc,original,result};meter.textContent=`${result.approximate?'≈ ':''}${result.total.toLocaleString()} tokens${result.total>threshold()?' · over budget':''}`;
      meter.title=`${result.tokenizer}; ${result.lines} lines. Open context budget and heading costs.`;
      drawBudget();
    },350);
  }
  function drawBudget(){
    const target=$('#context-sections');if(!target)return;target.replaceChildren();
    if(!cached||cached.doc!==ctx.active||cached.original!==ctx.active.state.doc){target.append(node('p',meter.textContent));return;}
    const {result,doc,original}=cached;
    target.append(node('p',`${result.total.toLocaleString()} tokens · ${result.lines} lines · ${result.bytes.toLocaleString()} UTF-8 bytes. ${result.approximate?'Rough character-based estimate; not a Claude tokenizer.':'Local encoding count; excludes chat wrappers and other prompt files.'}`));
    target.append(node('p',`${result.total>threshold()?'Token budget exceeded.':'Within token budget.'} ${result.lines>lineThreshold()?'Line guideline exceeded.':'Within line guideline.'} Thresholds are personal guidelines, not format requirements.`));
    target.append(node('p','Heading costs include their descendants and overlap; do not add them to estimate file totals.'));
    for(const section of result.sections){const row=button(`${section.level?'#'.repeat(section.level)+' ':''}${section.title} — ${section.tokens.toLocaleString()} tokens`,()=>{
      if(ctx.active!==doc||doc.state.doc!==original)throw new Error('The document changed; refresh its section counts.');
      const view=ctx.editorView();closeDialog();view.dispatch({selection:{anchor:section.from,head:section.to},scrollIntoView:true});view.focus();
    });row.dataset.contextLine=section.line;target.append(row);}
  }
  commands.contextBudget=()=>{
    show('Context budget','<label>Tokenizer <select id="context-tokenizer"><option value="o200k_base">o200k_base</option><option value="cl100k_base">cl100k_base</option><option value="chars4">Rough characters ÷ 4 estimate</option></select></label><label>Token budget <input id="context-budget" type="number" min="1" max="10000000"></label><label>Line guideline <input id="context-lines" type="number" min="1" max="1000000"></label><p>Counts use unsaved editor text, locally. Inputs above 1 MiB UTF-8 are skipped. No document is sent to a service.</p><div id="context-sections"></div>');
    $('#context-tokenizer').value=tokenizer();$('#context-budget').value=threshold();$('#context-lines').value=lineThreshold();
    const apply=()=>{const budget=+$('#context-budget').value,lines=+$('#context-lines').value;if(!Number.isSafeInteger(budget)||budget<1||budget>10000000||!Number.isSafeInteger(lines)||lines<1||lines>1000000)throw new Error('Choose positive token/line thresholds within the displayed limits.');settings.contextTokenizer=$('#context-tokenizer').value;settings.contextTokenBudget=budget;settings.contextLineBudget=lines;ctx.scheduleSnapshot();updateMeter();};
    body.append(button('Apply budget settings',apply));drawBudget();
  };
  const watchBar=document.createElement('div');watchBar.className='context-watch-bar';watchBar.innerHTML='<button data-command="contextWatch">Agent Watch</button><button data-command="contextBudget">Context budget</button><button data-command="contextCorpus">Corpus budget</button><button data-command="contextReview">Review queue</button><button data-command="contextLint">Context checks</button><button data-command="mcp">MCP</button><span id="context-watch-summary">Watch stopped</span>';$('main').prepend(watchBar);
  function drawWatch(){
    const summary=$('#context-watch-summary');summary.textContent=watchStatus?.running?`Watching ${watchStatus.trackedFiles} files · ${watchStatus.issues} issues · writer unknown`:'Watch stopped';
    const list=$('#context-activity');if(!list)return;list.replaceChildren();
    list.append(node('p',watchStatus?.root?`${watchStatus.root} · session ${watchStatus.sessionId} · ${watchStatus.complete?'within configured coverage':'coverage incomplete'} · ${watchStatus.droppedEvents} older events dropped`:'Select a folder to establish a baseline. Existing files are not reported as new writes.'));
    for(const event of feed.slice(-200).reverse()){
      const description=`${event.timestamp} · ${event.type} · ${event.path||''} · ${event.type==='issue'?event.message:`${event.byteDelta>=0?'+':''}${event.byteDelta} bytes, ${event.lineDelta==null?'unknown':event.lineDelta} lines · writer unknown`}`;
      list.append(event.type==='issue'||event.type==='delete'?node('p',description):button(description,async()=>{const data=await window.desktop.contextWatchOpen(event.id);if(!data)return;const old=ctx.docs.find(doc=>doc.id===data.id);if(old)ctx.activate(old);else ctx.makeDoc(data);closeDialog();}));
    }
    if(feed.length>200)list.append(node('p','Showing the newest 200 retained events.'));
  }
  async function refreshWatch(){const value=await window.desktop.contextWatchState();if(value){watchStatus=value.status;feed=value.events;const retention=document.querySelector("#context-retain-review");if(retention)retention.checked=value.reviewEnabled===true;drawWatch();if(value.historyWarning)$('#context-activity')?.prepend(node('p',value.historyWarning));}}
  commands.contextWatch=async()=>{
    show('Agent Watch','<p>Observes disk changes; it does not gate writes or identify the writer. Network drives, event loss and file rotation are not guaranteed. No watch resumes automatically.</p><label>Include globs (comma separated) <input id="context-include" value="**/*.md, **/.cursorrules"></label><label>Exclude globs (comma separated) <input id="context-exclude" value="**/.git/**, **/node_modules/**"></label><label><input id="context-tail" type="checkbox"> Pin followed file to bottom</label><label><input id="context-retain-review" type="checkbox"> Retain before/after review snapshots on this device for this watch</label><p>Optional review storage retains document contents across restart: up to 128 observations, 1 MiB per text side and 8 MiB serialized. Decisions do not change watched files. Enable this before choosing a watch folder.</p><div id="context-watch-actions"></div><div id="context-activity"></div>');
    $('#context-tail').checked=settings.contextTail!==false;$('#context-tail').onchange=()=>{settings.contextTail=$('#context-tail').checked;ctx.scheduleSnapshot();};
    const actions=$('#context-watch-actions');
    actions.append(button('Choose watch folder',async()=>{const options={retainReview:document.querySelector("#context-retain-review").checked,include:$('#context-include').value.split(',').map(x=>x.trim()).filter(Boolean),exclude:$('#context-exclude').value.split(',').map(x=>x.trim()).filter(Boolean)};const result=await window.desktop.contextWatchStart(options);if(result){stopFollowing();await refreshWatch();}}),button('Stop watch',async()=>{stopFollowing();await window.desktop.contextWatchStop();await refreshWatch();}),button('Session history',commands.contextHistory),button('New watch session',async()=>{await window.desktop.contextWatchSession();await refreshWatch();window.dispatchEvent(new Event('openpad-context-session'));}),button('Follow current file / stop following',commands.contextFollow));
    await refreshWatch();
  };
  commands.contextHistory=async()=>{
    const result=await window.desktop.contextHistory();if(!result)return;
    show('Observed session history','<p>Retained filesystem observations, with unknown writer identity. No watched file contents are stored here. At most 20 sessions / 10,000 events total are retained; older sessions are evicted. Recent events can be lost before the next completed save. Watches do not resume on restart.</p>');
    if(result.warning)body.append(node('p',result.warning));
    for(const session of [...result.sessions].reverse()){
      body.append(node('h3',`${session.root} · ${session.sessionId}`),node('p',`${session.startedAt} — ${session.updatedAt} · ${session.events.length} retained events · ${session.status?.issues||0} coverage issues`));
      body.append(button('Export session as Markdown',async()=>{const result=await window.desktop.exportContextHistory(session.sessionId);if(result)$('#status').textContent=`Session report saved: ${result.path}`;}));
      for(const event of session.events.slice(-100))body.append(node('p',`${event.timestamp} · ${event.type} · ${event.path} · writer unknown`));
      if(session.events.length>100)body.append(node('p','Showing the newest 100 events in this session.'));
    }
  };
  function stopFollowing(doc){for(const item of doc?[doc]:ctx.docs.filter(item=>item.contextFollow)){item.contextFollow=false;item.contextFollowGeneration=(item.contextFollowGeneration||0)+1;item.monitoring=false;const effect=item.writable.reconfigure(EditorState.readOnly.of(!!item.readOnly||!!item.locked));if(ctx.active===item)ctx.editorView().dispatch({effects:effect});else item.state=item.state.update({effects:effect}).state;}window.dispatchEvent(new Event('openpad-edit'));}
  commands.contextFollow=async()=>{
    const doc=ctx.active;if(doc.contextFollow){stopFollowing(doc);return;}
    if(!doc.path||ctx.dirty(doc)||doc.monitoring)throw new Error('Follow requires a saved, clean file with existing polling monitoring stopped.');
    if(!await window.desktop.contextWatchCanFollow(doc.id))throw new Error('The file must be in the active watch baseline and within its limits.');
    if(ctx.active!==doc||ctx.dirty(doc))throw new Error('The document changed while enabling follow.');
    doc.contextFollow=true;doc.contextFollowGeneration=(doc.contextFollowGeneration||0)+1;doc.monitoring=true;ctx.editorView().dispatch({effects:doc.writable.reconfigure(EditorState.readOnly.of(true))});
    if(await follow(doc))$('#status').textContent=`Following watched file read-only${settings.contextTail!==false?'; tail pinned to bottom':''}`;
  };
  async function follow(doc){
    if(!doc.contextFollow)return false;const generation=doc.contextFollowGeneration,original=doc.state.doc;const data=await window.desktop.monitorRead(doc.id);
    if(!ctx.docs.includes(doc)||!doc.contextFollow||doc.contextFollowGeneration!==generation)return false;
    if(!data||data.error||doc.state.doc!==original||ctx.dirty(doc)){stopFollowing(doc);$('#status').textContent=`Follow stopped: ${data?.error||'buffer changed or read failed'}`;return false;}
    ctx.reloadBuffer(doc,data);await window.desktop.monitorAccept(doc.id);
    if(ctx.active===doc&&settings.contextTail!==false){const target=ctx.editorView();target.dispatch({selection:{anchor:target.state.doc.length},scrollIntoView:true});}
    return !!doc.contextFollow&&doc.contextFollowGeneration===generation;
  }
  window.desktop.onContextWatch(message=>{
    window.dispatchEvent(new Event('openpad-context-session'));watchStatus=message.status;if(message.event){feed.push(message.event);feed=feed.slice(-2000);}drawWatch();if(!message.event){if(!watchStatus?.running)stopFollowing();return;}
    const root=watchStatus?.root?.replaceAll('\\','/').replace(/\/$/,'');const file=`${root}/${message.event.path}`.toLowerCase();
    for(const doc of ctx.docs.filter(doc=>doc.contextFollow)){
      if(!watchStatus?.running||message.event.type==='issue'){stopFollowing(doc);continue;}
      if(doc.path?.replaceAll('\\','/').toLowerCase()!==file)continue;
      if(message.event.type==='delete'){stopFollowing(doc);$('#status').textContent='Follow stopped: watched file deleted';}
      else followQueue=followQueue.then(()=>follow(doc)).catch(error=>{stopFollowing(doc);$('#status').textContent=`Follow stopped: ${error.message}`;});
    }
  });
  Object.assign(labels,{contextHistory:'Observed session history',contextBudget:'Context budget and Markdown section tokens',contextWatch:'Agent Watch: folder activity',contextFollow:'Follow watched file read-only / stop'});
  for(const event of ['openpad-ready','openpad-activate','openpad-edit'])window.addEventListener(event,updateMeter);
}
