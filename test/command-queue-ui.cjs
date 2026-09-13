const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-command-queue-'));let app;
  try{
    const file=path.join(root,'trash.txt');await fs.writeFile(file,'retained text');
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[file]}:{args:[path.resolve('.'),file]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(5000);await page.waitForFunction(()=>document.body.dataset.ready==='true'&&document.querySelector('#filepath').textContent.endsWith('trash.txt'));
    await app.evaluate(({ipcMain,dialog,shell})=>{
      let armed=false;dialog.showMessageBox=async()=>({response:0});shell.trashItem=async()=>{armed=true;};
      const original=ipcMain._invokeHandlers.get('snapshot');ipcMain.removeHandler('snapshot');ipcMain.handle('snapshot',async(...args)=>{if(armed){armed=false;await new Promise(resolve=>global.releaseSnapshot=resolve);}return original(...args);});
    });
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await command('trashFile');await page.waitForFunction(()=>document.querySelector('#filepath').textContent==='Unsaved document');
    for(let i=0;i<100&&!await app.evaluate(()=>!!global.releaseSnapshot);i++)await page.waitForTimeout(10);
    assert.equal(await app.evaluate(()=>!!global.releaseSnapshot),true);
    const before=await page.locator('.tab').count();await command('formatJson');await command('new');await command('pin');await command('new');await page.waitForTimeout(100);assert.equal(await page.locator('.tab').count(),before);
    await app.evaluate(()=>global.releaseSnapshot());await page.waitForFunction(count=>document.querySelectorAll('.tab').length===count,before+2);
    assert.equal(await page.locator('.pinned-tabs .tab').count(),1);assert.equal(await page.locator('.pinned-tabs .tab.active').count(),0);assert.equal(await page.locator('#editor .cm-content').textContent(),'');assert.equal(await fs.readFile(file,'utf8'),'retained text');
    console.log('PASS: ordered New/Pin commands survive an in-flight file-operation recovery snapshot and an intervening command error. Native trash effect stubbed.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
