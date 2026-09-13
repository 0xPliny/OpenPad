const {Worker}=require('node:worker_threads');
const path=require('node:path');
const {validate}=require('./context-meter.cjs');
class ContextMeterRunner{
  constructor(timeout=10000){if(!Number.isFinite(timeout)||timeout<=0)throw new Error('Context meter timeout must be positive.');this.timeout=timeout;this.job=null;this.closed=false;}
  cancel(requestId){if(this.job&&(requestId===undefined||requestId===this.job.requestId)){this.job.finish({cancelled:true});return true;}return false;}
  close(){this.closed=true;this.cancel();}
  run(request={}){
    const {requestId,text,tokenizer='o200k_base'}=request||{};
    this.cancel();
    if(this.closed)return Promise.resolve({requestId,error:'Context meter was closed.'});
    try{if(!Number.isSafeInteger(requestId)||requestId<0)throw new Error('Invalid context meter request ID.');validate(text,tokenizer);}catch(error){return Promise.resolve({requestId,error:error.message});}
    return new Promise(resolve=>{
      let worker;
      try{worker=new Worker(path.join(__dirname,'context-meter-worker.cjs'),{workerData:{text,tokenizer},resourceLimits:{maxOldGenerationSizeMb:256}});}catch(error){resolve({requestId,error:error.message});return;}
      let done=false,timer;
      const finish=result=>{if(done)return;done=true;clearTimeout(timer);if(this.job?.worker===worker)this.job=null;worker.terminate().catch(()=>{});resolve({requestId,...result});};
      timer=setTimeout(()=>finish({error:`Context meter exceeded ${this.timeout} ms; use a smaller text snapshot.`}),this.timeout);
      this.job={requestId,worker,finish};worker.once('message',finish);worker.once('error',error=>finish({error:error.message}));worker.once('exit',code=>finish({error:`Context meter worker exited (${code}) without a result.`}));
    });
  }
}
module.exports={ContextMeterRunner};
