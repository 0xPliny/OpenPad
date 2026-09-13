import {changeHistory,historyApproximate} from './change-history.mjs';
import {Decoration,ViewPlugin,WidgetType} from '@codemirror/view';
import {countColumn} from '@codemirror/state';

class EndOfLine extends WidgetType{toDOM(){const span=document.createElement('span');span.className='openpad-eol';span.textContent='↵';span.setAttribute('aria-hidden','true');return span;}}
const eol=new EndOfLine();
export function visibilityExtensions(settings){
  return ViewPlugin.fromClass(class{
    constructor(view){this.decorations=this.build(view);}
    update(update){if(update.docChanged||update.viewportChanged||update.geometryChanged)this.decorations=this.build(update.view);}
    build(view){const ranges=[];for(const {from,to} of view.visibleRanges){let number=view.state.doc.lineAt(from).number;const end=view.state.doc.lineAt(to).number;for(;number<=end;number++){const line=view.state.doc.line(number);if(settings.eolGlyphs&&line.to<view.state.doc.length)ranges.push(Decoration.widget({widget:eol,side:1}).range(line.to));if(settings.indentGuides){const leading=/^[\t ]*/.exec(line.text.slice(0,4096))[0],columns=countColumn(leading,view.state.tabSize);if(columns>=view.state.tabSize)ranges.push(Decoration.line({attributes:{style:`--guide-width:${columns}ch;--guide-step:${view.state.tabSize}ch`,class:'openpad-indent'} }).range(line.from));}if(settings.columnEdge)ranges.push(Decoration.line({attributes:{style:`--edge-column:${settings.columnEdge}ch`,class:'openpad-edge'}}).range(line.from));}}
      return Decoration.set(ranges,true);
    }
  },{decorations:plugin=>plugin.decorations});
}

export function installVisibility(ctx,ui){
  const {commands,settings,view,$}=ctx,{show,body,button,closeDialog,labels}=ui;
  const canvas=document.createElement('canvas');canvas.id='document-map';canvas.tabIndex=0;canvas.setAttribute('role','slider');canvas.setAttribute('aria-label','Document map line');canvas.setAttribute('aria-orientation','vertical');canvas.title='Document map — click to navigate; use arrow keys, Home or End';
  const wrapper=document.createElement('div');wrapper.className='editor-with-map';$('#editor').before(wrapper);wrapper.append($('#editor'),canvas);
  const historyStatus=document.createElement('span');historyStatus.id='change-history-status';$('footer>div').prepend(historyStatus);
  let pending=false;
  function draw(){const view=ctx.editorView();pending=false;const history=view.state.field(changeHistory,false);historyStatus.textContent=settings.changeHistory?(history?.paused?'Change bars paused (>1,000,000 characters)':history&&historyApproximate(history)?'Change bars may be approximate':''):'';canvas.hidden=!settings.documentMap;if(canvas.hidden)return;const height=Math.max(1,Math.floor(canvas.clientHeight)),width=90;canvas.width=width;canvas.height=height;const paint=canvas.getContext('2d'),doc=view.state.doc,rows=Math.min(height,1000,doc.lines),scale=height/rows;paint.fillStyle='#7d91a5';for(let row=0;row<rows;row++){const line=doc.line(Math.min(doc.lines,1+Math.floor(row*doc.lines/rows)));const prefix=line.text.slice(0,300),indent=/^[\t ]*/.exec(prefix)[0].length;const length=Math.min(80,prefix.length);if(length>indent)paint.fillRect(5+Math.min(75,indent),row*scale,Math.max(1,length-indent),1);}
    const first=doc.lineAt(view.viewport.from).number,last=doc.lineAt(view.viewport.to).number;paint.fillStyle='#76d5bd40';paint.fillRect(0,(first-1)/doc.lines*height,width,Math.max(3,(last-first+1)/doc.lines*height));paint.fillStyle='#76d5bd';const current=doc.lineAt(view.state.selection.main.head).number;paint.fillRect(0,(current-1)/doc.lines*height,width,2);canvas.setAttribute('aria-valuemin','1');canvas.setAttribute('aria-valuemax',String(doc.lines));canvas.setAttribute('aria-valuenow',String(current));
  }
  function schedule(){if(!pending){pending=true;requestAnimationFrame(draw);}}
  function navigate(number){const view=ctx.editorView();const line=view.state.doc.line(Math.max(1,Math.min(view.state.doc.lines,number)));view.dispatch({selection:{anchor:line.from},scrollIntoView:true});schedule();}
  canvas.onclick=event=>{const view=ctx.editorView();const rect=canvas.getBoundingClientRect();navigate(1+Math.floor((event.clientY-rect.top)/rect.height*view.state.doc.lines));view.focus();};
  canvas.onkeydown=event=>{const view=ctx.editorView();const current=view.state.doc.lineAt(view.state.selection.main.head).number,keys={ArrowDown:current+1,ArrowUp:current-1,PageDown:current+30,PageUp:current-30,Home:1,End:view.state.doc.lines};if(keys[event.key]!==undefined){event.preventDefault();navigate(keys[event.key]);}};
  new ResizeObserver(schedule).observe(wrapper);view.scrollDOM.addEventListener('scroll',schedule);for(const name of ['openpad-edit','openpad-activate','openpad-transaction','openpad-view'])window.addEventListener(name,schedule);
  commands.documentMap=()=>{settings.documentMap=!settings.documentMap;schedule();ctx.snapshot();};
  commands.visibility=()=>{show('Document visibility','<label><input id="show-history" type="checkbox"> Saved/unsaved change bars (up to 1,000,000 characters)</label><label><input id="show-eol" type="checkbox"> End-of-line glyphs</label><label><input id="show-guides" type="checkbox"> Indentation guides</label><label><input id="show-map" type="checkbox"> Document map</label><label>Column edge (0 disables) <input id="column-edge" type="number" min="0" max="1000"></label><p>The map samples line shapes and navigates by logical line. Indentation guides use tab stops; wrapped lines share their logical line guides. The edge assumes a monospaced font.</p>');$('#show-history').checked=!!settings.changeHistory;$('#show-eol').checked=!!settings.eolGlyphs;$('#show-guides').checked=!!settings.indentGuides;$('#show-map').checked=!!settings.documentMap;$('#column-edge').value=settings.columnEdge||0;body.append(button('Apply visibility',()=>{const edge=+$('#column-edge').value;if(!Number.isInteger(edge)||edge<0||edge>1000)throw new Error('Column edge must be 0–1,000.');Object.assign(settings,{changeHistory:$('#show-history').checked,eolGlyphs:$('#show-eol').checked,indentGuides:$('#show-guides').checked,documentMap:$('#show-map').checked,columnEdge:edge});ctx.applySettings();schedule();closeDialog();}));};
  Object.assign(labels,{documentMap:'Toggle document map',visibility:'Document visibility: guides, line endings and column edge'});schedule();
}
