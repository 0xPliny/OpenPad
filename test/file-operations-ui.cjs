const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpad-lifecycle-ui-')));let app;const errors=[];
  try{
    const original=path.join(root,'original.txt'),copy=path.join(root,'copy.txt'),renamed=path.join(root,'renamed.txt');await fs.writeFile(original,'saved\r\n');
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[original]}:{args:[path.resolve('.'),original]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.body.dataset.ready==='true' && document.querySelector('#filepath').textContent.endsWith('original.txt'));
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await app.evaluate(({dialog,shell},copy)=>{global.testErrors=[];global.choice=2;global.trash=[];global.revealed=[];dialog.showSaveDialog=async()=>({canceled:false,filePath:copy});dialog.showMessageBox=async(...args)=>{const options=args.at(-1);if(options.type==='error')global.testErrors.push(options.message);return {response:global.choice};};shell.trashItem=async file=>{global.trash.push(file);await process.getBuiltinModule('fs/promises').unlink(file);};shell.showItemInFolder=file=>global.revealed.push(file);},copy);
    const editor=page.locator('#editor .cm-content');await editor.fill('unsaved\n');await command('saveCopy');await page.waitForFunction(()=>document.querySelector('#dialog-title').textContent==='Copy saved');await page.locator('#dialog-close').click();
    assert.equal(await fs.readFile(copy,'utf8'),'unsaved\r\n');assert.equal(await fs.readFile(original,'utf8'),'saved\r\n');assert.equal(await page.locator('#filepath').innerText(),original);
    await command('renameFile');await page.waitForSelector('#rename-name');await page.locator('#rename-name').fill('renamed.txt');await page.getByRole('button',{name:'Rename',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    assert.equal(await page.locator('#filepath').innerText(),renamed);assert.equal((await editor.locator('.cm-line').allTextContents()).join('\n'),'unsaved\n');assert.match(await page.locator('#status').innerText(),/Unsaved/);assert.equal(await fs.readFile(renamed,'utf8'),'saved\r\n');
    await command('revealFile');await page.waitForTimeout(50);assert.deepEqual(await app.evaluate(()=>global.revealed),[renamed]);
    await app.evaluate(()=>global.choice=1);await command('close');await page.waitForFunction(()=>document.querySelector('#filepath').textContent==='Unsaved document');await command('reopenClosed');await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('renamed.txt'));assert.equal((await editor.locator('.cm-line').allTextContents()).join('\n'),'saved\n');
    await command('trashFile');await page.waitForTimeout(50);assert.deepEqual(await app.evaluate(()=>global.trash),[]);assert.equal(await fs.readFile(renamed,'utf8'),'saved\r\n');
    await app.evaluate(()=>global.choice=0);await command('trashFile');await page.waitForFunction(()=>document.querySelector('#filepath').textContent==='Unsaved document');assert.equal((await editor.locator('.cm-line').allTextContents()).join('\n'),'saved\n');assert.match(await page.locator('#status').innerText(),/Unsaved/);await assert.rejects(fs.stat(renamed),{code:'ENOENT'});
    await command('new');await page.waitForFunction(()=>document.querySelectorAll('.tab').length===3);await editor.fill('last');const activeId=await page.locator('.tab.active').getAttribute('data-id');await command('tabLeft');await page.waitForFunction(id=>document.querySelectorAll('.tab')[1].dataset.id===id,activeId);
    await app.evaluate(()=>global.choice=2);await command('closeAll');await page.waitForTimeout(50);assert.ok(await page.locator('.tab').count()>=2,'Cancel stops bulk close');
    await app.evaluate(()=>global.choice=1);await command('closeAll');await page.waitForFunction(()=>document.querySelectorAll('.tab').length===1 && document.querySelector('#editor .cm-content').textContent==='');
    const pdf=path.join(root,'export.pdf');const printed=Array.from({length:400},(_,i)=>`LINE-${i+1} <script>literal & text</script>`).join('\n');await editor.fill(printed);
    await app.evaluate(({dialog},pdf)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:pdf});},pdf);await command('exportPdf');await page.waitForFunction(()=>document.querySelector('#dialog-title').textContent==='PDF exported');
    const pdfBytes=await fs.readFile(pdf);assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');assert.ok((pdfBytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1,'Full buffer spans multiple PDF pages');assert.deepEqual(await fs.readdir(path.join(root,'profile','print-jobs')),[]);
    assert.deepEqual(await app.evaluate(()=>global.testErrors),[]);assert.deepEqual(errors,[]);
    console.log('PASS: Save Copy binding/dirty preservation, rename retains unsaved edits, reopen reads disk, recycle cancel/success retains buffer, reveal path, tab movement, bulk-close cancellation, multi-page PDF and temporary print cleanup. Recycle/reveal native effects stubbed; no physical printer tested.');
  }catch(error){if(app){console.error(await app.evaluate(()=>global.testErrors));console.error(await (await app.firstWindow()).locator('#status').innerText());console.error(await fs.readdir(root));}throw error;}
  finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
