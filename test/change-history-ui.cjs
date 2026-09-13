const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-change-bars-'));let app;
  try{
    const file=path.join(root,'bars.txt');await fs.writeFile(file,'one\ntwo\nthree');app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[file]}:{args:[path.resolve('.'),file]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('bars.txt'));
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name),editor=page.locator('#editor .cm-content');
    await command('visibility');await page.locator('#show-history').check();await page.getByRole('button',{name:'Apply visibility',exact:true}).click();await editor.press('Control+Home');await editor.press('X');await page.waitForSelector('#editor .change-unsaved');await command('save');await page.waitForFunction(()=>document.querySelector('#editor .change-saved')&&!document.querySelector('#editor .change-unsaved'));
    await editor.press('Control+End');await editor.press('Y');await page.waitForSelector('#editor .change-unsaved');await command('undo');await page.waitForFunction(()=>!document.querySelector('#editor .change-unsaved'));assert.ok(await page.locator('#editor .change-saved').count());assert.equal(await fs.readFile(file,'utf8'),'Xone\ntwo\nthree');
    await command('split');await page.waitForSelector('.split-panel .change-saved');await command('reload');await page.waitForFunction(()=>!document.querySelector('#editor .change-saved')&&!document.querySelector('#editor .change-unsaved'));
    console.log('PASS: optional unsaved/saved change bars, save baseline, undo, shared panes and reload reset.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
