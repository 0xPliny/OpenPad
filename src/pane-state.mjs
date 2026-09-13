import {Annotation,ChangeSet,EditorSelection,Transaction} from '@codemirror/state';
import {diff} from '@codemirror/merge';

export const paneSync=Annotation.define();

export function documentChanges(before,after){
  if(before===after)return ChangeSet.empty(before.length);
  const old=before.toString(),next=after.toString();let from=0,to=old.length,end=next.length;
  while(from<to&&from<end&&old[from]===next[from])from++;
  while(to>from&&end>from&&old[to-1]===next[end-1]){to--;end--;}
  if(Math.max(to-from,end-from)>1_000_000)return ChangeSet.of({from,to,insert:next.slice(from,end)},old.length);
  const changes=diff(old.slice(from,to),next.slice(from,end),{scanLimit:5000,timeout:15});
  return ChangeSet.of(changes.map(change=>({from:from+change.fromA,to:from+change.toA,insert:next.slice(from+change.fromB,from+change.toB)})),old.length);
}

export function peerState(canonical,peer,changes=documentChanges(peer.doc,canonical.doc)){
  if(changes.length!==peer.doc.length||changes.newLength!==canonical.doc.length)throw new Error('Pane changes do not match the document generations.');
  // Copy shared history and effects once; changing only the peer selection must not add another undo entry.
  return canonical.update({selection:peer.selection.map(changes),annotations:Transaction.addToHistory.of(false)}).state;
}

export function restoredSelection(value,length,fallback){
  try{
    if(!value||!Array.isArray(value.ranges)||value.ranges.length>10000)return fallback;
    const selection=EditorSelection.fromJSON(value),clamp=position=>Math.max(0,Math.min(length,position));
    return EditorSelection.create(selection.ranges.map(range=>EditorSelection.range(clamp(range.anchor),clamp(range.head))),selection.mainIndex);
  }catch{return fallback;}
}
export function scrollPosition(value){return {top:Number.isFinite(value?.top)&&value.top>=0?Math.min(value.top,1e9):0,left:Number.isFinite(value?.left)&&value.left>=0?Math.min(value.left,1e9):0};}
export function captureScroll(view){return {top:view.scrollDOM.scrollTop,left:view.scrollDOM.scrollLeft};}
export function restoreScroll(view,value){
  const position=scrollPosition(value),state=view.state;
  return new Promise(resolve=>{
    let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);if(view.dom.isConnected&&view.state.doc===state.doc&&view.state.selection.eq(state.selection)){view.scrollDOM.scrollTop=position.top;view.scrollDOM.scrollLeft=position.left;view.requestMeasure();}resolve();};
    // Minimized windows may suspend animation frames, but recovery must still complete.
    const timer=setTimeout(finish,100);requestAnimationFrame(finish);
  });
}
