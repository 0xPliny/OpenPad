const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-visibility-'));let app;
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    const editor=page.locator('#editor .cm-content');await editor.fill(Array.from({length:300},(_,i)=>`    line ${i+1}`).join('\n'));await editor.press('Control+Home');await command('visibility');await page.locator('#show-eol').check();await page.locator('#show-guides').check();await page.locator('#show-map').check();await page.locator('#column-edge').fill('80');await page.getByRole('button',{name:'Apply visibility',exact:true}).click();
    await page.waitForSelector('#editor .openpad-eol');assert.ok(await page.locator('#editor .openpad-indent').count());assert.ok(await page.locator('#editor .openpad-edge').count());const map=page.locator('#document-map');await map.focus();await map.press('End');await page.waitForFunction(()=>document.querySelector('#position').textContent.includes('Ln 300,'));await page.waitForFunction(()=>document.querySelector('#document-map').getAttribute('aria-valuenow')==='300');await map.press('Home');await page.waitForFunction(()=>document.querySelector('#position').textContent.includes('Ln 1,'));
    const bounds=await map.boundingBox();await map.click({position:{x:20,y:bounds.height/2}});await page.waitForFunction(()=>/Ln 15[01],/.test(document.querySelector('#position').textContent));
    await command('split');await page.waitForSelector('.split-panel .openpad-eol');await command('documentMap');await page.waitForFunction(()=>document.querySelector('#document-map').hidden);
    assert.equal((await editor.locator('.cm-line').allTextContents()).some(line=>line.includes('line 151')),true);
    await command('split');await page.waitForFunction(()=>document.querySelector('.split-panel').hidden);await editor.focus();await editor.press('Control+A');await page.keyboard.insertText('a');await page.waitForFunction(()=>document.querySelector('#count').textContent==='1 characters');assert.equal(await editor.textContent(),'a');await page.waitForFunction(()=>!document.querySelector('#editor .openpad-eol'));await editor.press('Control+A');await page.keyboard.insertText('a\n');await page.waitForFunction(()=>document.querySelector('#count').textContent==='2 characters');await page.waitForFunction(()=>document.querySelectorAll('#editor .openpad-eol').length===1);
    console.log('PASS: EOL glyphs, indent guides, column edge, map keyboard/click navigation and split visibility.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
