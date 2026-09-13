const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-search-ui-'));let app;
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name),editor=page.locator('#editor .cm-content');
    await editor.fill('zero\nitem 12\nitem 34');await command('folderSearch');await page.locator('#search-scope').selectOption('tabs');await page.locator('#folder-regex').check();await page.locator('#folder-query').fill('item \\d+');
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('cancel-search');let first=true;ipcMain.removeHandler('cancel-search');ipcMain.handle('cancel-search',async(...args)=>{if(first){first=false;await new Promise(resolve=>global.releaseSearchCancel=resolve);}return original(...args);});});
    await page.locator('#folder-start').click();for(let i=0;i<50&&!await app.evaluate(()=>!!global.releaseSearchCancel);i++)await page.waitForTimeout(10);assert.ok(await app.evaluate(()=>!!global.releaseSearchCancel));await page.locator('#folder-cancel').click();await page.waitForFunction(()=>document.querySelector('#folder-progress').textContent.startsWith('Cancelled'));await app.evaluate(()=>global.releaseSearchCancel());await page.waitForTimeout(200);assert.match(await page.locator('#folder-progress').innerText(),/^Cancelled/);assert.equal(await page.locator('#folder-results button').count(),0);
    const search=async()=>{await page.locator('#folder-start').click();await page.waitForFunction(()=>document.querySelector('#folder-progress').textContent.startsWith('Finished'));};await search();assert.equal(await page.locator('#folder-results button').count(),2);await page.locator('#folder-results button').nth(1).click();assert.equal(await page.locator('#position').innerText(),'Ln 3, Col 8');
    await page.locator('#search-scope').selectOption('selection');await page.locator('#folder-query').fill('\\d+');await search();assert.equal(await page.locator('#folder-results button').count(),1);await page.locator('#folder-results button').click();assert.equal(await page.locator('#position').innerText(),'Ln 3, Col 8');
    await editor.fill('changed');await page.locator('#folder-results button').click();assert.match(await page.locator('#status').innerText(),/buffer changed/);
    await editor.fill('a'.repeat(100000)+'!');await page.locator('#search-scope').selectOption('document');await page.locator('#folder-query').fill('(a+)+$');await page.locator('#folder-start').click();await page.waitForTimeout(200);await page.locator('#folder-cancel').click();await page.waitForFunction(()=>document.querySelector('#folder-progress').textContent.startsWith('Cancelled'));
    await editor.fill('cat cats écat caté cat');await page.locator('#folder-regex').uncheck();await page.locator('#folder-word').check();await page.locator('#folder-query').fill('cat');await search();assert.equal(await page.locator('#folder-results button').count(),2);
    await editor.fill('first\nsecond');await page.locator('#folder-word').uncheck();await page.locator('#folder-query').fill('first\nsecond');await search();assert.equal(await page.locator('#folder-results button').count(),1);await page.locator('#folder-results button').click();assert.equal(await page.evaluate(()=>window.getSelection().toString()),'first\nsecond');
    await page.locator('#folder-query').fill('different');await page.locator('#search-history').selectOption('first\nsecond');assert.equal(await page.locator('#folder-query').inputValue(),'first\nsecond');
    assert.ok(await page.locator('#search-history option').count()>=3);await page.locator('#search-clear-history').click();await page.waitForFunction(()=>!document.querySelector('#search-history').children.length);
    const history=async name=>JSON.parse(JSON.parse(await fs.readFile(path.join(root,name),'utf8')).payload).settings.recentSearch;
    for(let i=0;i<100;i++){if((await history('session.json')).length===0&&(await history('session.json.bak')).length===0)break;await page.waitForTimeout(20);}assert.deepEqual(await history('session.json'),[]);assert.deepEqual(await history('session.json.bak'),[]);
    console.log('PASS: regex buffer/selection offsets, stale-result refusal, cancel before launch and during regex, whole words and both rolling history generations cleared.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
