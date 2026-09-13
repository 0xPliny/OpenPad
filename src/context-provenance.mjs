import {StateField,StateEffect,Transaction} from '@codemirror/state';
import {gutter,GutterMarker} from '@codemirror/view';

export const setObservation=StateEffect.define();
class ObservationMarker extends GutterMarker{
  constructor(event){super();this.event=event;}
  toDOM(){const node=document.createElement('span');node.className='context-observation-marker';node.textContent='◇';node.title=`Observed disk change · writer unknown · session ${this.event.sessionId}${this.event.ranges.approximate?' · conservative grouped range':''}`;node.setAttribute('aria-label',node.title);return node;}
}
export const observationField=StateField.define({
  create:()=>null,
  update(value,tr){
    // Once text changes, old attribution coordinates are no longer evidence for this revision.
    let next=tr.docChanged?null:value;
    for(const effect of tr.effects)if(effect.is(setObservation))next=effect.value?.ranges?{event:effect.value,marker:new ObservationMarker(effect.value)}:null;
    return next;
  }
});
export const observationGutter=gutter({class:'context-provenance',lineMarker:(view,line)=>{
  const value=view.state.field(observationField);if(!value)return null;
  const number=view.state.doc.lineAt(line.from).number,{after,deletionAnchor}=value.event.ranges;
  return (number>=after.fromLine&&number<after.toLine)||(deletionAnchor!==null&&number===Math.min(deletionAnchor,view.state.doc.lines))?value.marker:null;
},lineMarkerChange:update=>update.startState.field(observationField)!==update.state.field(observationField)});

export function installProvenance(ctx){
  let generation=0,timer;
  function schedule(){
    clearTimeout(timer);const request=++generation,doc=ctx.active;if(!doc)return;
    if(doc.state.field(observationField))ctx.editorView().dispatch({effects:setObservation.of(null),annotations:Transaction.addToHistory.of(false)});
    timer=setTimeout(async()=>{
      const original=doc.state.doc;if(!doc.path||original.length>2*1024*1024)return;
      const event=await window.desktop.contextObservation({id:doc.id,text:original.toString()});
      if(request!==generation||ctx.active!==doc||doc.state.doc!==original)return;
      ctx.editorView().dispatch({effects:setObservation.of(event),annotations:Transaction.addToHistory.of(false)});
    },150);
  }
  for(const event of ['openpad-ready','openpad-activate','openpad-edit','openpad-context-session'])window.addEventListener(event,schedule);
}
