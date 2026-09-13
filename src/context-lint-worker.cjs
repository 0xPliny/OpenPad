const {parentPort,workerData}=require('node:worker_threads');
const {lintContext}=require('./context-lint.cjs');
try{
  const tokenizer=workerData.tokenizer||'o200k_base';
  if(!['o200k_base','cl100k_base','chars4'].includes(tokenizer))throw new Error('Choose a supported tokenizer.');
  if(typeof workerData.text!=='string'||Buffer.byteLength(workerData.text,'utf8')>1024*1024||!workerData.text.isWellFormed())throw new Error('Lint requires valid Unicode text up to 1 MiB.');
  const tokenCount=tokenizer==='chars4'?Math.ceil(Array.from(workerData.text).length/4):require('gpt-tokenizer/encoding/'+tokenizer).countTokens(workerData.text,{allowedSpecial:new Set(),disallowedSpecial:new Set()});
  parentPort.postMessage({...lintContext({...workerData,tokenCount}),tokenCount,tokenizer,approximate:tokenizer==='chars4'});
}catch(error){parentPort.postMessage({error:error.message});}
