const {Worker}=require('node:worker_threads');
const path=require('node:path');
class LargeSearchRunner{
  constructor(timeout=30000){this.timeout=timeout;this.job=null;}
  cancel(id){if(this.job&&(id===undefined||id===this.job.id))this.job.finish({cancelled:true});}
  run({id,previewId,file,query},progress=()=>{}){
    if(!Number.isSafeInteger(id))return Promise.resolve({error:'Invalid search request.'});this.cancel();
    return new Promise(resolve=>{
      const worker=new Worker(path.join(__dirname,'large-search-worker.cjs'),{workerData:{file,query}});let done=false;
      const finish=result=>{if(done)return;done=true;clearTimeout(timer);if(this.job?.worker===worker)this.job=null;worker.terminate();resolve(result);};
      const timer=setTimeout(()=>finish({error:'Search exceeded 30 seconds; no results applied.'}),this.timeout);this.job={id,previewId,worker,finish};
      worker.on('message',message=>{if(done)return;if(message.type==='progress')progress(message);else finish(message);});worker.once('error',error=>finish({error:error.message}));worker.once('exit',code=>finish({error:`Search worker exited (${code}).`}));
    });
  }
}
module.exports={LargeSearchRunner};
