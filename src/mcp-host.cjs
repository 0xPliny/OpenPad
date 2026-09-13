const http=require('node:http'),{randomBytes,timingSafeEqual}=require('node:crypto');
const {McpServer,createMcpHandler,fromJsonSchema}=require('@modelcontextprotocol/server');
const {toNodeHandler}=require('@modelcontextprotocol/node');
const Ajv=require('ajv');
const {version}=require('../package.json');
const NAMES=new Set(['count_tokens','lint_agent_file','get_context_budget','open_file','reveal_range','set_status','get_session_provenance']);
const LIMITS={body:65536,headers:16384,response:262144,output:98304,active:4,rate:60,uploadMs:5000,toolMs:10000,connections:32};
class McpLoopbackHost{
  constructor({onLog}={}){this.onLog=onLog;this.server=null;this.handler=null;this.secret=null;this.url=null;this.active=0;this.calls=new Set();this.sockets=new Set();this.socketStates=new Map();this.hits=[];this.generation=0;this.sequence=0;this.starting=false;this.logTimes=[];this.logSuppressed=0;this.tasks=new Set();}
  status(){return {running:!!this.server,url:this.url,active:this.active,inFlightTools:this.tasks.size,logSuppressed:this.logSuppressed};}
  log(operation,outcome,started){const now=Date.now();this.logTimes=this.logTimes.filter(time=>now-time<60000);if(this.logTimes.length>=120){this.logSuppressed++;return;}this.logTimes.push(now);try{this.onLog?.({sequence:++this.sequence,operation:NAMES.has(operation)?operation:'http',outcome,durationMs:Date.now()-started});}catch{}}
  async start({tools}={}){
    if(this.server||this.starting)throw new Error('MCP host is already running.');this.starting=true;
    try{
      if(!Array.isArray(tools)||!tools.length||tools.length>7)throw new Error('Provide 1–7 supported tool definitions.');
      const ajv=new Ajv({strict:true,allErrors:false}),names=new Set();
      const definitions=tools.map(tool=>{
        if(!tool||!NAMES.has(tool.name)||names.has(tool.name)||typeof tool.handler!=='function'||typeof tool.description!=='string'||tool.description.length>1000)throw new Error('Invalid MCP tool definition.');names.add(tool.name);
        const inputSchema=structuredClone(tool.inputSchema),outputSchema=structuredClone(tool.outputSchema);
        if(inputSchema?.type!=='object'||outputSchema?.type!=='object'||Buffer.byteLength(JSON.stringify([inputSchema,outputSchema]))>16384)throw new Error('Use bounded object JSON schemas.');
        return {...tool,inputSchema,outputSchema,input:ajv.compile(inputSchema),output:ajv.compile(outputSchema)};
      });
      const generation=++this.generation;this.secret=randomBytes(32);this.hits=[];
      this.handler=createMcpHandler(()=>{
        const server=new McpServer({name:'openpad',version});
        for(const tool of definitions)server.registerTool(tool.name,{description:tool.description,inputSchema:fromJsonSchema(tool.inputSchema),outputSchema:fromJsonSchema(tool.outputSchema)},async(args,ctx)=>{
          const started=Date.now(),abort=new AbortController();this.calls.add(abort);
          const onAbort=()=>abort.abort();ctx.mcpReq.signal.addEventListener('abort',onAbort,{once:true});if(ctx.mcpReq.signal.aborted)abort.abort();
          let timeout;const cancelled=new Promise((_,reject)=>{const fail=()=>reject(new Error('cancelled'));abort.signal.addEventListener('abort',fail,{once:true});if(abort.signal.aborted)fail();timeout=setTimeout(()=>abort.abort(),LIMITS.toolMs);});
          try{
            if(generation!==this.generation||!tool.input(args))throw new Error('invalid');
            if(this.tasks.size>=LIMITS.active)throw new Error('busy');
            const operation=Promise.resolve().then(()=>{if(abort.signal.aborted)throw new Error('cancelled');return tool.handler(args,{signal:abort.signal});});
            this.tasks.add(operation);operation.then(()=>this.tasks.delete(operation),()=>this.tasks.delete(operation));
            const output=await Promise.race([operation,cancelled]);
            if(abort.signal.aborted||generation!==this.generation)throw new Error('cancelled');
            const text=JSON.stringify(output);if(typeof text!=='string'||Buffer.byteLength(text)>LIMITS.output)throw new Error('output');
            const snapshot=JSON.parse(text);if(!tool.output(snapshot))throw new Error('output');this.log(tool.name,'ok',started);
            return {content:[{type:'text',text}],structuredContent:snapshot};
          }catch{this.log(tool.name,abort.signal.aborted?'cancelled':'failed',started);return {isError:true,content:[{type:'text',text:abort.signal.aborted?'Operation cancelled.':'Operation failed or returned an invalid result.'}]};}
          finally{clearTimeout(timeout);ctx.mcpReq.signal.removeEventListener('abort',onAbort);this.calls.delete(abort);}
        });return server;
      },{legacy:'stateless',responseMode:'auto',onerror:()=>this.log('http','protocol-error',Date.now())});
      const node=toNodeHandler(this.handler,{onerror:()=>this.log('http','adapter-error',Date.now())});
      const server=http.createServer({maxHeaderSize:LIMITS.headers,headersTimeout:LIMITS.uploadMs,requestTimeout:LIMITS.uploadMs,keepAliveTimeout:1000},(req,res)=>{this.beginRequest(req,res);void this.request(req,res,node,generation);});
      server.maxConnections=LIMITS.connections;server.on('connection',socket=>this.trackSocket(socket));
      server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
      if(generation!==this.generation){await new Promise(resolve=>server.close(resolve));throw new Error('MCP start was cancelled.');}
      this.server=server;this.url=`http://127.0.0.1:${server.address().port}/mcp`;return {url:this.url,token:this.secret.toString('base64url')};
    }catch(error){this.secret=null;await this.handler?.close();this.handler=null;throw error;}finally{this.starting=false;}
  }
  armHeaderDeadline(socket,state){
    clearTimeout(state.timer);state.timer=setTimeout(()=>{this.log('http','header-timeout',Date.now());socket.destroy();},LIMITS.uploadMs);
  }
  trackSocket(socket){
    const state={active:0,timer:null};this.sockets.add(socket);this.socketStates.set(socket,state);this.armHeaderDeadline(socket,state);
    socket.on('close',()=>{clearTimeout(state.timer);this.sockets.delete(socket);this.socketStates.delete(socket);});
  }
  beginRequest(req,res){
    const socket=req.socket,state=this.socketStates.get(socket);if(!state)return;
    clearTimeout(state.timer);state.active++;let done=false;
    const finish=()=>{if(done)return;done=true;state.active--;if(!socket.destroyed&&state.active===0)this.armHeaderDeadline(socket,state);};
    res.once('finish',finish);res.once('close',finish);
  }
  async request(req,res,node,generation){
    const started=Date.now();const reject=(status,outcome)=>{this.log('http',outcome,started);if(!res.headersSent){res.writeHead(status,{'Content-Type':'application/json','Connection':'close',...(status===401?{'WWW-Authenticate':'Bearer realm="OpenPad local"'}:{})});res.end(JSON.stringify({error:outcome}));}else res.destroy();};
    const headers=new Map();for(let i=0;i<req.rawHeaders.length;i+=2){const name=req.rawHeaders[i].toLowerCase();headers.set(name,(headers.get(name)||0)+1);}
    if(generation!==this.generation||!this.secret)return reject(503,'stopped');
    if(headers.get('host')!==1||req.headers.host!==new URL(this.url).host||headers.has('origin'))return reject(403,'invalid-origin-or-host');
    if(headers.get('authorization')!==1)return reject(401,'unauthorized');
    const supplied=req.headers.authorization;if(typeof supplied!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(supplied))return reject(401,'unauthorized');
    const token=Buffer.from(supplied.slice(7),'base64url');if(token.length!==32||!timingSafeEqual(token,this.secret)||token.toString('base64url')!==supplied.slice(7))return reject(401,'unauthorized');
    if(req.url!=='/mcp')return reject(404,'not-found');if(req.method!=='POST')return reject(405,'method-not-allowed');
    if(headers.has('content-encoding')||headers.get('content-type')!==1||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']))return reject(415,'unsupported-content-type');
    const now=Date.now();this.hits=this.hits.filter(time=>now-time<60000);if(this.hits.length>=LIMITS.rate)return reject(429,'rate-limit');this.hits.push(now);
    if(this.active>=LIMITS.active)return reject(429,'busy');
    if(Number(req.headers['content-length'])>LIMITS.body)return reject(413,'body-too-large');
    this.active++;let settled=false,timer;const finish=()=>{if(!settled){settled=true;clearTimeout(timer);this.active--;}};res.once('close',finish);res.once('finish',finish);
    timer=setTimeout(()=>reject(408,'upload-timeout'),LIMITS.uploadMs);
    try{
      const chunks=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>LIMITS.body){reject(413,'body-too-large');return;}chunks.push(chunk);}
      clearTimeout(timer);if(settled||generation!==this.generation)return;
      let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{return reject(400,'invalid-json');}
      if(!body||typeof body!=='object'||Array.isArray(body))return reject(400,'invalid-request');
      if(!['initialize','notifications/initialized','server/discover','tools/list','tools/call','ping'].includes(body.method))return reject(404,'unsupported-method');
      // The SDK can include user-supplied identifiers in protocol errors. Bound its entire wire response.
      let responseBytes=0;const write=res.write.bind(res),end=res.end.bind(res);
      const count=chunk=>{if(chunk)responseBytes+=Buffer.byteLength(chunk);if(responseBytes>LIMITS.response){res.destroy();return false;}return true;};
      res.write=(chunk,...args)=>count(chunk)?write(chunk,...args):false;res.end=(chunk,...args)=>{if(count(chunk))return end(chunk,...args);return res;};
      req.auth={token:'redacted',clientId:'local-ephemeral',scopes:['openpad:local'],expiresAt:Math.floor(Date.now()/1000)+3600};
      await node(req,res,body);
    }catch{if(!settled)reject(400,'request-failed');}finally{if(!res.writableEnded&&!res.destroyed)res.end();finish();}
  }
  async stop(){
    this.generation++;this.secret=null;const server=this.server,handler=this.handler;this.server=null;this.handler=null;this.url=null;
    for(const call of this.calls)call.abort();for(const socket of this.sockets)socket.destroy();
    await Promise.all([handler?.close(),server?new Promise(resolve=>server.close(resolve)):undefined]);
  }
}
module.exports={McpLoopbackHost,LIMITS};
