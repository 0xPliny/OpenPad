import {StreamLanguage,StringStream,foldService} from '@codemirror/language';
export function validateLanguage(value){
  if(!value || typeof value.name!=='string' || !/^[\p{L}\p{N}_ -]{1,60}$/u.test(value.name) || value.name!==value.name.trim())throw new Error('Custom language needs a name of 1–60 letters, numbers, spaces, hyphens or underscores.');
  const list=(key,limit,pattern)=>{const entries=value[key]===undefined?[]:value[key];if(!Array.isArray(entries)||entries.length>limit||entries.some(x=>typeof x!=='string'||!pattern.test(x)))throw new Error(`Invalid ${key}.`);return [...new Set(entries)];};
  const pair=key=>{const v=value[key];if(v===undefined)return undefined;if(!Array.isArray(v)||v.length!==2||v.some(x=>typeof x!=='string'||!x||x.length>40||/[\r\n]/.test(x)))throw new Error(`Invalid ${key} delimiter pair.`);const [a,b]=v.map(x=>value.caseSensitive===false?x.toLowerCase():x);if(a.startsWith(b)||b.startsWith(a))throw new Error(`${key} delimiters must not be prefixes of each other.`);return v;};
  if(value.lineComment!==undefined && (typeof value.lineComment!=='string'||value.lineComment.length>40||/[\r\n]/.test(value.lineComment)))throw new Error('Invalid lineComment.');
  if(value.caseSensitive!==undefined && typeof value.caseSensitive!=='boolean')throw new Error('caseSensitive must be true or false.');
  return {name:value.name,extensions:list('extensions',30,/^[\p{L}\p{N}_-]{1,30}$/u),keywords:list('keywords',2000,/^[\p{L}_$][\p{L}\p{N}_$]{0,127}$/u),types:list('types',2000,/^[\p{L}_$][\p{L}\p{N}_$]{0,127}$/u),caseSensitive:value.caseSensitive!==false,lineComment:value.lineComment||'',blockComment:pair('blockComment'),fold:pair('fold'),strings:list('strings',3,/^["'`]$/)};
}
export function customParser(definition){
  const config=validateLanguage(definition),key=text=>config.caseSensitive?text:text.toLowerCase(),keywords=new Set(config.keywords.map(key)),types=new Set(config.types.map(key));
  function literal(stream,text){if(!text)return false;const next=stream.string.slice(stream.pos+text.length).match(/^[\p{L}\p{N}_$]/u);if(/[\p{L}\p{N}_$]$/u.test(text)&&next)return false;return stream.match(text,true,!config.caseSensitive);}
  function block(stream,state){const end=(config.caseSensitive?stream.string:stream.string.toLowerCase()).indexOf(key(config.blockComment[1]),stream.pos);if(end<0)stream.skipToEnd();else{stream.pos=end+config.blockComment[1].length;state.block=false;}return 'comment';}
  return {name:config.name,startState:()=>({block:false,delimiter:null}),token(stream,state){
    state.delimiter=null;
    if(state.block)return block(stream,state);
    if(stream.eatSpace())return null;
    if(literal(stream,config.lineComment)){stream.skipToEnd();return 'comment';}
    if(config.blockComment && literal(stream,config.blockComment[0])){state.block=true;return block(stream,state);}
    if(config.strings.includes(stream.peek())){const quote=stream.next();let escaped=false,char;while((char=stream.next())!==undefined){if(char===quote&&!escaped)break;if(char==='\\'&&!escaped)escaped=true;else escaped=false;}return 'string';}
    if(config.fold){for(let i=0;i<2;i++)if(literal(stream,config.fold[i])){state.delimiter=i===0?'open':'close';return 'bracket';}}
    if(stream.match(/^(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)/))return 'number';
    const word=stream.match(/^[\p{L}_$][\p{L}\p{N}_$]*/u);if(word){if(keywords.has(key(word[0])))return 'keyword';if(types.has(key(word[0])))return 'typeName';return 'variableName';}
    stream.next();return 'operator';
  }};
}
export function customFolds(text,definition){
  if(text.length>1024*1024 || !definition.fold)return [];
  const parser=customParser(definition),state=parser.startState(),stack=[],ranges=[];let offset=0;
  for(const line of text.split('\n')){
    const stream=new StringStream(line,4,2);
    while(!stream.eol()){stream.start=stream.pos;parser.token(stream,state);if(state.delimiter==='open')stack.push({from:offset+stream.pos,line:offset});else if(state.delimiter==='close'&&stack.length){const open=stack.pop();if(open.line<offset)ranges.push({...open,to:offset+stream.start});}}
    offset+=line.length+1;
  }
  return ranges;
}
export function customLanguage(definition){
  const config=validateLanguage(definition),cache=new WeakMap();
  return [StreamLanguage.define(customParser(config)),foldService.of((state,lineStart)=>{
    let ranges=cache.get(state.doc);if(!ranges){ranges=new Map();for(const range of customFolds(state.doc.toString(),config)){const old=ranges.get(range.line);if(!old || range.to>old.to || range.to===old.to&&range.from<old.from)ranges.set(range.line,range);}cache.set(state.doc,ranges);}
    return ranges.get(lineStart) || null;
  })];
}
