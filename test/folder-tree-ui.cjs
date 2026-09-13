const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-tree-'));let app;
  try{
    const folder=path.join(root,'project');await fs.mkdir(path.join(folder,'nested'),{recursive:true});await fs.writeFile(path.join(folder,'nested','hello.txt'),'nested content');await fs.writeFile(path.join(folder,'top.txt'),'top content');
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
    const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForSelector('body[data-ready="true"]');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await command('folder');await page.waitForSelector('#picker-query');await page.locator('#dialog-close').click();const tree=page.locator('.folder-tree');assert.equal(await tree.getByRole('button',{name:'hello.txt',exact:true}).count(),0);await tree.locator('summary').click();await tree.getByRole('button',{name:'hello.txt',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='nested content');
    await tree.getByRole('textbox',{name:'Filter folder files'}).fill('hello');assert.equal(await tree.getByRole('button',{name:'top.txt',exact:true}).count(),0);await tree.locator('summary').click();await tree.getByRole('button',{name:'hello.txt',exact:true}).waitFor();
    await fs.writeFile(path.join(folder,'new.txt'),'new content');await command('refreshFolder');await tree.getByRole('button',{name:'new.txt',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#editor .cm-content').textContent==='new content');
    console.log('PASS: lazy nested folder tree, file opening, filtering and refresh of newly created files.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
