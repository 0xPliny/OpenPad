const {randomUUID}=require('node:crypto');
class McpEditorBridge{
  constructor(send,timeout=8000){this.send=send;this.timeout=timeout;this.pending=new Map();}
  call(operation,data,signal){
    if(signal?.aborted)return Promise.reject(new Error('CANCELLED'));
    if(!['open_file','reveal_range','set_status'].includes(operation))return Promise.reject(new Error('UNSUPPORTED_EDITOR_OPERATION'));
    if(this.pending.size>=4)return Promise.reject(new Error('EDITOR_BUSY'));
    return new Promise((resolve,reject)=>{
      const id=randomUUID();let timer;
      const finish=(error,value)=>{if(!this.pending.has(id))return;this.pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(new Error(error));else resolve(value);};
      const abort=()=>{try{this.send('mcp-cancel',{id});}catch{}finish('CANCELLED');};
      this.pending.set(id,{finish,abort});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,this.timeout);
      try{this.send('mcp-request',{id,operation,data});}catch{finish('EDITOR_UNAVAILABLE');}
    });
  }
  receive(message){
    const request=typeof message?.id==='string'&&this.pending.get(message.id);if(!request)return false;
    if(message.error)request.finish(['EDITOR_BUSY','DOCUMENT_CHANGED','OUT_OF_RANGE','CANCELLED','DOCUMENT_UNAVAILABLE'].includes(message.error)?message.error:'EDITOR_UNAVAILABLE');
    else request.finish(null,message.result);return true;
  }
  cancelAll(){for(const request of [...this.pending.values()])request.abort();}
}
module.exports={McpEditorBridge};
