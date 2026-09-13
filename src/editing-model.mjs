import {countColumn,findClusterBreak} from '@codemirror/state';

export function insertionColumn(text,tabSize){return countColumn(text,tabSize)+1;}

export function columnChanges(text, options) {
  const { startLine, endLine, column, mode = 'text', value = '', start = 1, step = 1, repeat = 1, width = 0, columnMode='characters',tabSize=4 } = options;
  const lines = text.split('\n');
  if (![startLine,endLine,column,repeat,width].every(Number.isInteger) || startLine < 1 || endLine < startLine || endLine > lines.length || column < 1 || column > 1000000 || repeat < 1 || width < 0 || width > 30 || endLine - startLine > 100000) throw new Error('Invalid line range, column, repeat or padding.');
  if (/[\r\n]/.test(value)) throw new Error('Column text must fit on one line.');
  if (mode !== 'text' && mode !== 'number') throw new Error('Choose text or number insertion.');
  if(!['characters','tabs'].includes(columnMode)||!Number.isInteger(tabSize)||tabSize<1||tabSize>8)throw new Error('Choose character or tab-stop columns and a tab width from 1 to 8.');
  if (mode === 'number' && (!Number.isSafeInteger(start) || !Number.isSafeInteger(step))) throw new Error('Start and step must be safe integers.');
  const changes = []; let offset = 0, outputLength=text.length;
  for (let i = 0; i < lines.length; i++) {
    if (i >= startLine - 1 && i < endLine) {
      const line=lines[i];let from=0,to=0,padding=0,trailing=0;
      if(columnMode==='characters'){
        const chars=Array.from(line);from=to=chars.slice(0,column-1).join('').length;padding=Math.max(0,column-1-chars.length);
      }else{
        const target=column-1;let position=0;
        while(from<line.length&&position<target){
          const tab=line.charCodeAt(from)===9,next=position+(tab?tabSize-position%tabSize:1);
          if(next>target){padding=target-position;trailing=next-target;to=from+1;break;}
          position=next;from=findClusterBreak(line,from);to=from;
        }
        if(from===line.length)padding=target-position;
      }
      let inserted = value;
      if (mode === 'number') { const number = start + Math.floor((i - startLine + 1) / repeat) * step; if (!Number.isSafeInteger(number)) throw new Error('Number sequence exceeds safe integer range.'); inserted = (number < 0 ? '-' : '') + String(Math.abs(number)).padStart(width,'0'); }
      // Expand only an intersected tab so insertion can land between its tab stops without altering other tabs.
      outputLength+=padding+inserted.length+trailing-(to-from);if(outputLength>32*1024*1024)throw new Error('Column output exceeds 32 MiB of text.');
      changes.push({ from:offset+from,to:offset+to,insert:' '.repeat(padding)+inserted+' '.repeat(trailing) });
    }
    offset += lines[i].length + 1;
  }
  return changes;
}

export function macroStep(transaction) {
  const base = transaction.startState.selection.main.head;
  const changes = [];
  transaction.changes.iterChanges((from,to,_a,_b,insert) => changes.push({ from:from - base, to:to - base, insert:insert.toString() }));
  return { changes, mainIndex:transaction.newSelection.mainIndex, ranges:transaction.newSelection.ranges.map(range => ({ anchor:range.anchor - base, head:range.head - base })) };
}

export function replayMacro(state, steps, count = 1) {
  const untilEnd=count==='end';
  if (!untilEnd&&(!Number.isInteger(count) || count < 1 || count > 1000 || steps.length * count > 10000)) throw new Error('Macro repetition is limited to 1,000 repeats / 10,000 steps.');
  if (!steps.length) throw new Error('Record an editing macro first.');
  let current = state;
  let combined=state.changes([]);
  let repetitions=0,executed=0;
  while(untilEnd?current.selection.main.head<current.doc.length:repetitions<count){
    if(repetitions>=1000)throw new Error('Macro repetition is limited to 1,000 repeats / 10,000 steps. No changes applied.');
    const distance=current.doc.length-current.selection.main.head;
    for(const step of steps){
    if(++executed>10000)throw new Error('Macro repetition is limited to 1,000 repeats / 10,000 steps. No changes applied.');
    const base = current.selection.main.head;
    const changes = step.changes.map(change => ({ ...change, from:base + change.from, to:base + change.to }));
    if (changes.some(change => change.from < 0 || change.to < change.from || change.to > current.doc.length)) throw new Error('Macro would edit outside the document. No changes applied.');
    const transaction = current.update({ changes });
    combined=combined.compose(transaction.changes);
    const ranges = step.ranges.map(range => ({anchor:base + range.anchor,head:base + range.head}));
    if (ranges.some(range => Math.min(range.anchor,range.head) < 0 || Math.max(range.anchor,range.head) > transaction.newDoc.length)) throw new Error('Macro selection would leave the document. No changes applied.');
    // Use the state's Selection constructor without creating a second editor history.
    const Selection = current.selection.constructor;
    current = transaction.state.update({selection:Selection.create(ranges.map(range=>Selection.range(range.anchor,range.head)),step.mainIndex || 0)}).state;
    if(current.doc.length > 32 * 1024 * 1024) throw new Error('Macro output exceeds 32 MiB of text. No changes applied.');
  }
    repetitions++;
    if(untilEnd&&current.doc.length-current.selection.main.head>=distance)throw new Error('Macro must move toward document end after every repetition. No changes applied.');
  }
  return {doc:current.doc,selection:current.selection,changes:combined,repetitions};
}
