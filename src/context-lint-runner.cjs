const {Worker}=require('node:worker_threads'),path=require('node:path');
class ContextLintRunner{
  constructor(timeout=10000){if(!Number.isSafeInteger(timeout)||timeout<1||timeout>10000)throw new Error('Lint timeout must be 1–10000 ms.');this.timeout=timeout;this.job=null;this.closed=false;}
  cancel(id){if(this.job&&(id===undefined||id===this.job.id)){this.job.finish({cancelled:true});return true;}return false;}
  close(){this.closed=true;this.cancel();}
  run(request={}){
    this.cancel();const id=request?.requestId;
    if(this.closed||!Number.isSafeInteger(id)||id<0||typeof request.text!=='string'||Buffer.byteLength(request.text,'utf8')>1024*1024)return Promise.resolve({requestId:id,error:'Use an open lint runner, valid request ID and text up to 1 MiB.'});
    return new Promise(resolve=>{
      let worker,done=false,timer;
      const finish=result=>{if(done)return;done=true;clearTimeout(timer);if(this.job?.worker===worker)this.job=null;worker?.terminate().catch(()=>{});resolve({requestId:id,...result});};
      try{worker=new Worker(path.join(__dirname,'context-lint-worker.cjs'),{workerData:request,resourceLimits:{maxOldGenerationSizeMb:256}});}catch(error){finish({error:error.message});return;}
      this.job={id,worker,finish};timer=setTimeout(()=>finish({error:'Lint exceeded its 10-second maximum; use a smaller snapshot.'}),this.timeout);
      worker.once('message',finish);worker.once('error',error=>finish({error:error.message}));worker.once('exit',code=>finish({error:'Lint worker exited without a result ('+code+').'}));
    });
  }
}
module.exports={ContextLintRunner};
