const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'openpad-replacement-ui-')));
  let app;const errors=[];
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('body[data-ready="true"]');
    await app.evaluate(({dialog})=>{global.testErrors=[];dialog.showMessageBox=async(...args)=>{const o=args.at(-1);if(o.type==='error')global.testErrors.push(o.message);return {response:2};};});
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    const editor=page.locator('#editor .cm-content');
    await editor.fill('item 12\nitem 34');await command('new');await page.waitForFunction(()=>document.querySelectorAll('.tab').length===2);await editor.fill('item 56');
    await command('replaceAcross');await page.waitForSelector('#batch-find');await page.locator('#replace-scope').selectOption('buffers');await page.locator('#batch-find').fill('item (\\d+)');await page.locator('#batch-replace').fill('value $1');await page.locator('#batch-regex').check();
    const preview=()=>page.getByRole('button',{name:'Preview changes',exact:true}).click();
    await preview();await page.waitForFunction(()=>document.querySelector('#batch-status').textContent.startsWith('3 matches'));
    assert.equal(await editor.innerText(),'item 56');
    await page.getByRole('button',{name:'Apply selected changes',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);assert.equal(await editor.innerText(),'value 56');
    await command('undo');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='item 56');
    await command('previousTab');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent.includes('value 12'));await command('undo');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent.includes('item 12'));
    const folder=path.join(root,'files');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'a.txt'),'old\r\n');await fs.writeFile(path.join(folder,'b.txt'),'old\n');
    await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await command('folder');await page.waitForSelector('#picker-query');await page.locator('#dialog-close').click();
    await command('replaceAcross');await page.waitForSelector('#batch-find');await page.locator('#replace-scope').selectOption('folder');await page.locator('#batch-find').fill('old');await page.locator('#batch-replace').fill('new');await preview();await page.waitForFunction(()=>document.querySelector('#batch-status').textContent.startsWith('2 matches'));
    await fs.writeFile(path.join(folder,'b.txt'),'external');await page.getByRole('button',{name:'Apply selected changes',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#batch-status').textContent.startsWith('Replacement failed'));
    assert.equal(await fs.readFile(path.join(folder,'a.txt'),'utf8'),'old\r\n');
    await fs.writeFile(path.join(folder,'b.txt'),'old\n');await preview();await page.waitForFunction(()=>document.querySelector('#batch-files').querySelectorAll('input').length===2);
    await page.getByRole('checkbox',{name:'Apply b.txt',exact:true}).uncheck();await page.getByRole('button',{name:'Apply selected changes',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#batch-status').textContent.startsWith('Updated 1 files'));
    assert.equal(await fs.readFile(path.join(folder,'a.txt'),'utf8'),'new\r\n');assert.equal(await fs.readFile(path.join(folder,'b.txt'),'utf8'),'old\n');
    const recovery=path.join(root,'profile','replacement-recovery'),batches=await fs.readdir(recovery);assert.equal(batches.length,1);assert.equal(await fs.readFile(path.join(recovery,batches[0],'0.original'),'utf8'),'old\r\n');
    await fs.writeFile(path.join(folder,'slow.txt'),'a'.repeat(100000)+'!');await page.locator('#batch-find').fill('(a+)+$');await page.locator('#batch-regex').check();await preview();await page.waitForTimeout(250);await page.getByRole('button',{name:'Cancel preview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#batch-status').textContent.startsWith('Preview cancelled'));
    await page.locator('#batch-find').fill('new');await page.locator('#batch-replace').fill('next');await page.locator('#batch-regex').uncheck();await preview();await page.waitForFunction(()=>document.querySelector('#batch-status').textContent.startsWith('1 matches'));
    assert.deepEqual(await app.evaluate(()=>global.testErrors),[]);assert.deepEqual(errors,[]);
    console.log('PASS: regex multi-buffer preview/apply/undo, disk conflict preflight, selected-file encoding-preserving write, recovery bytes, pathological-regex cancellation and restart.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
