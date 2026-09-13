export function installLint(ctx,ui){
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,labels}=ui;
  let sequence=0,active=null;
  const node=(tag,text)=>{const item=document.createElement(tag);item.textContent=text;return item;};
  function cancel(){if(active!==null)window.desktop.cancelContextLint(active);active=null;sequence++;}
  for(const event of ['close','cancel','openpad-dialog-replace'])$('#dialog').addEventListener(event,cancel);
  window.addEventListener('openpad-edit',()=>{const status=$('#lint-summary');if(status){cancel();$('#lint-results').replaceChildren();status.textContent='Text changed. Run checks again.';}});
  commands.contextLint=()=>{
    const doc=ctx.active;if(!doc)return;
    show('Advisory context checks','<p>Checks the unsaved Markdown locally. Findings are suggestions, never blocking rules. No hierarchy merging, required sections, contradiction detection or path validation is inferred.</p><label>Token budget <input id="lint-tokens" type="number" min="1" max="10000000"></label><label>Line guideline <input id="lint-lines" type="number" min="1" max="1000000"></label><label>Review date references older than days (0 disables) <input id="lint-age" type="number" min="0" max="365000" value="0"></label><p id="lint-summary" role="status">Run checks for this document.</p><div id="lint-actions"></div><div id="lint-results"></div>');
    $('#lint-tokens').value=settings.contextTokenBudget||8000;$('#lint-lines').value=settings.contextLineBudget||500;
    const results=$('#lint-results'),summary=$('#lint-summary');
    function dismissed(){return Array.isArray(settings.contextLintDismissed)?settings.contextLintDismissed.filter(value=>typeof value==='string').slice(-1000):[];}
    function invalidated(){cancel();results.replaceChildren();summary.textContent='Settings changed. Run checks again.';}
    for(const field of ['#lint-tokens','#lint-lines','#lint-age'])$(field).oninput=invalidated;
    $('#lint-actions').append(button('Run advisory checks',async()=>{
      const tokenBudget=+$('#lint-tokens').value,lineBudget=+$('#lint-lines').value,dateAgeDays=+$('#lint-age').value;
      if(!Number.isSafeInteger(tokenBudget)||tokenBudget<1||tokenBudget>10000000||!Number.isSafeInteger(lineBudget)||lineBudget<1||lineBudget>1000000||!Number.isSafeInteger(dateAgeDays)||dateAgeDays<0||dateAgeDays>365000)throw new Error('Use positive budget values and a nonnegative date age within the displayed limits.');
      cancel();const id=++sequence,original=doc.state.doc;active=id;results.replaceChildren();summary.textContent='Checking…';
      const date=new Date(),today=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      const value=await window.desktop.contextLint({requestId:id,text:original.toString(),name:doc.name,tokenizer:settings.contextTokenizer||'o200k_base',tokenBudget,lineBudget,...(dateAgeDays?{dateAgeDays,today}:{})});
      if(active!==id||!results.isConnected||ctx.active!==doc||doc.state.doc!==original)return;active=null;
      if(!value||value.error||value.cancelled){summary.textContent=value?.error||'Checks cancelled.';return;}
      const scope=doc.path||doc.id;
      const draw=()=>{
        results.replaceChildren();const hidden=new Set(dismissed()),visible=value.findings.filter(finding=>!hidden.has(scope+'|'+finding.id));
        summary.textContent=`${visible.length} visible suggestions · ${value.findings.length-visible.length} dismissed · ${value.approximate?'≈ ':''}${value.tokenCount.toLocaleString()} tokens (${value.tokenizer})${value.truncated?' · finding limit reached':''}`;
        results.append(node('p',value.note));
        for(const finding of visible){const row=node('div');row.append(button(`Line ${finding.line}: ${finding.message}`,()=>{if(ctx.active!==doc||doc.state.doc!==original)throw new Error('Text changed; run checks again.');closeDialog();const view=ctx.editorView();view.dispatch({selection:{anchor:finding.from,head:finding.to},scrollIntoView:true});view.focus();}),button('Dismiss suggestion',()=>{settings.contextLintDismissed=[...dismissed(),scope+'|'+finding.id].slice(-1000);ctx.scheduleSnapshot();draw();}));row.dataset.lintCode=finding.code;results.append(row);}
      };draw();
    }),button('Restore dismissed suggestions',()=>{settings.contextLintDismissed=[];ctx.scheduleSnapshot();invalidated();}));
    const stop=node('button','Cancel checks');stop.type='button';stop.onclick=()=>{cancel();results.replaceChildren();summary.textContent='Checks cancelled.';};$('#lint-actions').append(stop);
  };
  labels.contextLint='Advisory agent-file and Markdown checks';
}
