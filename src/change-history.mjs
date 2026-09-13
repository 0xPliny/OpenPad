import {StateField,StateEffect} from '@codemirror/state';
import {gutter,GutterMarker} from '@codemirror/view';
import {Chunk} from '@codemirror/merge';
const limit=1_000_000,config={scanLimit:5000,timeout:15};
export const initializeHistory=StateEffect.define(),acceptSavedHistory=StateEffect.define(),toggleHistory=StateEffect.define();
export const changeHistory=StateField.define({
  create:state=>({base:state.doc,origin:state.doc,enabled:false,paused:false,unsaved:[],sinceOpen:[]}),
  update(value,tr){
    let next=value,rebuild=false;
    for(const effect of tr.effects){
      if(effect.is(initializeHistory)){next={...next,base:effect.value.saved,origin:effect.value.saved,enabled:effect.value.enabled};rebuild=true;}
      if(effect.is(acceptSavedHistory)){next={...next,base:effect.value};rebuild=true;}
      if(effect.is(toggleHistory)){next={...next,enabled:effect.value};rebuild=true;}
    }
    if(!tr.docChanged&&!rebuild)return value;
    const paused=Math.max(tr.newDoc.length,next.base.length,next.origin.length)>limit;
    if(!next.enabled||paused)return {...next,paused,unsaved:[],sinceOpen:[]};
    const update=(chunks,base)=>rebuild||value.paused?Chunk.build(base,tr.newDoc,config):Chunk.updateB(chunks,base,tr.newDoc,tr.changes,config);
    return {...next,paused:false,unsaved:update(next.unsaved,next.base),sinceOpen:update(next.sinceOpen,next.origin)};
  }
});
export function changedLine(chunks,line,length){
  let low=0,high=chunks.length;while(low<high){const middle=(low+high)>>1;if(Math.min(chunks[middle].fromB,length)<=line.to)low=middle+1;else high=middle;}
  if(!low)return false;const chunk=chunks[low-1],from=Math.min(chunk.fromB,length),to=Math.min(chunk.toB,length+1);return to>line.from||(from===to&&from>=line.from&&from<=line.to);
}
export function historyKind(state,line){const value=state.field(changeHistory);return changedLine(value.unsaved,line,state.doc.length)?'unsaved':changedLine(value.sinceOpen,line,state.doc.length)?'saved':null;}
export function historyApproximate(value){
  // The installed diff engine's large-span shortcut can omit its imprecise flag, so treat broad replacements conservatively.
  return [...value.unsaved,...value.sinceOpen].some(chunk=>!chunk.precise||Math.min(chunk.toA-chunk.fromA,chunk.toB-chunk.fromB)>config.scanLimit*16);
}
class HistoryMarker extends GutterMarker{
  constructor(kind){super();this.kind=kind;}
  toDOM(){const span=document.createElement('span');span.className=`change-marker change-${this.kind}`;span.textContent='▎';span.title=this.kind==='unsaved'?'Text differs from the last saved snapshot':'Text differs from the opening snapshot and matches the saved snapshot';return span;}
}
const markers={unsaved:new HistoryMarker('unsaved'),saved:new HistoryMarker('saved')};
export const historyGutter=gutter({class:'change-history',initialSpacer:()=>new class extends GutterMarker{toDOM(){const span=document.createElement('span');span.textContent='▎';return span;}}(),lineMarker:(view,line)=>markers[historyKind(view.state,view.state.doc.lineAt(line.from))]||null,lineMarkerChange:update=>update.startState.field(changeHistory)!==update.state.field(changeHistory)});
