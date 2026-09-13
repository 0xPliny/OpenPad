import {moveLineUp,moveLineDown,copyLineUp,copyLineDown,deleteLine,indentMore,indentLess,indentSelection,toggleLineComment,toggleBlockComment,selectLine,selectParentSyntax,selectMatchingBracket,cursorMatchingBracket,addCursorAbove,addCursorBelow,simplifySelection} from '@codemirror/commands';
import { StateField, StateEffect, EditorState } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { columnChanges, insertionColumn, macroStep, replayMacro } from './editing-model.mjs';

export const setBookmarks = StateEffect.define();
export const bookmarks = StateField.define({
  create:()=>[],
  update(value,tr) {
    let next=value.map(position=>tr.newDoc.lineAt(tr.changes.mapPos(position,1)).from);
    for(const effect of tr.effects) if(effect.is(setBookmarks)) next=effect.value;
    return [...new Set(next)].filter(position=>position>=0 && position<=tr.newDoc.length).sort((a,b)=>a-b);
  }
});
class BookmarkMarker extends GutterMarker {
  toDOM(){const span=document.createElement('span');span.textContent='●';span.title='Bookmark';span.className='bookmark-marker';return span;}
}
const marker=new BookmarkMarker();
export const bookmarkExtension=[bookmarks,gutter({class:'bookmarks',lineMarker:(view,line)=>view.state.field(bookmarks).includes(line.from)?marker:null,initialSpacer:()=>marker,lineMarkerChange:update=>update.startState.field(bookmarks)!==update.state.field(bookmarks),domEventHandlers:{mousedown:(view,line)=>{const current=view.state.field(bookmarks);view.dispatch({effects:setBookmarks.of(current.includes(line.from)?current.filter(p=>p!==line.from):[...current,line.from])});return true;}}})];

