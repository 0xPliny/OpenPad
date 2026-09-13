const {createHash}=require('node:crypto');
const {parser}=require('@lezer/markdown');
const {markdownSections,validate}=require('./context-meter.cjs');
const recognizedNames=new Set(['agents.md','claude.md','memory.md','skill.md','context.md','files.md','.cursorrules']);
const MAX_FINDINGS=1000;
function isoDay(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return null;const date=new Date(value+'T00:00:00.000Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===value?date.valueOf():null;}
function lintContext({text,name='',tokenCount,tokenBudget,lineBudget,today,dateAgeDays}={}){
  validate(text);if(typeof name!=='string'||name.length>4096)throw new Error('Use a bounded file name.');
  for(const [key,value] of Object.entries({tokenCount,tokenBudget,lineBudget,dateAgeDays}))if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw new Error(`${key} must be a nonnegative safe integer.`);
  if(today!==undefined&&isoDay(today)===null)throw new Error('today must be a valid ISO calendar date.');
  if(dateAgeDays!==undefined&&today===undefined)throw new Error('Provide today with the configured date age threshold.');
  const lines=[];let offset=0;
  for(const raw of text.split(/(?<=\n)|(?<=\r)(?!\n)/)){lines.push({text:raw.replace(/\r\n$|[\r\n]$/,''),from:offset});offset+=raw.length;}
  const headings=markdownSections(text).slice(1),findings=[];let truncated=false;
  const add=(code,message,line,from,to,confidence='exact',extra={})=>{
    if(findings.length>=MAX_FINDINGS){truncated=true;return;}
    const id=createHash('sha256').update(JSON.stringify([code,from,to,text.slice(from,to),extra])).digest('hex').slice(0,24);
    findings.push({id,code,severity:'advisory',message,line,from,to,confidence,...extra});
  };
  const lineCount=text.split(/\r\n|\r|\n/).length;
  if(lineBudget!==undefined&&lineCount>lineBudget)add('line-budget',`${lineCount} lines exceeds your configured budget of ${lineBudget}; this is not a file-format requirement.`,1,0,0,'exact',{actual:lineCount,budget:lineBudget});
  if(tokenBudget!==undefined&&tokenCount!==undefined&&tokenCount>tokenBudget)add('token-budget',`The supplied count of ${tokenCount} tokens exceeds your configured budget of ${tokenBudget}.`,1,0,0,'supplied-count',{actual:tokenCount,budget:tokenBudget});
  const blocked=new Set();
  if(/^\uFEFF?---[ \t]*$/.test(lines[0].text)){const end=lines.findIndex((line,index)=>index>0&&/^(?:---|\.\.\.)[ \t]*$/.test(line.text));if(end>0)for(let i=0;i<=end;i++)blocked.add(i);}
  // Mask code at its original UTF-16 offsets so findings still select the source text.
  const mask=text.split('');for(const i of blocked)for(let p=lines[i].from;p<lines[i].from+lines[i].text.length;p++)mask[p]=' ';
  parser.parse(text).iterate({enter(node){if(['InlineCode','CodeBlock','FencedCode'].includes(node.name)){for(let p=node.from;p<node.to;p++)if(mask[p]!=='\n'&&mask[p]!=='\r')mask[p]=' ';return false;}}});
  const visible=mask.join('');
  const headingLines=new Set();
  for(const heading of headings){
    let endLine=heading.line-1;const atx=/^ {0,3}#{1,6}(?:[ \t]|$)/.test(lines[endLine].text.replace(/^\uFEFF/,''));
    if(!atx)while(endLine+1<lines.length){endLine++;if(/^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[endLine].text))break;}
    for(let i=heading.line-1;i<=endLine;i++)headingLines.add(i);
    const bodyFrom=endLine+1<lines.length?lines[endLine+1].from:text.length;
    if(!text.slice(bodyFrom,heading.to).trim())add('empty-section',`Heading “${heading.title}” has no content in its section.`,heading.line,heading.from,lines[endLine].from+lines[endLine].text.length);
  }
  const paragraphs=new Map();let paragraph=[];
  const finish=()=>{
    if(!paragraph.length)return;const first=paragraph[0],last=paragraph.at(-1),from=lines[first].from,to=lines[last].from+lines[last].text.length,content=text.slice(from,to).replace(/\r\n|\r/g,'\n').trim();paragraph=[];
    if(!content||!visible.slice(from,to).trim())return;
    const old=paragraphs.get(content);if(old!==undefined)add('repeated-paragraph',`This prose paragraph exactly repeats the paragraph on line ${old}.`,first+1,from,to,'exact',{firstLine:old});else paragraphs.set(content,first+1);
  };
  for(let i=0;i<lines.length;i++){
    const source=lines[i],shown=visible.slice(source.from,source.from+source.text.length);
    if(blocked.has(i)||headingLines.has(i)||!shown.trim()||/^ {0,3}(?:>|[-+*][ \t]|\d+[.)][ \t]|\||<|(?:[-*_][ \t]*){3,}$)/.test(source.text)){finish();}
    else paragraph.push(i);
    for(const match of shown.matchAll(/\b(?:TODO|FIXME)\b/g))add('placeholder',`${match[0]} may be an unfinished instruction; review its intent.`,i+1,source.from+match.index,source.from+match.index+match[0].length,'heuristic');
    if(dateAgeDays!==undefined)for(const match of shown.matchAll(/\b\d{4}-\d\d-\d\d\b/g)){
      const value=isoDay(match[0]);if(value===null)continue;const ageDays=(isoDay(today)-value)/86400000;
      if(ageDays>dateAgeDays)add('old-date-reference',`Date ${match[0]} is ${ageDays} days before ${today}; review its relevance, not an assertion that this content is stale.`,i+1,source.from+match.index,source.from+match.index+10,'heuristic',{ageDays,thresholdDays:dateAgeDays});
    }
  }
  finish();findings.sort((a,b)=>a.from-b.from||a.code.localeCompare(b.code));
  const basename=name.split(/[\\/]/).at(-1).toLowerCase(),recognized=recognizedNames.has(basename);
  return {recognized,kind:recognized?basename:'generic',findings,lines:lineCount,truncated,note:'Advisory checks only. Budgets and date thresholds are caller-configured. No required sections, instruction precedence, contradiction detection, or writer attribution is inferred.'};
}
module.exports={lintContext,MAX_FINDINGS};
