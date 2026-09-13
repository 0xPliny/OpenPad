const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-language-'));let app;const errors=[];
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    const editor=page.locator('#editor .cm-content');await editor.fill('function first() {}\nclass Thing {\n method() {}\n}');await page.locator('#language').selectOption('JavaScript');await command('outline');await page.waitForFunction(()=>document.querySelectorAll('#outline-symbols button').length===3);await page.locator('#outline-symbols button').filter({hasText:'method'}).click();await page.waitForFunction(()=>document.querySelector('#position').textContent.startsWith('Ln 3,'));
    await editor.fill('function renamed() {}');await page.waitForFunction(()=>document.querySelector('#outline-symbols').textContent.includes('renamed'));assert.equal(await page.locator('#outline-symbols button').count(),1);
    await page.locator('#language').selectOption('');await editor.fill('alphaToken\nalp');await command('complete');await page.waitForSelector('.cm-tooltip-autocomplete');await page.locator('.cm-tooltip-autocomplete li').filter({hasText:'alphaToken'}).click();await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='alphaTokenalphaToken');
    await command('apiSettings');await page.waitForSelector('#api-definitions');await page.locator('#api-definitions').fill(JSON.stringify([{label:'greet',detail:'greet(name)',info:'Local test API',apply:'greet()'}]));await page.getByRole('button',{name:'Save completion settings',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    await editor.fill('gre');await command('complete');await page.waitForSelector('.cm-tooltip-autocomplete');await page.locator('.cm-tooltip-autocomplete li').filter({hasText:'greet'}).click();await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='greet()');
    await editor.locator('.cm-line').hover({position:{x:20,y:8}});await page.waitForSelector('.api-tip');assert.match(await page.locator('.api-tip').innerText(),/greet\(name\)/);
    await page.waitForTimeout(900);const state=JSON.parse(JSON.parse(await fs.readFile(path.join(root,'session.json'),'utf8')).payload);assert.equal(state.settings.apiEntries['*'][0].label,'greet');assert.deepEqual(errors,[]);
    console.log('PASS: live parsed outline/navigation, word completion, custom API insertion/hover signature and recovery settings.');
  }catch(error){if(app){const page=await app.firstWindow();console.error({errors,outline:await page.locator('.outline-panel').innerText(),editor:await page.locator('#editor .cm-content').innerText()});}throw error;}
  finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
