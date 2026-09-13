const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path');

(async()=>{
  if(!process.env.OPENPAD_EXECUTABLE)throw new Error('Set OPENPAD_EXECUTABLE to the verified artifact.');
  await fs.mkdir('test-artifacts',{recursive:true});
  const root=await fs.mkdtemp(path.resolve('test-artifacts','screenshots-'));
  const sample=path.join(root,'AGENTS.md');
  await fs.writeFile(sample,'# Project context\n\nOpenPad is a local workbench for agent-maintained Markdown.\n\n## Working agreements\n\n- Inspect the source before changing behavior.\n- Keep changes focused and preserve user documents.\n- Describe uncertainty instead of inventing provenance.\n\n## Validation\n\nRun the relevant model and desktop tests.\nKeep observed results separate from product guarantees.\n\n## Review boundaries\n\nFilesystem events identify changes, not their author.\nReview proposals before promoting staged writes.\n');
  const app=await electron.launch({executablePath:process.env.OPENPAD_EXECUTABLE,args:[sample],env:{...process.env,OPENPAD_USER_DATA:path.join(root,'profile')}});
  try{
    const page=await app.firstWindow();
    await page.waitForSelector('body[data-ready="true"]');
    await page.waitForFunction(()=>document.querySelector('#filepath').textContent.endsWith('AGENTS.md'));
    await page.waitForFunction(()=>document.querySelector('#language').value==='Markdown');
    const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
    await fs.mkdir('docs/screenshots',{recursive:true});
    for(const theme of ['dark','light']){
      await command('settings');
      await page.locator('#setting-theme').selectOption(theme);
      await page.locator('#setting-size').fill('16');
      await page.getByRole('button',{name:'Apply settings',exact:true}).click();
      await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme&&!document.querySelector('#dialog').open,theme);
      await page.locator('#editor .cm-content').focus();
      await page.waitForFunction(()=>/\d+ tokens/.test(document.querySelector('#context-token-count').textContent));
      await page.screenshot({path:`docs/screenshots/editor-${theme}.png`});
    }
    await command('contextBudget');await page.waitForSelector('#context-sections button');await page.screenshot({path:'docs/screenshots/context-budget.png'});
    console.log(`Screenshots captured from ${process.env.OPENPAD_EXECUTABLE}; isolated fixtures retained at ${root}`);
  }finally{app.process().kill();await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1;});
