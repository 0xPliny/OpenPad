const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ContextWatch}=require('../src/context-watch.cjs'),{readMcpWorkspaceFile}=require('../src/mcp-workspace.cjs');
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-mcp-workspace-')),watch=new ContextWatch();t.after(async()=>{await watch.stop();await fs.rm(root,{recursive:true,force:true});});return {root,watch};}
test('MCP file reads stay inside active watched UTF8 scope and preserve disk/editor text distinction',async t=>{
  const {root,watch}=await setup(t);await fs.writeFile(path.join(root,'AGENTS.md'),'\uFEFFhello\r\n');await fs.writeFile(path.join(root,'.env.md'),'secret');await fs.writeFile(path.join(root,'ignored.txt'),'outside filter');await watch.start(root);
  const result=await readMcpWorkspaceFile(watch,'AGENTS.md');assert.equal(result.text,'hello\r\n');assert.equal(result.document.text,'hello\n');assert.match(result.normalizedTextHash,/^[a-f0-9]{64}$/);
  for(const input of ['../escape.md','folder/../AGENTS.md','C:/AGENTS.md','AGENTS.md:stream','/AGENTS.md','folder\\AGENTS.md','.env.md','ignored.txt'])await assert.rejects(readMcpWorkspaceFile(watch,input));
  await watch.stop();await assert.rejects(readMcpWorkspaceFile(watch,'AGENTS.md'),/WORKSPACE_CHANGED/);
});

test('private-key name patterns remain excluded even with matching Markdown extensions and broad includes',async t=>{
  const {root,watch}=await setup(t);await fs.writeFile(path.join(root,'AGENTS.md'),'allowed');
  for(const name of ['id_rsa.md','backup-ID_RSA-notes.md'])await fs.writeFile(path.join(root,name),'synthetic excluded text');
  await fs.mkdir(path.join(root,'old-id_rsa-backup'));await fs.writeFile(path.join(root,'old-id_rsa-backup','notes.md'),'synthetic excluded text');
  await watch.start(root,{include:['**/*']});
  for(const name of ['id_rsa.md','backup-ID_RSA-notes.md','old-id_rsa-backup/notes.md'])await assert.rejects(readMcpWorkspaceFile(watch,name),/FILE_NOT_IN_WATCH_SCOPE/);
  assert.equal(watch.status().trackedFiles,1);
});
test('MCP file reads reject changed roots, junction escape, oversized replacement and cancellation',async t=>{
  const {root,watch}=await setup(t),file=path.join(root,'AGENTS.md'),outside=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-mcp-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(file,'hello');await watch.start(root);const abort=new AbortController();abort.abort();await assert.rejects(readMcpWorkspaceFile(watch,'AGENTS.md',abort.signal),/CANCELLED/);
  await fs.writeFile(file,Buffer.alloc(1024*1024+1));await assert.rejects(readMcpWorkspaceFile(watch,'AGENTS.md'),/FILE_LIMIT/);
  await fs.writeFile(path.join(outside,'escape.md'),'secret');await fs.symlink(outside,path.join(root,'link'),process.platform==='win32'?'junction':'dir');await assert.rejects(readMcpWorkspaceFile(watch,'link/escape.md'));
  await fs.rename(root,root+'-old');t.after(()=>fs.rm(root+'-old',{recursive:true,force:true}));await fs.mkdir(root);await fs.writeFile(path.join(root,'AGENTS.md'),'replacement root');await assert.rejects(readMcpWorkspaceFile(watch,'AGENTS.md'));
});
