const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-groups-'));let app;
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name),editor=page.locator('#editor .cm-content');
    const group=async()=>{await command('group');await page.locator('#group-name').fill('work');await page.locator('#group-color').selectOption('purple');await page.getByRole('button',{name:'Apply',exact:true}).click();};
    await editor.fill('one');await group();await command('new');await editor.fill('two');await group();assert.equal(await page.locator('.tab[data-group="work"][data-group-color="purple"]').count(),2);await command('pinGroup');await page.waitForFunction(()=>document.querySelectorAll('.pinned-tabs .tab').length===2);
    await app.evaluate(({dialog})=>{global.saveCalls=0;dialog.showSaveDialog=async()=>{global.saveCalls++;return {canceled:true};};});await command('saveGroup');for(let i=0;i<100&&!await app.evaluate(()=>global.saveCalls);i++)await page.waitForTimeout(10);assert.equal(await app.evaluate(()=>global.saveCalls),1);assert.equal(await page.locator('.tab[data-group="work"]').count(),2);
    await app.evaluate(({dialog})=>{global.closeChoice=2;dialog.showMessageBox=async()=>({response:global.closeChoice});});await command('closeGroup');await page.waitForTimeout(100);assert.equal(await page.locator('.tab[data-group="work"]').count(),2);
    await app.evaluate(()=>global.closeChoice=1);await command('closeGroup');await page.waitForFunction(()=>!document.querySelector('.tab[data-group="work"]'));assert.equal(await page.locator('.tab').count(),1);
    await command('group');await page.locator('#group-name').fill('stale');await command('close');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('target tab was closed'));assert.equal(await page.locator('.tab[data-group="stale"]').count(),0);
    console.log('PASS: named group colors, group pinning, cancel stops group close, and discard closes all group tabs.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
