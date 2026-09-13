import {StateField,StateEffect} from '@codemirror/state';
import {Decoration,EditorView} from '@codemirror/view';

export const setMarks=StateEffect.define();
export function validMarks(value,length){
  if(!Array.isArray(value))return [];
  const unique=new Map();
  for(const mark of value)if(mark&&Number.isInteger(mark.from)&&Number.isInteger(mark.to)&&mark.from>=0&&mark.to>mark.from&&mark.to<=length&&Number.isInteger(mark.color)&&mark.color>=1&&mark.color<=5)unique.set(`${mark.color}:${mark.from}:${mark.to}`,{from:mark.from,to:mark.to,color:mark.color});
  if(unique.size>10000)throw new Error('More than 10,000 unique marks.');
  return [...unique.values()].sort((a,b)=>a.from-b.from||a.to-b.to||a.color-b.color);
}
export const marks=StateField.define({
  create:()=>[],
  update(value,tr){
    const removed=[];if(tr.docChanged)tr.changes.iterChangedRanges((from,to)=>{if(to>from)removed.push({from,to});});
    const covered=mark=>{let low=0,high=removed.length;while(low<high){const mid=(low+high)>>1;if(removed[mid].from<=mark.from)low=mid+1;else high=mid;}return low>0&&removed[low-1].to>=mark.to;};
    let next=tr.docChanged?value.filter(mark=>!covered(mark)).map(mark=>({...mark,from:tr.changes.mapPos(mark.from,1),to:tr.changes.mapPos(mark.to,-1)})):value;
    for(const effect of tr.effects)if(effect.is(setMarks))next=effect.value;
    return next===value?value:validMarks(Array.isArray(next)?next.slice(0,10000):next,tr.newDoc.length);
  },
  provide:field=>EditorView.decorations.from(field,value=>Decoration.set(value.map(mark=>Decoration.mark({class:`openpad-mark openpad-mark-${mark.color}`}).range(mark.from,mark.to)),true))
});
export function literalMarks(text,query,color){
  if(!query)throw new Error('Select nonempty text to mark.');
  const result=[];let from=0;
  while((from=text.indexOf(query,from))!==-1){if(result.length===10000)throw new Error('More than 10,000 matches; select a more specific phrase.');result.push({from,to:from+query.length,color});from+=query.length;}
  return result;
}
export function installMarks(ctx,ui){
  const {commands,$}=ctx,{show,body,button,closeDialog,labels}=ui;
  let color=Number.isInteger(ctx.settings.markColor)&&ctx.settings.markColor>=1&&ctx.settings.markColor<=5?ctx.settings.markColor:1;
  window.addEventListener('openpad-activate',()=>{color=Number.isInteger(ctx.settings.markColor)&&ctx.settings.markColor>=1&&ctx.settings.markColor<=5?ctx.settings.markColor:1;});
  let requestId=0;
  commands.markText=()=>{
    const view=ctx.editorView();
    const doc=ctx.active,original=view.state.doc,selection=view.state.selection;
    show('Color marks','<p>Mark selections or every exact, case-sensitive occurrence of the primary selection. Marks follow edits and persist with recovery. Replacing or deleting a marked range removes it.</p><label>Color <select id="mark-color"><option value="1">Yellow</option><option value="2">Green</option><option value="3">Blue</option><option value="4">Pink</option><option value="5">Purple</option></select></label>');$('#mark-color').value=String(color);$('#mark-color').onchange=()=>{color=+$('#mark-color').value;ctx.settings.markColor=color;ctx.snapshot();};
    const controls=document.createElement('div');controls.innerHTML='<label>Search expression <input id="mark-query" maxlength="32768"></label><label><input type="checkbox" id="mark-regex"> JavaScript regular expression</label><label><input type="checkbox" id="mark-case" checked> Case sensitive</label><label><input type="checkbox" id="mark-word"> Whole words</label><label><input type="checkbox" id="mark-dotall"> Dot matches newline</label><p>Expression matching runs on the captured buffer. Changing options cancels pending matching. Empty matches have no colored range; at most 10,000 matches are accepted.</p><p id="mark-status"></p>';body.append(controls);$('#mark-query').value=original.sliceString(selection.main.from,selection.main.to).slice(0,32768);
    let activeRequest=0;const cancel=()=>{if(activeRequest){window.desktop.cancelMarks(activeRequest);activeRequest=0;}if(controls.isConnected)$('#mark-status').textContent='Cancelled';};const dialog=$('#dialog'),dispose=()=>{cancel();dialog.removeEventListener('close',dispose);dialog.removeEventListener('openpad-dialog-replace',dispose);};dialog.addEventListener('close',dispose);dialog.addEventListener('openpad-dialog-replace',dispose);
    const changed=()=>{if(activeRequest)cancel();};controls.addEventListener('input',changed);$('#mark-color').addEventListener('input',changed);
    // Cancellation must bypass the command lock held by the pending match request.
    const cancelButton=button('Cancel matching',cancel);cancelButton.onclick=cancel;
    body.append(button('Mark expression matches',async()=>{
      const id=++requestId;activeRequest=id;const selectedColor=+$('#mark-color').value;$('#mark-status').textContent='Matching…';
      const result=await window.desktop.markMatches({id,text:original.toString(),options:{query:$('#mark-query').value,regex:$('#mark-regex').checked,caseSensitive:$('#mark-case').checked,wholeWord:$('#mark-word').checked,dotAll:$('#mark-dotall').checked}});
      if(activeRequest!==id||!controls.isConnected)return;activeRequest=0;if(result?.cancelled){$('#mark-status').textContent='Cancelled';return;}if(!result||result.error){$('#mark-status').textContent=result?.error||'Marking failed';return;}
      if(!view.dom.isConnected||ctx.active!==doc||view.state.doc!==original){$('#mark-status').textContent='Document changed; reopen Color marks.';return;}
      if(!result.ranges.length){$('#mark-status').textContent='No nonempty matches';return;}
      const combined=validMarks([...view.state.field(marks),...result.ranges.map(range=>({...range,color:selectedColor}))],original.length);view.dispatch({effects:setMarks.of(combined)});closeDialog();
    }),cancelButton);
    const apply=all=>{if(!view.dom.isConnected||ctx.active!==doc||view.state.doc!==original)throw new Error('Document changed; reopen Color marks.');color=+$('#mark-color').value;const added=all?literalMarks(original.toString(),original.sliceString(selection.main.from,selection.main.to),color):selection.ranges.filter(range=>!range.empty).map(range=>({from:range.from,to:range.to,color}));if(!added.length)throw new Error('Select nonempty text to mark.');const combined=validMarks([...view.state.field(marks),...added],original.length);view.dispatch({effects:setMarks.of(combined)});closeDialog();};
    body.append(button('Mark selections',()=>apply(false)),button('Mark all exact matches',()=>apply(true)),button('Clear this color',()=>{if(!view.dom.isConnected||ctx.active!==doc||view.state.doc!==original)throw new Error('Document changed; reopen Color marks.');color=+$('#mark-color').value;view.dispatch({effects:setMarks.of(view.state.field(marks).filter(mark=>mark.color!==color))});closeDialog();}));
  };
  const jump=reverse=>{const view=ctx.editorView();const list=view.state.field(marks).filter(mark=>mark.color===color);if(!list.length)return;const position=view.state.selection.main.from;const mark=reverse?[...list].reverse().find(mark=>mark.from<position)??list.at(-1):list.find(mark=>mark.from>position)??list[0];view.dispatch({selection:{anchor:mark.from,head:mark.to},scrollIntoView:true});};
  commands.markNext=()=>jump(false);commands.markPrevious=()=>jump(true);
  commands.markCopy=()=>{const view=ctx.editorView();return window.desktop.copyText(view.state.field(marks).filter(mark=>mark.color===color).map(mark=>view.state.sliceDoc(mark.from,mark.to)).join('\n'));};
  commands.markClear=()=>ctx.editorView().dispatch({effects:setMarks.of([])});
  Object.assign(labels,{markText:'Color marks: selection or matching text',markNext:'Next mark in current color',markPrevious:'Previous mark in current color',markCopy:'Copy marked text in current color',markClear:'Clear all color marks'});
}
