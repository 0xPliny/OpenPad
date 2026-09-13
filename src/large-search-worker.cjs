const fs=require('node:fs/promises');
const {parentPort,workerData}=require('node:worker_threads');
const {versionOf,sameVersion}=require('./large-file.cjs');
async function findLiteral(file,query,progress=()=>{}){
  if(typeof query!=='string'||!query||query.length>32768||!query.isWellFormed())throw new Error('Enter valid Unicode text up to 32,768 characters.');
  const needle=Buffer.from(query,'utf8'),handle=await fs.open(file,'r');
  try{
    const before=await handle.stat();if(!before.isFile()||!Number.isSafeInteger(before.size))throw new Error('Choose a regular file with a supported byte size.');
    const matches=[];let carry=Buffer.alloc(0),bytesRead=0,nextAllowed=0,lastProgress=0,capped=false;
    const chunkBuffer=Buffer.alloc(Math.min(before.size,64*1024));
    while(bytesRead<before.size){
      const read=await handle.read(chunkBuffer,0,Math.min(chunkBuffer.length,before.size-bytesRead),bytesRead);if(!read.bytesRead)break;const chunk=chunkBuffer.subarray(0,read.bytesRead);
      const base=bytesRead-carry.length,bytes=Buffer.concat([carry,chunk]);let offset=Math.max(0,nextAllowed-base),found;
      bytesRead+=chunk.length;
      while((found=bytes.indexOf(needle,offset))>=0){const from=base+found,to=from+needle.length;matches.push({from,to});nextAllowed=to;offset=found+needle.length;if(matches.length===1000){capped=true;break;}}
      if(capped)break;
      carry=bytes.subarray(Math.max(0,bytes.length-needle.length+1));
      if(bytesRead-lastProgress>=4*1024*1024){lastProgress=bytesRead;progress({bytesRead,size:before.size});}
    }
    const after=await handle.stat(),current=await fs.stat(file);if(!sameVersion(versionOf(before),versionOf(after))||!sameVersion(versionOf(before),versionOf(current))||!capped&&bytesRead!==before.size)throw new Error('File changed during search; search again.');
    return {matches,bytesRead,size:before.size,capped,version:versionOf(before)};
  }finally{await handle.close();}
}
if(parentPort)findLiteral(workerData.file,workerData.query,value=>parentPort.postMessage({type:'progress',...value})).then(result=>parentPort.postMessage({result})).catch(error=>parentPort.postMessage({error:error.message}));
module.exports={findLiteral};
