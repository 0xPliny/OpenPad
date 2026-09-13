const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-corpus-ui-')),folder=path.join(root,'workspace');let app;
  await fs.mkdir(folder);await fs.writeFile(path.join(folder,'one.md'),'antidisestablishmentarianism');await fs.writeFile(path.join(folder,'two.md'),'2 + 2 = 4');await fs.writeFile(path.join(folder,'bad.md'),Buffer.from([255]));
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await app.evaluate(({dialog},folder)=>{global.corpusErrors=[];dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});dialog.showMessageBox=async(...args)=>{global.corpusErrors.push(args.at(-1).message);return {response:2};};},folder);
    await command('contextCorpus');await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForFunction(()=>/watch/i.test(document.querySelector('#corpus-summary').textContent)&&!document.querySelector('#corpus-summary').textContent.includes('Starting'));
    await command('contextWatch');await page.getByRole('button',{name:'Choose watch folder',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#context-watch-summary').textContent.includes('Watching'));
    await command('contextCorpus');await page.locator('#corpus-budget').fill('10');await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForSelector('[data-corpus-path]');
    assert.match(await page.locator('#corpus-summary').textContent(),/13 disk tokens.*2 files.*INCOMPLETE.*over budget/);assert.equal(await page.locator('[data-corpus-path]').first().getAttribute('data-corpus-path'),'two.md');assert.match(await page.locator('#corpus-results').textContent(),/Skipped: bad.md/);
    await fs.writeFile(path.join(folder,'two.md'),'changed after scan');await page.locator('[data-corpus-path="two.md"]').click();assert.ok((await app.evaluate(()=>global.corpusErrors)).some(message=>/changed|match|scan/i.test(message)));
    await page.locator('[data-corpus-path="one.md"]').click();await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('one.md'));await page.locator('#editor .cm-content').fill('Unsaved replacement');
    await command('contextCorpus');await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForSelector('[data-corpus-path="one.md"]');await page.locator('[data-corpus-path="one.md"]').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('open buffer differs'));assert.equal(await page.locator('#editor .cm-content').textContent(),'Unsaved replacement');
    await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.getByRole('button',{name:'Cancel scan',exact:true}).click();assert.match(await page.locator('#corpus-summary').textContent(),/cancelled/);assert.equal(await page.locator('[data-corpus-path]').count(),0);
    await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForSelector('[data-corpus-path]');
    await page.locator('#corpus-tokenizer').selectOption('cl100k_base');assert.equal(await page.locator('[data-corpus-path]').count(),0);assert.match(await page.locator('#corpus-summary').textContent(),/Settings changed/);
    await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForSelector('[data-corpus-path]');assert.match(await page.locator('#corpus-summary').textContent(),/cl100k_base/);
    await page.locator('#corpus-budget').fill('100');assert.equal(await page.locator('[data-corpus-path]').count(),0);assert.match(await page.locator('#corpus-summary').textContent(),/Settings changed/);
    await fs.writeFile(path.join(folder,'cancelled.md'),'Retained complete document');
    await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForSelector('[data-corpus-path="cancelled.md"]');
    await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('context-corpus-open');let armed=true;ipcMain.removeHandler('context-corpus-open');ipcMain.handle('context-corpus-open',async(...args)=>{const value=await original(...args);if(armed){armed=false;await new Promise(resolve=>global.releaseCorpusOpen=resolve);}return value;});});
    await page.locator('[data-corpus-path="cancelled.md"]').click();
    for(let i=0;!await app.evaluate(()=>!!global.releaseCorpusOpen);i++){assert.ok(i<100,'Corpus open reached response gate');await new Promise(resolve=>setTimeout(resolve,20));}
    await page.locator('#dialog-close').click();await app.evaluate(()=>global.releaseCorpusOpen());await command('contextCorpus');await page.waitForSelector('#corpus-summary');
    assert.equal((await page.locator('#filepath').textContent()).endsWith('cancelled.md'),false);
    await page.getByRole('button',{name:'Scan watched folder',exact:true}).click();await page.waitForSelector('[data-corpus-path="cancelled.md"]');await page.locator('[data-corpus-path="cancelled.md"]').click();await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('cancelled.md'));assert.equal(await page.locator('#editor .cm-content').textContent(),'Retained complete document');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: corpus scope, exact disk totals, ranking, budget, skipped UTF8, stale disk and dirty buffer refusal, cancellation and rescan.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
