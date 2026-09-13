const {spawn,execFile}=require('node:child_process');
const {randomUUID}=require('node:crypto');
function validateCommand(value){
  if(!value || typeof value.name!=='string'||!value.name.trim()||value.name.length>80||typeof value.executable!=='string'||!value.executable||value.executable.length>4096)throw new Error('Commands need a name and executable.');
  if(!Array.isArray(value.args)||value.args.length>100||value.args.some(arg=>typeof arg!=='string'||arg.length>32768))throw new Error('Arguments must be a JSON array of up to 100 strings.');
  if(!['file','workspace','inherit'].includes(value.cwd||'inherit'))throw new Error('Working directory must be file, workspace or inherit.');
  const timeout=value.timeout??60;if(!Number.isInteger(timeout)||timeout<1||timeout>3600)throw new Error('Timeout must be 1–3,600 seconds.');
  return {name:value.name.trim(),executable:value.executable,args:value.args,cwd:value.cwd||'inherit',timeout,saveBefore:!!value.saveBefore};
}
function expandCommand(value,context){
  const config=validateCommand(value);
  const args=config.args.map(arg=>arg.replace(/\$\{(file|dir|name|selection)\}/g,(_match,key)=>{if(context[key]===undefined)throw new Error(`No ${key} is available for this command.`);return context[key];}));
  if(args.reduce((n,arg)=>n+arg.length,0)>128*1024)throw new Error('Expanded command arguments exceed 128 KiB.');
  const cwd=config.cwd==='file'?context.dir:config.cwd==='workspace'?context.workspace:context.inherit;
  if(!cwd)throw new Error(`No ${config.cwd} working directory is available.`);
  return {...config,args,cwd};
}
class CommandRunner{
  constructor(send){this.send=send;this.job=null;}
  start(config,context){
    if(this.job)throw new Error('Stop the running command before starting another.');
    const expanded=expandCommand(config,context),id=randomUUID();
    const child=spawn(expanded.executable,expanded.args,{cwd:expanded.cwd,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const job={id,child,bytes:0,reason:null,ended:false};this.job=job;
    const finish=(code,error)=>{if(job.ended)return;job.ended=true;clearTimeout(job.timer);if(this.job===job)this.job=null;this.send({type:'exit',id,code,error,reason:job.reason});};
    child.on('error',error=>finish(null,error.message));child.on('close',code=>finish(code));
    const output=(stream,text)=>{if(job.ended||job.outputClosed)return;const bytes=Buffer.from(text),remaining=1024*1024-job.bytes;let end=Math.min(bytes.length,remaining);if(end<bytes.length)while(end>0&&(bytes[end]&0xc0)===0x80)end--;if(end>0){const shown=bytes.subarray(0,end);job.bytes+=shown.length;this.send({type:'output',id,stream,text:shown.toString('utf8')});}if(bytes.length>remaining){job.outputClosed=true;this.stop(id,'Output exceeded 1 MiB; command stopped.');}};
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',text=>output('stdout',text));child.stderr.on('data',text=>output('stderr',text));
    job.timer=setTimeout(()=>this.stop(id,`Timeout after ${expanded.timeout} seconds.`),expanded.timeout*1000);
    return {id,name:expanded.name,executable:expanded.executable,cwd:expanded.cwd};
  }
  stop(id,reason='Stopped by user.'){
    const job=this.job;if(!job||job.id!==id||job.ended||job.reason)return false;job.reason=reason;
    if(process.platform==='win32'&&job.child.pid){
      // Stop descendants as well as the configured launcher, whose child may own the actual long-running task.
      execFile('taskkill.exe',['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true},error=>{if(error&&!job.ended)job.child.kill();});
    }else job.child.kill('SIGTERM');
    return true;
  }
}
module.exports={CommandRunner,validateCommand,expandCommand};
