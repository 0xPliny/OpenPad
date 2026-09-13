export const operations = {
  upper:'UPPERCASE',lower:'lowercase',title:'Title Case',sentence:'Sentence case',invert:'iNVERT cASE',
  sort:'Sort lines alphabetically',reverseSort:'Sort lines descending',natural:'Sort lines naturally (2 before 10)',numeric:'Sort lines numerically',reverse:'Reverse line order',unique:'Remove duplicate lines',
  join:'Join lines with spaces',empty:'Remove empty lines',blank:'Remove blank / whitespace-only lines',trim:'Trim trailing whitespace',tabs:'Tabs to spaces',spaces:'Leading spaces to tabs'
};
export const lineOperations = new Set(['sort','reverseSort','natural','numeric','reverse','unique','join','empty','blank','trim','tabs','spaces']);
export function transform(text,operation,tabSize=4) {
  if(typeof text!=='string' || text.length>32*1024*1024)throw new Error('Transformation exceeds 32 MiB.');
  if(!Number.isInteger(tabSize)||tabSize<1||tabSize>8)throw new Error('Tab size must be 1–8.');
  let result;
  if(operation==='upper')result=text.toUpperCase();
  else if(operation==='lower')result=text.toLowerCase();
  else if(operation==='invert')result=Array.from(text,char=>char===char.toUpperCase()?char.toLowerCase():char.toUpperCase()).join('');
  else if(operation==='title')result=text.toLowerCase().replace(/\p{L}[\p{L}\p{M}\p{N}'’]*/gu,word=>Array.from(word)[0].toUpperCase()+word.slice(Array.from(word)[0].length));
  else if(operation==='sentence')result=text.toLowerCase().replace(/(^|[.!?]\s+)(\p{L})/gu,(_match,prefix,char)=>prefix+char.toUpperCase());
  else {
    const trailing=text.endsWith('\n'),lines=(trailing?text.slice(0,-1):text).split('\n');let output;
    switch(operation){
      case 'sort':output=lines.sort();break;
      case 'reverseSort':output=lines.sort().reverse();break;
      case 'natural':output=lines.sort(new Intl.Collator('en',{numeric:true}).compare);break;
      case 'numeric':if(lines.some(line=>!line.trim() || !Number.isFinite(Number(line))))throw new Error('Numeric sort requires a finite number on every selected line.');output=lines.sort((a,b)=>Number(a)-Number(b));break;
      case 'reverse':output=lines.reverse();break;
      case 'unique':output=[...new Set(lines)];break;
      case 'join':output=[lines.map(line=>line.trim()).join(' ')];break;
      case 'empty':output=lines.filter(line=>line.length);break;
      case 'blank':output=lines.filter(line=>line.trim().length);break;
      case 'trim':output=lines.map(line=>line.replace(/[\t ]+$/g,''));break;
      case 'tabs':output=lines.map(line=>{let column=0;return Array.from(line,char=>{if(char==='\t'){const count=tabSize-column%tabSize;column+=count;return ' '.repeat(count);}column++;return char;}).join('');});break;
      case 'spaces':output=lines.map(line=>line.replace(/^[ \t]+/,indent=>{let column=0;for(const char of indent)column+=char==='\t'?tabSize-column%tabSize:1;return '\t'.repeat(Math.floor(column/tabSize))+' '.repeat(column%tabSize);}));break;
      default:throw new Error('Unknown text transformation.');
    }
    result=output.join('\n')+(trailing&&output.length?'\n':'');
  }
  if(result.length>32*1024*1024)throw new Error('Transformation output exceeds 32 MiB.');
  return result;
}

export function transformationChanges(state,operation,tabSize=4){
  const selected=state.selection.ranges.filter(range=>!range.empty);
  const ranges=(selected.length?selected:[{from:0,to:state.doc.length}]).map(range=>{
    if(!lineOperations.has(operation))return {from:range.from,to:range.to};
    const end=range.to>range.from&&state.doc.lineAt(range.to).from===range.to?range.to-1:range.to;
    return {from:state.doc.lineAt(range.from).from,to:state.doc.lineAt(end).to};
  });
  const removing=operation==='blank'||operation==='empty',merged=[];
  for(const range of ranges){const last=merged.at(-1);if(last&&(removing?range.from<=last.to+1:range.from<last.to))last.to=Math.max(last.to,range.to);else merged.push({...range});}
  let length=state.doc.length;
  return merged.flatMap(range=>{
    if(removing){
      // Merge adjacent selected lines before consuming their separator, especially at EOF.
      if(range.to<state.doc.length)range.to++;
      else if(range.from>0&&transform(state.doc.sliceString(range.from,range.to),operation,tabSize)==='')range.from--;
    }
    const before=state.doc.sliceString(range.from,range.to),insert=transform(before,operation,tabSize);
    length+=insert.length-before.length;if(length>32*1024*1024)throw new Error('Transformation output exceeds 32 MiB.');
    return before===insert?[]:[{...range,insert}];
  });
}
