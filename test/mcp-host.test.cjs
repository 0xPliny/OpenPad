const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');
const {McpLoopbackHost,LIMITS}=require('../src/mcp-host.cjs');
const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');
const empty={type:'object',properties:{},additionalProperties:false},output={type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false};
const tool=handler=>({name:'count_tokens',description:'Count test input',inputSchema:empty,outputSchema:output,handler:handler||(()=>({count:3}))});
async function fixture(t,tools=[tool()],logs=[]){const host=new McpLoopbackHost({onLog:event=>logs.push(event)}),connection=await host.start({tools});t.after(()=>host.stop());return {host,...connection,logs};}
async function client(t,url,token){const client=new Client({name:'test',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});t.after(()=>client.close());await client.connect(transport);return client;}
function request(url,token,{method='POST',headers={},body='{"jsonrpc":"2.0","id":1,"method":"ping"}'}={}){return new Promise((resolve,reject)=>{const req=http.request(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:data}));});req.on('error',reject);req.end(body);});}
function raw(url,headers){const target=new URL(url);return new Promise((resolve,reject)=>{const socket=net.connect(Number(target.port),'127.0.0.1');let data='';socket.on('connect',()=>socket.write(`POST /mcp HTTP/1.1\r\n${headers}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`));socket.on('data',chunk=>data+=chunk);socket.on('end',()=>resolve(data));socket.on('error',reject);});}
test('real SDK v2 discovery/call and v1 stateless compatibility',async t=>{
  const {url,token,host}=await fixture(t);assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(Buffer.from(token,'base64url').length,32);assert.equal(host.status().token,undefined);
  const current=await client(t,url,token);assert.equal((await current.listTools()).tools[0].name,'count_tokens');assert.deepEqual((await current.callTool({name:'count_tokens',arguments:{}})).structuredContent,{count:3});
  const {Client:Legacy}=require('@modelcontextprotocol/sdk/client/index.js'),{StreamableHTTPClientTransport:LegacyTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const legacy=new Legacy({name:'legacy',version:'1'});t.after(()=>legacy.close());await legacy.connect(new LegacyTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));assert.deepEqual((await legacy.callTool({name:'count_tokens',arguments:{}})).structuredContent,{count:3});
});
test('authentication, Host/Origin, methods and encodings reject before tools',async t=>{
  let called=0;const {url,token}=await fixture(t,[tool(()=>{called++;return {count:1};})]);
  assert.equal((await request(url,'bad')).status,401);assert.equal((await request(url,token,{headers:{Host:'evil.example'}})).status,403);
  for(const Origin of ['null','http://127.0.0.1','https://evil.example'])assert.equal((await request(url,token,{headers:{Origin}})).status,403);
  assert.equal((await request(url,token,{method:'GET',body:''})).status,405);assert.equal((await request(url,token,{headers:{'Content-Encoding':'identity'}})).status,415);
  const host=new URL(url).host;assert.match(await raw(url,`Host: ${host}\r\nHost: ${host}\r\nAuthorization: Bearer ${token}`),/^HTTP\/1.1 (400|403)/);
  assert.match(await raw(url,`Host: ${host}\r\nAuthorization: Bearer ${token}\r\nAuthorization: Bearer ${token}`),/^HTTP\/1.1 401/);assert.equal(called,0);
});
test('actual body bytes, malformed JSON and rate are bounded',async t=>{
  const {url,token}=await fixture(t);assert.equal((await request(url,token,{body:'x'.repeat(LIMITS.body+1)})).status,413);assert.equal((await request(url,token,{body:'no JSON'})).status,400);
  for(let i=0;i<60;i++)await request(url,token,{body:'{}'});assert.equal((await request(url,token)).status,429);
});
test('injected failures/output violations are sanitized and logs contain no tokens/content',async t=>{
  const canary='DO-NOT-LOG-CONTENT-123',logs=[];let mode=0;const {url,token}=await fixture(t,[tool(()=>{if(mode===0)throw new Error(canary);if(mode===1)return {count:canary};return {count:1,extra:'x'.repeat(LIMITS.output+1)};})],logs),c=await client(t,url,token);
  for(mode=0;mode<3;mode++){const result=await c.callTool({name:'count_tokens',arguments:{}});assert.equal(result.isError,true);assert.equal(JSON.stringify(result).includes(canary),false);}
  assert.equal(JSON.stringify(logs).includes(token),false);assert.equal(JSON.stringify(logs).includes(canary),false);assert.ok(logs.length);
});
test('stop aborts handlers and restarting revokes old bearer',async t=>{
  let started,aborted=false;const began=new Promise(resolve=>started=resolve);const {host,url,token}=await fixture(t,[tool((_args,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve({count:1});});started();}))]);
  const c=await client(t,url,token),pending=c.callTool({name:'count_tokens',arguments:{}}).catch(()=>null);await began;await host.stop();await pending;assert.equal(aborted,true);
  const next=await host.start({tools:[tool()]});assert.notEqual(next.token,token);assert.equal((await request(next.url,token)).status,401);assert.equal(host.status().running,true);
});
test('client disconnect cancels a running handler and releases the active slot',async t=>{
  let started,finish;const began=new Promise(resolve=>started=resolve),aborted=new Promise(resolve=>finish=resolve);
  const {host,url,token}=await fixture(t,[tool((_args,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>{finish();resolve({count:1});});started();}))]);
  const c=await client(t,url,token),pending=c.callTool({name:'count_tokens',arguments:{}}).catch(()=>null);await began;
  const notification=await request(url,token,{body:JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:123}})});assert.equal(notification.status,404);
  await c.close();
  await Promise.race([aborted,new Promise((_,reject)=>setTimeout(()=>reject(new Error('disconnect not cancelled')),1000))]);await pending;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(host.status().active,0);
});
test('four active calls cap admission and unsupported subscription streams are not exposed',async t=>{
  let count=0,ready;const started=new Promise(resolve=>ready=resolve);
  const {url,token,host}=await fixture(t,[tool((_args,{signal})=>new Promise(resolve=>{signal.addEventListener('abort',()=>resolve({count:1}));if(++count===4)ready();}))]);
  assert.equal((await request(url,token,{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'subscriptions/listen'})})).status,404);
  const c=await client(t,url,token),calls=Array.from({length:4},()=>c.callTool({name:'count_tokens',arguments:{}}).catch(()=>null));await started;
  assert.equal(host.status().active,4);assert.equal((await request(url,token)).status,429);await c.close();await Promise.all(calls);
});
test('ten-second tool deadline aborts cooperative operations with a sanitized outcome',async t=>{
  let aborted=false;const {url,token}=await fixture(t,[tool((_args,{signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({count:1});})))]),c=await client(t,url,token);
  const started=Date.now(),result=await c.callTool({name:'count_tokens',arguments:{}});assert.equal(aborted,true);assert.equal(result.isError,true);assert.ok(Date.now()-started>=LIMITS.toolMs);assert.match(result.content[0].text,/cancelled/);
});
test('unfinished uploads time out and oversized raw headers are rejected',async t=>{
  const {url,token}=await fixture(t),target=new URL(url);
  const response=await new Promise((resolve,reject)=>{const socket=net.connect(Number(target.port),'127.0.0.1');let data='';socket.on('connect',()=>socket.write(`POST /mcp HTTP/1.1\r\nHost: ${target.host}\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`));socket.on('data',chunk=>data+=chunk);socket.on('end',()=>resolve(data));socket.on('error',reject);});
  assert.match(response,/^HTTP\/1.1 408/);
  assert.match(await raw(url,`Host: ${target.host}\r\nAuthorization: Bearer ${token}\r\nX-Large: ${'x'.repeat(LIMITS.headers)}`),/^HTTP\/1.1 400/);
});
test('partial request headers have an absolute socket deadline before HTTP dispatch',async t=>{
  const {url}=await fixture(t),target=new URL(url),started=Date.now();
  await new Promise((resolve,reject)=>{const socket=net.connect(Number(target.port),'127.0.0.1');socket.on('connect',()=>socket.write('POST /mcp HTTP/1.1\r\n'));socket.on('data',()=>{});socket.on('close',resolve);socket.on('error',reject);});
  assert.ok(Date.now()-started>=4500);assert.ok(Date.now()-started<7000);
});
