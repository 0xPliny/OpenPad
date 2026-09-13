const {parentPort,workerData}=require('node:worker_threads');
const {measureContext}=require('./context-meter.cjs');
try{parentPort.postMessage(measureContext(workerData));}catch(error){parentPort.postMessage({error:error.message});}
