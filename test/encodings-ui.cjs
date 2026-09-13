const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-encodings-'));let app;
  try{
    const file=path.join(root,'japanese.txt');await fs.writeFile(file,Buffer.from('93fa967b0d0a','hex'));
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
    await command('openEncoding');await page.locator('#open-encoding').selectOption('shiftjis');await page.getByRole('button',{name:'Choose files',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent.includes('日本'));assert.ok((await page.locator('#encoding').textContent()).includes('Shift JIS'));
    await command('save');await page.waitForTimeout(100);assert.equal((await fs.readFile(file)).toString('hex'),'93fa967b0d0a');
    await command('reload');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent.includes('日本'));assert.ok((await page.locator('#encoding').textContent()).includes('Shift JIS'));
    await command('encoding');await page.locator('#file-encoding').selectOption('utf32be');await page.locator('#file-bom').check();await page.getByRole('button',{name:'Use for next save',exact:true}).click();await command('save');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('All changes saved'));assert.equal((await fs.readFile(file)).toString('hex'),'0000feff000065e50000672c0000000d0000000a');
    await command('reload');await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent.includes('日本'));assert.ok((await page.locator('#encoding').textContent()).includes('UTF-32 BE'));
    const folder=path.join(root,'fixtures');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'cyrillic.txt'),Buffer.from('d0a0','hex'));
    await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await command('folder');await page.waitForSelector('#picker-query');await page.locator('#dialog-close').click();await command('folderSearch');await page.locator('#search-encoding').selectOption('windows1251');await page.locator('#folder-query').fill('Р ');await page.locator('#folder-start').click();await page.waitForFunction(()=>document.querySelector('#folder-progress').textContent.startsWith('Finished'));assert.equal(await page.locator('#folder-results button').count(),1);await page.locator('#folder-results button').click();await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('cyrillic.txt'));assert.equal(await page.locator('#editor .cm-content').textContent(),'Р ');assert.ok((await page.locator('#encoding').textContent()).includes('Windows-1251'));
    await page.locator('#editor .cm-content').fill('keep edits');await page.locator('#folder-results button').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('differs from the search snapshot'));assert.equal(await page.locator('#editor .cm-content').textContent(),'keep edits');
    console.log('PASS: explicit Shift JIS open and byte-preserving save; UTF-32 BE/BOM conversion and reload.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
