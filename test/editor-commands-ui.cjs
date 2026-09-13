const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-editor-commands-'));let app;
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name),editor=page.locator('#editor .cm-content'),text=async()=>(await editor.locator('.cm-line').allTextContents()).join('\n');
    await editor.fill('one\ntwo\nthree');await editor.press('Control+Home');await command('moveLineDown');await page.waitForFunction(()=>document.querySelector('#editor .cm-line').textContent==='two');assert.equal(await text(),'two\none\nthree');await command('undo');await page.waitForFunction(()=>document.querySelector('#editor .cm-line').textContent==='one');
    await command('addCursorBelow');await editor.press('X');assert.equal(await text(),'Xone\nXtwo\nthree');await command('undo');await page.waitForFunction(()=>document.querySelector('#editor .cm-line').textContent==='one');await command('simplifySelection');
    await command('shortcuts');await page.getByRole('textbox',{name:'Duplicate lines down',exact:true}).fill('Ctrl+Alt+D');await page.getByRole('button',{name:'Apply shortcuts',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);await editor.press('Control+Home');assert.equal(await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('copyLineDown').accelerator),'Ctrl+Alt+D');await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('copyLineDown').click());await page.waitForFunction(()=>document.querySelectorAll('#editor .cm-line').length===4);assert.equal(await text(),'one\none\ntwo\nthree');
    await editor.fill('const answer = 42;');await page.locator('#language').selectOption('JavaScript');await page.waitForTimeout(100);await command('toggleLineComment');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent.startsWith('//'));await command('toggleLineComment');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='const answer = 42;');
    await command('split');const secondary=page.locator('.split-panel .cm-content').first();await secondary.click();await command('selectLine');assert.equal(await secondary.evaluate(node=>node.contains(document.activeElement)||node===document.activeElement),true);await command('split');
    await command('readOnly');await command('deleteLine');await page.waitForTimeout(50);assert.equal(await text(),'const answer = 42;');
    console.log('PASS: line move/undo, multiple cursor edits, native duplicate-line accelerator registration/menu dispatch, comments and read-only protection.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