export function installEditing(ctx,ui) {
  const {commands,view,settings,$,docs}=ctx;
  const {show,body,button,closeDialog,listPicker,labels}=ui;
  const editorCommands={moveLineUp,moveLineDown,copyLineUp,copyLineDown,deleteLine,indentMore,indentLess,indentSelection,toggleLineComment,toggleBlockComment,selectLine,selectParentSyntax,selectMatchingBracket,cursorMatchingBracket,addCursorAbove,addCursorBelow,simplifySelection};
  for(const [name,action] of Object.entries(editorCommands))commands[name]=()=>{if($('#dialog').open)throw new Error('Close the dialog before applying an editor command.');const target=ctx.editorView?.()||view;action(target);target.focus();};
  Object.assign(labels,{moveLineUp:'Move lines up',moveLineDown:'Move lines down',copyLineUp:'Duplicate lines up',copyLineDown:'Duplicate lines down',deleteLine:'Delete lines',indentMore:'Increase indentation',indentLess:'Decrease indentation',indentSelection:'Reindent selection',toggleLineComment:'Toggle line comment',toggleBlockComment:'Toggle block comment',selectLine:'Select line',selectParentSyntax:'Expand syntax selection',selectMatchingBracket:'Select to matching bracket',cursorMatchingBracket:'Go to matching bracket',addCursorAbove:'Add cursor above',addCursorBelow:'Add cursor below',simplifySelection:'Reduce to primary selection'});
  let recording=null, lastMacro=[], replaying=false, monitoringBusy=false;
  settings.macros ||= {};
  const status=document.createElement('span');status.id='editing-status';$('footer>div').prepend(status);
  function writable(view=ctx.editorView()){if(!view.dom.isConnected)throw new Error('The invoking editor was closed; reopen the command.');if(view.state.readOnly)throw new Error('This document is read-only.');}
  commands.bookmarkToggle=()=>{const view=ctx.editorView();const position=view.state.doc.lineAt(view.state.selection.main.head).from;const list=view.state.field(bookmarks);view.dispatch({effects:setBookmarks.of(list.includes(position)?list.filter(p=>p!==position):[...list,position])});};
  const jump=reverse=>{const view=ctx.editorView();const list=view.state.field(bookmarks);if(!list.length)return;const position=view.state.selection.main.head;const next=reverse?[...list].reverse().find(p=>p<position)??list.at(-1):list.find(p=>p>position)??list[0];view.dispatch({selection:{anchor:next},scrollIntoView:true});};
  commands.bookmarkNext=()=>jump(false);commands.bookmarkPrevious=()=>jump(true);
  commands.bookmarkClear=()=>ctx.editorView().dispatch({effects:setBookmarks.of([])});
  commands.bookmarkCopy=async()=>window.desktop.copyText(ctx.editorView().state.field(bookmarks).map(p=>ctx.editorView().state.doc.lineAt(p).text).join('\n'));
  commands.bookmarkRemoveLines=()=>{const view=ctx.editorView();writable(view);const changes=view.state.field(bookmarks).map(p=>{const line=view.state.doc.lineAt(p);return {from:line.from,to:Math.min(view.state.doc.length,line.to+1)};});view.dispatch({changes,effects:setBookmarks.of([]),annotations:isolateHistory.of('full')});};
  commands.columnEditor=()=>{
    const view=ctx.editorView();writable(view);const original=view.state.doc;const doc=ctx.active;const selection=view.state.selection.main;
    show('Column insertion','<p>Insert text or a number sequence across a line range. Tab-stop columns use the current tab width and keep combining characters together. An intersected tab is expanded to spaces; short lines are padded. Character columns count each Unicode code point, including tabs, once.</p><label>First line <input id="column-first" type="number" min="1"></label><label>Last line <input id="column-last" type="number" min="1"></label><label>Column <input id="column-position" type="number" min="1"></label><label>Column units <select id="column-units"><option value="tabs">Tab stops</option><option value="characters">Unicode characters</option></select></label><label>Mode <select id="column-mode"><option value="text">Text</option><option value="number">Number sequence</option></select></label><label>Text <input id="column-text"></label><label>Start <input id="column-start" type="number" value="1"></label><label>Step <input id="column-step" type="number" value="1"></label><label>Repeat each number <input id="column-repeat" type="number" value="1" min="1"></label><label>Zero-pad digits <input id="column-width" type="number" value="0" min="0" max="30"></label>');
    $('#column-first').value=view.state.doc.lineAt(selection.from).number;$('#column-last').value=view.state.doc.lineAt(selection.to).number;const prefix=view.state.doc.sliceString(view.state.doc.lineAt(selection.from).from,selection.from);const tabSize=view.state.tabSize;const updateColumn=()=>{$('#column-position').value=$('#column-units').value==='tabs'?insertionColumn(prefix,tabSize):Array.from(prefix).length+1;};updateColumn();$('#column-units').onchange=updateColumn;
    body.append(button('Insert column',()=>{writable(view);if(ctx.active!==doc||view.state.doc!==original)throw new Error('Document changed; reopen Column insertion.');const changes=columnChanges(original.toString(),{startLine:+$('#column-first').value,endLine:+$('#column-last').value,column:+$('#column-position').value,columnMode:$('#column-units').value,tabSize,mode:$('#column-mode').value,value:$('#column-text').value,start:+$('#column-start').value,step:+$('#column-step').value,repeat:+$('#column-repeat').value,width:+$('#column-width').value});view.dispatch({changes,annotations:isolateHistory.of('full')});closeDialog();}));
  };
  commands.macroStart=()=>{writable();recording={id:ctx.active.id,steps:[]};status.textContent='Recording edits';};
  commands.macroStop=()=>{if(recording){lastMacro=recording.steps;recording=null;}status.textContent=`Macro: ${lastMacro.length} steps`;};
  window.addEventListener('openpad-transaction',event=>{
    const {doc,update}=event.detail;
    if(!recording||replaying||doc.monitoring)return;
    if(doc.id!==recording.id){commands.macroStop();return;}
    for(const transaction of update.transactions)if(transaction.docChanged||transaction.selection){recording.steps.push(macroStep(transaction));if(recording.steps.length>=1000){commands.macroStop();break;}}
  });
  window.addEventListener('openpad-activate',()=>{if(recording&&ctx.active.id!==recording.id)commands.macroStop();});
  const play=(steps,count,view=ctx.editorView())=>{writable(view);commands.macroStop();const result=replayMacro(view.state,steps,count);replaying=true;try{view.dispatch({changes:result.changes,selection:result.selection,annotations:isolateHistory.of('full')});}finally{replaying=false;}status.textContent=`Macro: ${result.repetitions} repetitions`;};
  commands.macroPlay=()=>play(lastMacro,1);
  commands.macroRepeat=()=>{commands.macroStop();const view=ctx.editorView(),doc=ctx.active,original=view.state.doc,selection=view.state.selection,steps=lastMacro;show('Repeat editing macro','<p>Editing macros record text changes and cursor movements in one document. File operations, dialogs and search commands are not recorded. Playback is relative to the current cursor and can be undone in one step.</p><label>Run <select id="macro-mode"><option value="count">Fixed repetitions</option><option value="end">Until document end</option></select></label><p>Until-end mode requires each complete repetition to reduce the text remaining after the primary cursor. It is limited to 1,000 repetitions and 10,000 steps; failure applies no changes.</p><label>Repetitions <input id="macro-count" type="number" value="1" min="1" max="1000"></label>');$('#macro-mode').onchange=()=>{$('#macro-count').disabled=$('#macro-mode').value==='end';};body.append(button('Run macro',()=>{if(!view.dom.isConnected||ctx.active!==doc||view.state.doc!==original||!view.state.selection.eq(selection))throw new Error('The invoking editor or selection changed; reopen Repeat editing macro.');const count=$('#macro-mode').value==='end'?'end':+$('#macro-count').value;play(steps,count,view);closeDialog();}));};
  commands.macroSave=()=>{commands.macroStop();if(!lastMacro.length)throw new Error('Record edits first.');show('Save editing macro','<label>Macro name <input id="macro-name" maxlength="80"></label>');body.append(button('Save macro',async()=>{const name=$('#macro-name').value.trim();if(!name)throw new Error('Enter a macro name.');settings.macros[name]=lastMacro;await ctx.snapshot();closeDialog();}));};
  commands.macroLoad=()=>listPicker('Load editing macro',Object.entries(settings.macros).map(([name,steps])=>({label:name,action:()=>{lastMacro=steps;status.textContent=`Macro: ${name}`;}})));
  commands.monitor=()=>{
    if(ctx.active.contextFollow)return commands.contextFollow();
    if(monitoringBusy)throw new Error('A monitoring read is finishing; try again in a moment.');const doc=ctx.active;if(!doc.path)throw new Error('Save this document before monitoring.');if(!doc.monitoring&&ctx.dirty(doc))throw new Error('Save or discard edits before monitoring.');commands.macroStop();doc.monitoring=!doc.monitoring;view.dispatch({effects:doc.writable.reconfigure(EditorState.readOnly.of(doc.readOnly||doc.locked||doc.monitoring))});status.textContent=doc.monitoring?'Monitoring disk file (read-only)':'Monitoring stopped';
  };
  function stopMonitor(doc,message){doc.monitoring=false;const effects=doc.writable.reconfigure(EditorState.readOnly.of(!!doc.readOnly||!!doc.locked));if(ctx.active===doc)view.dispatch({effects});else doc.state=doc.state.update({effects}).state;status.textContent=`Monitoring stopped: ${message}`;window.dispatchEvent(new Event('openpad-edit'));}
  setInterval(async()=>{
    if(monitoringBusy)return;monitoringBusy=true;
    try{for(const doc of docs.filter(doc=>doc.monitoring&&!doc.contextFollow)){
      const state=await window.desktop.diskState(doc.id);
      if(!docs.includes(doc)||!doc.monitoring)continue;
      if(state==='changed'){const data=await window.desktop.monitorRead(doc.id);if(data&&docs.includes(doc)&&doc.monitoring){if(data.error){stopMonitor(doc,data.error);continue;}ctx.reloadBuffer(doc,data);await window.desktop.monitorAccept(doc.id);if(ctx.active===doc){const target=ctx.editorView();target.dispatch({selection:{anchor:target.state.doc.length},scrollIntoView:true});}}}
      else if(state!=='unchanged')stopMonitor(doc,`file ${state}`);
    }}finally{monitoringBusy=false;}
  },1000);
  Object.assign(labels,{bookmarkToggle:'Toggle bookmark',bookmarkNext:'Next bookmark',bookmarkPrevious:'Previous bookmark',bookmarkClear:'Clear bookmarks',bookmarkCopy:'Copy bookmarked lines',bookmarkRemoveLines:'Remove bookmarked lines',columnEditor:'Column insertion: text / numbers',macroStart:'Start recording editing macro',macroStop:'Stop recording editing macro',macroPlay:'Play editing macro',macroRepeat:'Repeat editing macro',macroSave:'Save editing macro',macroLoad:'Load editing macro',monitor:'Toggle file monitoring'});
}
