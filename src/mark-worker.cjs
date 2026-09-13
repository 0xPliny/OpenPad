const {parentPort,workerData}=require('node:worker_threads');
const {scanMatches}=require('./search-model.cjs');
try{
  const ranges=[];const count=scanMatches(workerData.text,workerData.options,10001,({from,to})=>{if(to>from)ranges.push({from,to});});
  if(count>10000)throw new Error('More than 10,000 matches; use a narrower expression.');
  parentPort.postMessage({ranges});
}catch(error){parentPort.postMessage({error:error.message});}
