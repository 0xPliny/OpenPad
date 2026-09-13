const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-accessibility-'));let app;
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await page.getByRole('textbox',{name:'Editor: Untitled-1',exact:true}).fill('first');await command('new');await page.getByRole('textbox',{name:'Editor: Untitled-2',exact:true}).fill('second');
    const second=page.getByRole('tab',{name:/^Untitled-2/});await second.focus();await second.press('ArrowLeft');const first=page.getByRole('tab',{name:/^Untitled-1/});assert.equal(await first.getAttribute('aria-selected'),'true');assert.equal(await first.evaluate(node=>document.activeElement===node),true);assert.equal(await page.getByRole('textbox',{name:'Editor: Untitled-1',exact:true}).textContent(),'first');
    await command('pin');assert.equal(await first.evaluate(node=>document.activeElement===node),true);
    await first.press('End');assert.equal(await second.getAttribute('aria-selected'),'true');await second.press('Enter');assert.equal(await page.getByRole('textbox',{name:'Editor: Untitled-2',exact:true}).evaluate(node=>document.activeElement===node),true);assert.equal(await page.locator('[role=tab][tabindex="0"]').count(),1);
    await command('readOnly');assert.equal(await page.getByRole('textbox',{name:'Editor: Untitled-2',exact:true}).getAttribute('aria-readonly'),'true');assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'),await second.getAttribute('id'));
    await command('readOnly');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(root,'old.txt'));await command('save');await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('old.txt'));await command('split');await page.waitForSelector('.split-panel [aria-label="Editor: old.txt"]');await command('renameFile');await page.locator('#rename-name').fill('new.txt');await page.getByRole('button',{name:'Rename',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[aria-label="Editor: old.txt"]'));assert.ok(await page.locator('.split-panel [aria-label="Editor: new.txt"]').count());
    console.log('PASS: named editors, tab roles/selection/panel relationship, roving arrows/Home-End entry and readonly semantics.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
