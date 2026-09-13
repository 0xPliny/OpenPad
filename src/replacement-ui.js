import {labels as encodingLabels} from './encodings.cjs';
import { isolateHistory } from '@codemirror/commands';

export function installReplacement(ctx,ui) {
  const {$,commands,docs,view,activate}=ctx;
  const {show,body,button,closeDialog,compareTexts,labels}=ui;
  labels.replaceAcross='Replace across buffers or folder';
  commands.replaceAcross=()=>{
    show('Replace across buffers or folder','<p>Preview before applying. Buffer changes stay unsaved and undo separately in each tab. Folder changes write selected closed files and retain original bytes in local recovery storage. Regex uses JavaScript syntax, not Notepad++ Boost syntax.</p><label>Scope <select id="replace-scope"><option value="current">Current buffer</option><option value="buffers">Open buffers</option><option value="folder">Folder on disk</option></select></label><label>Find <textarea id="batch-find" rows="2"></textarea></label><label>Replace with <textarea id="batch-replace" rows="2"></textarea></label><label><input id="batch-regex" type="checkbox">Regex ($1, $&amp;, $&lt;name&gt; captures; multiline anchors)</label><label><input id="batch-case" type="checkbox" checked>Match case</label><label><input id="batch-word" type="checkbox">Whole words (Unicode letters, numbers, underscore)</label><label><input id="batch-dot" type="checkbox">Dot matches newline</label><label>Folder extensions <input id="batch-include" placeholder="txt,js"></label><label>Excluded names <input id="batch-exclude" value=".git,node_modules,dist,release"></label><label>Folder encoding <select id="batch-encoding"><option value="">UTF-8 / Unicode BOM detection</option><option value="windows1252">Explicit Windows-1252</option><option value="utf16le">Explicit UTF-16 LE</option><option value="utf16be">Explicit UTF-16 BE</option></select></label><p id="batch-status" role="status">Folder previews: 10 MiB/file; 32 MiB aggregate text; 256 changed files; 10-second time limit. Linked files are skipped.</p><div id="batch-files"></div><div id="batch-diff"></div>');
    $('#batch-encoding').replaceChildren(new Option('Unicode BOM / UTF-8',''),...Object.entries(encodingLabels).map(([value,label])=>new Option(label,value)));
    let plan=null, snapshots=new Map(), generation=0, applying=false;
    const status=$('#batch-status'), files=$('#batch-files'), diff=$('#batch-diff');
    const invalidate=()=>{generation++;plan=null;files.replaceChildren();diff.replaceChildren();status.textContent='Inputs changed — preview again.';window.desktop.replacementCancel();};
    body.querySelectorAll('input,textarea,select').forEach(input=>input.addEventListener('input',invalidate));
    const preview=button('Preview changes',async()=>{
      const version=++generation;
      const scope=$('#replace-scope').value;
      const selected=scope==='current'?[ctx.active]:docs.filter(d=>!d.state.readOnly);
      if(scope==='current' && ctx.active.state.readOnly)throw new Error('The current buffer is read-only.');
      snapshots=new Map(selected.map(doc=>[doc.id,{doc,text:doc.state.doc}]));plan=null;files.replaceChildren();diff.replaceChildren();status.textContent='Preparing preview…';
      const options={query:$('#batch-find').value,replacement:$('#batch-replace').value,regex:$('#batch-regex').checked,caseSensitive:$('#batch-case').checked,wholeWord:$('#batch-word').checked,dotAll:$('#batch-dot').checked,include:$('#batch-include').value,exclude:$('#batch-exclude').value,encoding:$('#batch-encoding').value};
      const result=await window.desktop.replacementPreview({scope:scope==='folder'?'folder':'buffers',options,...(scope==='folder'?{}:{buffers:selected.map(doc=>({id:doc.id,name:doc.name,text:doc.state.doc.toString()}))})});
      if(version!==generation || !status.isConnected || !$('#dialog').open)return;
      if(!result || result.error || result.cancelled){status.textContent=result?.error || 'Preview cancelled.';return;}
      plan={...result,scope};apply.disabled=false;
      status.textContent=`${result.entries.reduce((n,e)=>n+e.count,0)} matches in ${result.entries.length} changed files/buffers. ${result.skipped.length} skipped.${result.capped?' Limit reached — preview is incomplete.':''}${scope==='buffers'?' Read-only buffers excluded.':''}`;
      for(const entry of result.entries){
        const row=document.createElement('div'), check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.id=entry.id;check.setAttribute('aria-label',`Apply ${entry.name}`);
        row.append(check,button(`${entry.path || entry.name} — ${entry.count} matches`,()=>{diff.replaceChildren();compareTexts(entry.before,entry.after,diff);}));files.append(row);
      }
      if(result.skipped.length){const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('pre');summary.textContent='Skipped files and reasons';list.textContent=result.skipped.map(e=>`${e.path}: ${e.reason}`).join('\n');details.append(summary,list);files.append(details);}
    });
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel preview';cancel.onclick=()=>{if(applying)return;generation++;plan=null;window.desktop.replacementCancel();status.textContent='Preview cancelled. No changes applied.';files.replaceChildren();diff.replaceChildren();};
    const apply=button('Apply selected changes',async()=>{
      if(!plan)throw new Error('Preview changes first.');
      const entries=plan.entries.filter(e=>[...files.querySelectorAll('input:checked')].some(input=>input.dataset.id===e.id));
      if(!entries.length)throw new Error('Select at least one changed file or buffer.');
      if(plan.scope==='folder'){
        const preventClose=event=>event.preventDefault();$('#dialog').addEventListener('cancel',preventClose);$('#dialog-close').disabled=true;
        applying=true;cancel.disabled=true;apply.disabled=true;preview.disabled=true;body.querySelectorAll('input,textarea,select').forEach(input=>input.disabled=true);status.textContent='Applying selected files…';
        try{const result=await window.desktop.replacementApply({id:plan.id,selected:entries.map(e=>e.id)});plan=null;status.textContent=result?.ok?`Updated ${result.count} files. Recovery copies: ${result.recovery}`:`Replacement failed: ${result?.error || 'Unknown error'}.${result?.recovery?` Recovery copies: ${result.recovery}. ${result.rollback.filter(e=>e.restored).length} files restored; ${result.rollback.filter(e=>!e.restored).length} require recovery review.`:''}`;}
        finally{applying=false;cancel.disabled=false;preview.disabled=false;$('#dialog').removeEventListener('cancel',preventClose);$('#dialog-close').disabled=false;body.querySelectorAll('input,textarea,select').forEach(input=>input.disabled=false);}
      } else {
        for(const entry of entries){const snapshot=snapshots.get(entry.id);if(!snapshot || !docs.includes(snapshot.doc) || snapshot.doc.state.doc!==snapshot.text || snapshot.doc.state.readOnly)throw new Error('A selected buffer changed or became read-only. Preview again.');}
        const previous=ctx.active;
        for(const entry of entries){activate(snapshots.get(entry.id).doc,false);view.dispatch({changes:entry.changes,annotations:isolateHistory.of('full')});}
        activate(previous);closeDialog();
      }
    });
    body.append(preview,cancel,apply);
  };
}
