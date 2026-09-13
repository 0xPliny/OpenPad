const maxBytes=1024*1024,maxHeadings=1000;
const tokenizers=new Set(['o200k_base','cl100k_base','chars4']),counters=new Map();
function validate(text,tokenizer='o200k_base'){
  if(typeof text!=='string'||text.length>maxBytes||!text.isWellFormed()||Buffer.byteLength(text,'utf8')>maxBytes)throw new Error('Context meter accepts valid Unicode text up to 1 MiB of UTF-8 bytes.');
  if(!tokenizers.has(tokenizer))throw new Error('Choose o200k_base, cl100k_base, or the chars4 heuristic.');
}
function counter(tokenizer){
  if(tokenizer==='chars4')return text=>{let characters=0;for(const character of text)characters++;return Math.ceil(characters/4);};
  if(!counters.has(tokenizer)){
    const api=require(`gpt-tokenizer/encoding/${tokenizer}`);
    // File contents are ordinary text, even when they spell a tokenizer's special marker.
    const options={allowedSpecial:new Set(),disallowedSpecial:new Set()};
    counters.set(tokenizer,text=>api.countTokens(text,options));
  }
  return counters.get(tokenizer);
}
function markdownSections(text){
  validate(text);
  const lines=[];let offset=0;
  for(const raw of text.split(/(?<=\n)|(?<=\r)(?!\n)/)){lines.push({text:raw.replace(/\r\n$|[\r\n]$/,''),from:offset});offset+=raw.length;}
  let first=0;
  if(/^\uFEFF?---[ \t]*$/.test(lines[0].text)){
    const end=lines.findIndex((line,index)=>index>0&&/^(?:---|\.\.\.)[ \t]*$/.test(line.text));
    if(end>0)first=end+1;
  }
  const headings=[];let fence=null,paragraph=[];
  const add=(title,level,from,line)=>{if(headings.length>=maxHeadings)throw new Error('Context meter supports at most 1,000 Markdown headings.');headings.push({title:title||'(untitled)',level,from,to:text.length,line});};
  for(let i=first;i<lines.length;i++){
    const line=lines[i],content=i===0?line.text.replace(/^\uFEFF/,''):line.text;
    if(fence){const close=/^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(content);if(close&&close[1][0]===fence[0]&&close[1].length>=fence.length)fence=null;continue;}
    const opening=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
    if(opening&&!(opening[1][0]==='`'&&opening[2].includes('`'))){fence=opening[1];paragraph=[];continue;}
    if(!content.trim()||/^(?: {4}|\t)/.test(content)){paragraph=[];continue;}
    const atx=/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(content);
    if(atx){const title=(atx[2]||'').replace(/(?:^|[ \t]+)#+[ \t]*$/,'').trim();add(title,atx[1].length,line.from,i+1);paragraph=[];continue;}
    const setext=/^ {0,3}(=+|-+)[ \t]*$/.exec(content);
    if(setext&&paragraph.length){add(paragraph.map(index=>lines[index].text.trim()).join(' '),setext[1][0]==='='?1:2,lines[paragraph[0]].from,paragraph[0]+1);paragraph=[];continue;}
    // This outline covers top-level blocks, not headings nested in lists, quotes, or HTML.
    if(setext||/^ {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$|<)/.test(content)){paragraph=[];continue;}
    paragraph.push(i);
  }
  const stack=[];
  for(const heading of headings){while(stack.length&&stack.at(-1).level>=heading.level)stack.pop().to=heading.from;stack.push(heading);}
  return [{title:'Preamble',level:0,from:0,to:headings[0]?.from??text.length,line:1},...headings];
}
function measureContext({text,tokenizer='o200k_base'}={}){
  validate(text,tokenizer);const sections=markdownSections(text),count=counter(tokenizer);
  return {total:count(text),sections:sections.map(section=>({...section,tokens:count(text.slice(section.from,section.to))})),lines:text.split(/\r\n|\r|\n/).length,bytes:Buffer.byteLength(text,'utf8'),tokenizer,approximate:tokenizer==='chars4',sectionsOverlap:true,
    note:tokenizer==='chars4'?'Heuristic: ceil(Unicode code points / 4), not an exact Claude or other model tokenizer. Subtree totals overlap and are not additive.':'Exact tokenization of this text with the selected encoding, excluding chat/tool framing. Literal special markers are ordinary text. Subtree totals overlap and are not additive.'};
}
module.exports={measureContext,markdownSections,validate,maxBytes,maxHeadings};
