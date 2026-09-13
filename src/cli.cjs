const path=require('node:path');
const {encodings}=require('./encodings.cjs');
function parseLaunch(args,cwd) {
  const files=[],options={};let literal=false;
  const positive=(value,flag)=>{if(!/^\d+$/.test(value)||Number(value)<1||!Number.isSafeInteger(Number(value)))throw new Error(`${flag} requires a positive integer.`);return Number(value);};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(!literal && arg==='--'){literal=true;continue;}
    if(!literal && ['--readonly','--read-only','-ro'].includes(arg)){options.readOnly=true;continue;}
    if(!literal&&/^(--encoding)(=|$)/.test(arg)){const equals=arg.indexOf('='),value=(equals<0?args[++i]:arg.slice(equals+1))||'',encoding=value.toLowerCase().replace(/[-_]/g,'');if(!encodings.includes(encoding))throw new Error('Unsupported --encoding value. Use a listed encoding such as utf8, windows1251 or shiftjis.');options.encoding=encoding;continue;}
    if(!literal && /^(--line|--column)(=|$)/.test(arg)){
      const equals=arg.indexOf('='),flag=equals<0?arg:arg.slice(0,equals),inline=equals<0?undefined:arg.slice(equals+1);options[flag==='--line'?'line':'column']=positive(inline??args[++i]??'',flag);continue;
    }
    const short=!literal && /^-([nc])(\d+)$/.exec(arg);
    if(short){options[short[1]==='n'?'line':'column']=positive(short[2],short[1]);continue;}
    if(!literal && arg.startsWith('-'))continue;
    files.push(path.resolve(cwd,arg));
  }
  return files.map(file=>({path:file,...options}));
}
module.exports={parseLaunch};
