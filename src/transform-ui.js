import {isolateHistory} from '@codemirror/commands';
import {foldAll,unfoldAll,foldCode,unfoldCode} from '@codemirror/language';
import {operations,transformationChanges} from './transform-model.mjs';
export function installTransforms(ctx,ui){
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,compareTexts,labels}=ui;
  function apply(operation){const view=ctx.editorView();if(view.state.readOnly)throw new Error('The buffer is read-only.');const changes=transformationChanges(view.state,operation,settings.tabSize);if(changes.length)view.dispatch({changes,annotations:isolateHistory.of('full')});}
  commands.transform=()=>{
    const view=ctx.editorView();
    if(view.state.readOnly)throw new Error('The buffer is read-only.');
    const doc=ctx.active,original=view.state.doc,selection=view.state.selection;let preview=null;
    show('Transform text','<p>Uses every nonempty selection, or the whole buffer if nothing is selected. Line operations expand selections to full lines and combine overlapping ranges. Tabs use the configured width; other Unicode characters count as one column.</p><label>Operation <select id="transform-operation"></select></label><div id="transform-diff"></div>');
    for(const [value,label] of Object.entries(operations))$('#transform-operation').add(new Option(label,value));
    $('#transform-operation').onchange=()=>{preview=null;$('#transform-diff').replaceChildren();};
    const unchanged=()=>view.dom.isConnected&&ctx.active===doc&&view.state.doc===original&&view.state.selection.eq(selection)&&!view.state.readOnly;
    body.append(button('Preview transformation',()=>{if(!unchanged())throw new Error('The buffer or selection changed. Reopen Transform text.');const operation=$('#transform-operation').value;preview=transformationChanges(view.state,operation,settings.tabSize);$('#transform-diff').replaceChildren();compareTexts(original.toString(),view.state.changes(preview).apply(original).toString(),$('#transform-diff'));}),button('Apply transformation',()=>{if(!preview)throw new Error('Preview the transformation first.');if(!unchanged())throw new Error('The buffer or selection changed. Reopen Transform text.');view.dispatch({changes:preview,annotations:isolateHistory.of('full')});closeDialog();}));
  };
  for(const [name,operation] of Object.entries({uppercase:'upper',lowercase:'lower',titleCase:'title',sortLines:'sort',dedupe:'unique',trim:'trim',joinLines:'join',removeBlank:'blank',tabsToSpaces:'tabs',spacesToTabs:'spaces'})){commands[name]=()=>apply(operation);labels[name]=operations[operation];}
  for(const [name,command] of Object.entries({foldAll,unfoldAll,foldCode,unfoldCode}))commands[name]=()=>command(ctx.editorView());
  commands.whitespace=()=>{settings.whitespace=!settings.whitespace;ctx.applySettings();};
  Object.assign(labels,{transform:'Transform selected text or buffer',foldAll:'Fold all',unfoldAll:'Unfold all',foldCode:'Fold at cursor',unfoldCode:'Unfold at cursor',whitespace:'Show whitespace and trailing spaces'});
}
