const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {SessionStore}=require('../src/session.cjs'),{hash}=require('../src/files.cjs');
(async()=>{
  for(const defect of ['saved','path','name','collapsedGroups','duplicateIds']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-recovery-shape-'));let app;
    try{
      const store=new SessionStore(root),good={id:'retained',name:'Recovered.txt',text:'usable backup',saved:'',group:'Work'};
      await store.save({docs:[good],settings:{collapsedGroups:[]}});await store.save({docs:[{...good,text:'latest'}],settings:{collapsedGroups:[]}});
      const bad={version:1,docs:defect==='duplicateIds'?[good,{...good,text:'aliased buffer'}]:[{...good,text:'unusable primary',...(defect==='collapsedGroups'?{}:{[defect]:42})}],settings:{collapsedGroups:defect==='collapsedGroups'?null:[]}},payload=JSON.stringify(bad);await fs.writeFile(store.file,JSON.stringify({payload,hash:hash(Buffer.from(payload))}));
      app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
      const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');assert.equal(await page.locator('#editor .cm-content').textContent(),'usable backup');assert.deepEqual(errors,[]);
    }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
  }
  console.log('PASS: real startup falls back from checksum-valid invalid saved/path/name/group settings and duplicate IDs to usable buffers.');
})().catch(error=>{console.error(error);process.exitCode=1;});
