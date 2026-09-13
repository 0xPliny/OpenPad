const {Worker}=require('node:worker_threads');
const path=require('node:path');
class ContextCorpusRunner{
  constructor(timeout=30000){if(!Number.isFinite(timeout)||timeout<=0||timeout>30000)throw new Error('Corpus timeout must be between 1 and 30000 ms.');this.timeout=timeout;this.job=null;this.closed=false;}
  cancel(id){if(this.job&&(id===undefined||id===this.job.requestId)){this.job.finish({cancelled:true,incomplete:true});return true;}return false;}
  close(){this.closed=true;this.cancel();}
  run(request={},onProgress){
    this.cancel();const {requestId,root,include,exclude,tokenizer='o200k_base'}=request||{};
    if(this.closed)return Promise.resolve({requestId,error:'Corpus runner was closed.',incomplete:true});
    if(!Number.isSafeInteger(requestId)||requestId<0||typeof root!=='string'||!path.isAbsolute(root)||!['o200k_base','cl100k_base','chars4'].includes(tokenizer))return Promise.resolve({requestId,error:'Use a valid request ID, absolute root and supported tokenizer.',incomplete:true});
    return new Promise(resolve=>{
      let worker,done=false,timer;
      const finish=result=>{if(done)return;done=true;clearTimeout(timer);if(this.job?.worker===worker)this.job=null;worker?.terminate().catch(()=>{});resolve({requestId,...result});};
      try{worker=new Worker(path.join(__dirname,'context-corpus-worker.cjs'),{workerData:{root,include,exclude,tokenizer},resourceLimits:{maxOldGenerationSizeMb:256}});}catch(error){finish({error:error.message,incomplete:true});return;}
      this.job={requestId,worker,finish};timer=setTimeout(()=>finish({error:'Corpus scan exceeded its time limit.',incomplete:true}),this.timeout);
      worker.on('message',message=>{if(done)return;if(message.progress){try{onProgress?.({requestId,...message.progress});}catch{} }else finish(message);});
      worker.once('error',error=>finish({error:error.message,incomplete:true}));worker.once('exit',code=>finish({error:`Corpus worker exited (${code}) without a result.`,incomplete:true}));
    });
  }
}
module.exports={ContextCorpusRunner};
