export function installCorpus(ctx,ui){
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,labels}=ui;
  let sequence=0,active=null;
  const node=(tag,text)=>{const item=document.createElement(tag);item.textContent=text;return item;};
  function cancel(){if(active!==null)window.desktop.cancelContextCorpus(active);active=null;sequence++;}
  const dialog=$('#dialog');
  for(const event of ['close','cancel','openpad-dialog-replace'])dialog.addEventListener(event,cancel);
  window.desktop.onContextCorpusProgress(value=>{if(value.requestId!==active)return;const target=$('#corpus-summary');if(target)target.textContent=`Scanning: ${value.files} files, ${value.total.toLocaleString()} tokens, ${value.bytesRead.toLocaleString()} bytes read…`;});
  commands.contextCorpus=()=>{
    show('Corpus budget','<p>Counts saved UTF-8 files in the active Agent Watch scope, locally. Unsaved editor changes are excluded. Files are observed at different times; this is not an atomic snapshot.</p><label>Tokenizer <select id="corpus-tokenizer"><option value="o200k_base">o200k_base</option><option value="cl100k_base">cl100k_base</option><option value="chars4">Rough characters ÷ 4 estimate</option></select></label><label>Corpus token budget <input id="corpus-budget" type="number" min="1" max="1000000000"></label><div id="corpus-actions"></div><p id="corpus-summary" role="status">Start a scan to count the watched folder.</p><div id="corpus-results"></div>');
    $('#corpus-tokenizer').value=['o200k_base','cl100k_base','chars4'].includes(settings.contextTokenizer)?settings.contextTokenizer:'o200k_base';
    $('#corpus-budget').value=Number.isSafeInteger(settings.contextCorpusBudget)&&settings.contextCorpusBudget>0?settings.contextCorpusBudget:32000;
    const results=$('#corpus-results'),summary=$('#corpus-summary');
    for(const field of ['#corpus-tokenizer','#corpus-budget'])$(field).oninput=()=>{cancel();results.replaceChildren();summary.textContent='Settings changed. Scan again to calculate this budget.';};
    const scan=button('Scan watched folder',async()=>{
      const budget=+$('#corpus-budget').value;
      if(!Number.isSafeInteger(budget)||budget<1||budget>1000000000)throw new Error('Choose a corpus budget between 1 and 1,000,000,000 tokens.');
      cancel();const requestId=++sequence;active=requestId;settings.contextCorpusBudget=budget;ctx.scheduleSnapshot();results.replaceChildren();summary.textContent='Starting corpus scan…';
      const value=await window.desktop.contextCorpus({requestId,tokenizer:$('#corpus-tokenizer').value});
      if(active!==requestId||!results.isConnected)return;active=null;
      if(!value){summary.textContent='Corpus scan unavailable. Start Agent Watch and try again.';return;}
      if(value.error||value.cancelled){summary.textContent=value.error||'Scan cancelled; no complete total is available.';return;}
      summary.textContent=`${value.approximate?'≈ ':''}${value.total.toLocaleString()} disk tokens · ${value.files.length} files · ${value.skippedCount} skipped · ${value.incomplete?'INCOMPLETE coverage':'within scan limits'} · ${value.total>budget?'over budget':'counted files within budget'} · ${value.tokenizer} · budget ${budget.toLocaleString()}`;
      results.append(node('p',value.root),node('p',value.note));
      results.append(node('p','Heaviest files first. Up to 200 results are displayed. Opening a result checks that its bytes still match the scan.'));
      for(const entry of value.files.slice(0,200)){
        const row=button(`${entry.path} — ${entry.tokens.toLocaleString()} disk tokens`,async()=>{
          const generation=sequence;
          const data=await window.desktop.contextCorpusOpen({requestId,path:entry.path});if(!data||generation!==sequence||!results.isConnected)return;
          const old=ctx.docs.find(doc=>doc.id===data.id);
          if(old){if(old.state.doc.toString()!==data.corpusText)throw new Error('The open buffer differs from the scanned disk text. Save or reload it deliberately before opening this result.');ctx.activate(old);}else{
            if(data.text!==data.corpusText)throw new Error('The retained document differs from this scan. Open the file normally to reconcile its disk state.');
            ctx.makeDoc(data);
          }
          closeDialog();
        });row.dataset.corpusPath=entry.path;results.append(row);
      }
      for(const skipped of value.skipped.slice(0,100))results.append(node('p',`Skipped: ${skipped.path} — ${skipped.reason}`));
      if(value.skippedCount>100)results.append(node('p',`${value.skippedCount-100} additional skipped paths are not displayed.`));
    });
    const stop=node('button','Cancel scan');stop.type='button';stop.onclick=()=>{cancel();summary.textContent='Scan cancelled; no complete total is available.';results.replaceChildren();};
    $('#corpus-actions').append(scan,stop);
  };
  labels.contextCorpus='Corpus budget: watched folder token costs';
}
