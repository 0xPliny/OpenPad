const {Worker}=require('node:worker_threads');
const path=require('node:path');
class MarkRunner{
  constructor(timeout=10000){this.timeout=timeout;this.job=null;}
  cancel(id){if(this.job&&(id===undefined||this.job.id===id))this.job.finish({cancelled:true});}
  run({id,text,options}){
    if(!Number.isSafeInteger(id)||typeof text!=='string'||text.length>32*1024*1024)return Promise.resolve({error:'Marking requires a text snapshot up to 32 MiB.'});
    this.cancel();
    return new Promise(resolve=>{
      const worker=new Worker(path.join(__dirname,'mark-worker.cjs'),{workerData:{text,options}});
      let done=false;const finish=result=>{if(done)return;done=true;clearTimeout(timer);if(this.job?.worker===worker)this.job=null;worker.terminate();resolve(result);};
      const timer=setTimeout(()=>finish({error:'Marking exceeded 10 seconds; use a narrower expression.'}),this.timeout);
      this.job={id,worker,finish};worker.once('message',finish);worker.once('error',error=>finish({error:error.message}));worker.once('exit',code=>finish({error:`Mark worker exited (${code}).`}));
    });
  }
}
module.exports={MarkRunner};
