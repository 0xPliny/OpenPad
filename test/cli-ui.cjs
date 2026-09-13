const {_electron:electron}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-cli-'));let app;
  try{
    const file=path.join(root,'lines.txt');await fs.writeFile(file,'first\nsecond\nthird');
    const executablePath=process.env.OPENPAD_EXECUTABLE,args=executablePath?[]:[path.resolve('.')],env={...process.env,OPENPAD_USER_DATA:path.join(root,'profile')};
    app=await electron.launch({...(executablePath?{executablePath}:{}),args:[...args,'--line=2','--column=3','--readonly',file],env});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForFunction(()=>document.body.dataset.ready==='true' && document.querySelector('#position').textContent==='Ln 2, Col 3');
    assert.match(await page.locator('#status').innerText(),/Read-only/);const editor=page.locator('#editor .cm-content');await editor.press('X');assert.equal((await editor.locator('.cm-line').allTextContents()).join('\n'),'first\nsecond\nthird');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('command','encoding'));await page.waitForSelector('#file-encoding');await page.getByRole('button',{name:'Reopen with encoding',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);assert.match(await page.locator('#status').innerText(),/Read-only/);await editor.press('X');assert.equal((await editor.locator('.cm-line').allTextContents()).join('\n'),'first\nsecond\nthird');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('command','readOnly'));await page.waitForFunction(()=>!document.querySelector('#status').textContent.includes('Read-only'));await editor.fill('unsaved\nkept');
    const child=spawn(executablePath||require('electron'),[...args,'-n2','-c999','-ro',file],{env,windowsHide:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`exit ${code}`)));});
    await page.waitForFunction(()=>document.querySelector('#position').textContent==='Ln 2, Col 5');assert.equal((await editor.locator('.cm-line').allTextContents()).join('\n'),'unsaved\nkept');assert.match(await page.locator('#status').innerText(),/Read-only/);
    await page.waitForTimeout(900);const snapshot=JSON.parse(JSON.parse(await fs.readFile(path.join(root,'profile','session.json'),'utf8')).payload);assert.ok(snapshot.docs.some(d=>d.text==='unsaved\nkept' && d.locked));
    const legacy=path.join(root,'japanese.txt');await fs.writeFile(legacy,Buffer.from('93fa967b','hex'));const legacyChild=spawn(executablePath||require('electron'),[...args,'--encoding=shiftjis',legacy],{env,windowsHide:true,stdio:'ignore'});await new Promise((resolve,reject)=>{legacyChild.once('error',reject);legacyChild.once('exit',code=>code===0?resolve():reject(new Error(`exit ${code}`)));});await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='日本');assert.match(await page.locator('#encoding').innerText(),/Shift JIS/);
    console.log('PASS: cold launch line/column/read-only, edit prevention/unlock, warm launch clamps column and retains dirty content, read-only recovery metadata.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
