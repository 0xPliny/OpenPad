const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {SessionStore}=require('../src/session.cjs');
const {hash}=require('../src/files.cjs');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-custom-language-'));let app;const errors=[];
  try{
    const malformed={customLanguages:{Bad:{name:'Bad',extensions:null}},apiEntries:{'*':'broken'}};
    await new SessionStore(path.join(root,'profile')).save({docs:[{id:'recovered',name:'recovered.dsl',text:'recovered buffer',saved:'',language:'Custom: Bad'}],settings:malformed});
    const launch=async()=>{app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});const page=await app.firstWindow();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('body[data-ready="true"]');return page;};
    let page=await launch();const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    assert.equal(await page.locator('#editor .cm-content').innerText(),'recovered buffer');assert.equal(await page.locator('#dialog-title').innerText(),'Language settings recovery');assert.match(await page.locator('#dialog-body').innerText(),/Skipped custom language Bad/);await page.locator('#dialog-close').click();
    const definition={name:'Test DSL',extensions:['dsl'],keywords:['PRINT'],types:['Number'],lineComment:'#',strings:['"'],fold:['BEGIN','END']};
    await command('customLanguages');await page.waitForSelector('#custom-language-json');await page.locator('#custom-language-json').fill(JSON.stringify(definition));await page.getByRole('button',{name:'Save and use language',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);assert.equal(await page.locator('#language').inputValue(),'Custom: Test DSL');
    const editor=page.locator('#editor .cm-content');await editor.fill('BEGIN\nPRINT 1\nEND');await page.waitForTimeout(100);await command('foldAll');await page.waitForSelector('.cm-foldPlaceholder');await command('unfoldAll');await page.waitForFunction(()=>!document.querySelector('.cm-foldPlaceholder'));
    const exportFile=path.join(root,'language.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},exportFile);
    await command('customLanguages');await page.waitForSelector('#custom-language-list');await page.locator('#custom-language-list').selectOption('Test DSL');await page.getByRole('button',{name:'Export JSON',exact:true}).click();for(let i=0;i<50;i++){if(await fs.stat(exportFile).catch(()=>null))break;await page.waitForTimeout(20);}assert.equal(JSON.parse(await fs.readFile(exportFile,'utf8')).name,'Test DSL');
    await page.getByRole('button',{name:'Import JSON',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#custom-language-list').value==='');assert.equal(JSON.parse(await page.locator('#custom-language-json').inputValue()).name,'Test DSL');await page.locator('#dialog-close').click();
    await page.waitForTimeout(900);app.process().kill();await app.close().catch(()=>{});app=null;page=await launch();assert.equal(await page.locator('#language').inputValue(),'Custom: Test DSL');
    const file=path.join(root,'auto.dsl');await fs.writeFile(file,'PRINT Number');await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await command('open');await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('auto.dsl'));assert.equal(await page.locator('#language').inputValue(),'Custom: Test DSL');assert.deepEqual(errors,[]);
    const workspace='Malformed language workspace';await new SessionStore(path.join(root,'profile','workspaces',hash(Buffer.from(workspace)))).save({name:workspace,docs:[{id:'workspace-buffer',name:'workspace.dsl',text:'workspace recovery',saved:'',language:'Custom: Bad'}],settings:malformed});await command('loadWorkspace');await page.waitForSelector('#picker-query');await page.locator('#picker-query').fill(workspace);await page.locator('#picker-query').press('Enter');await page.waitForFunction(()=>document.querySelector('#dialog-title').textContent==='Language settings recovery');assert.equal(await page.locator('#editor .cm-content').innerText(),'workspace recovery');assert.deepEqual(errors,[]);
    console.log('PASS: malformed startup/workspace language settings retain buffers with warnings; custom creation/use, folding, JSON export/import, recovery and filename detection.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
