const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-path-conflict-'));let app;
  try{
    const source=path.join(root,'source.txt'),other=path.join(root,'other.txt');await fs.writeFile(source,'original');await fs.writeFile(other,'keep other');
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[source]}:{args:[path.resolve('.'),source]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();await page.waitForFunction(()=>document.body.dataset.ready==='true' && document.querySelector('#filepath').textContent.endsWith('source.txt'));
    await app.evaluate(({dialog})=>{global.testErrors=[];dialog.showMessageBox=async(...args)=>{global.testErrors.push(args.at(-1).message);return {response:0};};});
    await fs.unlink(source);await fs.symlink(other,source,'file');await page.locator('#editor .cm-content').fill('my unsaved edit');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('command','save'));
    for(let i=0;i<100;i++){if((await app.evaluate(()=>global.testErrors)).length || await fs.readFile(other,'utf8')!=='keep other')break;await page.waitForTimeout(20);}
    assert.equal(await fs.readFile(other,'utf8'),'keep other');assert.ok((await app.evaluate(()=>global.testErrors)).some(message=>message.includes('path changed')));assert.equal(await page.locator('#editor .cm-content').innerText(),'my unsaved edit');
    console.log('PASS: replacing an opened pathname with a symlink cannot redirect normal Save into a different file.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
