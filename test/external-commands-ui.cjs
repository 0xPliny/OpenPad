const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-command-ui-'));let app;
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:root}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name),editor=page.locator('#editor .cm-content');await editor.fill('literal & ; input');await editor.press('Control+A');
    await command('commandSettings');await page.waitForSelector('#external-command-json');await page.locator('#external-command-json').fill(JSON.stringify([{name:'Echo selection',executable:process.execPath,args:['-e','console.log(process.argv[1])','${selection}'],cwd:'inherit',timeout:5},{name:'Wait',executable:process.execPath,args:['-e','console.log("ready");setInterval(()=>{},1000)'],cwd:'inherit',timeout:30}]));await page.getByRole('button',{name:'Save commands',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    const launch=async name=>{await command('runCommand');await page.waitForSelector('#picker-query');await page.locator('#picker-query').fill(name);await page.locator('#picker-query').press('Enter');};
    await launch('Echo selection');await page.waitForFunction(()=>document.querySelector('#command-status').textContent==='Exited with code 0.');assert.equal((await page.locator('#command-output-text').innerText()).trim(),'literal & ; input');
    await launch('Wait');await page.waitForFunction(()=>document.querySelector('#command-output-text').textContent.includes('ready'));await page.getByRole('button',{name:'Stop command',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#command-status').textContent==='Stopped by user.');assert.equal(await editor.innerText(),'literal & ; input');
    const snapshot=JSON.parse(JSON.parse(await fs.readFile(path.join(root,'session.json'),'utf8')).payload);assert.equal(snapshot.settings.externalCommands.length,2);
    console.log('PASS: configured command persistence, literal selection arguments, captured output, normal exit, stop command and unchanged buffer.');
  }finally{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.webContents.send('command','stopCommand')).catch(()=>{});await (await app.firstWindow()).waitForFunction(()=>document.querySelector('.command-output button')?.disabled,{},{timeout:3000}).catch(()=>{});app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
