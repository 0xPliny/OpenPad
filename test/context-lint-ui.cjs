const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-lint-ui-')),file=path.join(root,'AGENTS.md'),profile=path.join(root,'profile');let app;
  const text='# Empty\n\n# Instructions\n\nTODO review the policy.\n\nRepeated paragraph.\n\nRepeated paragraph.\n\n2020-01-01 historical note.\n\n```\nFIXME inside code\n```\n';await fs.writeFile(file,text);
  async function launch(){app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[file]}:{args:[path.resolve('.'),file]}),env:{...process.env,OPENPAD_USER_DATA:profile}});const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.waitForSelector('body[data-ready="true"]');return page;}
  const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
  try{
    let page=await launch();await command('contextLint');await page.locator('#lint-tokens').fill('1');await page.getByRole('button',{name:'Run advisory checks',exact:true}).click();await page.waitForSelector('[data-lint-code="placeholder"]');
    assert.equal(await page.locator('[data-lint-code="placeholder"]').count(),1);assert.equal(await page.locator('[data-lint-code="empty-section"]').count(),1);assert.equal(await page.locator('[data-lint-code="repeated-paragraph"]').count(),1);assert.equal(await page.locator('[data-lint-code="token-budget"]').count(),1);assert.equal(await page.locator('[data-lint-code="old-date-reference"]').count(),0);
    await page.locator('[data-lint-code="placeholder"]').getByRole('button',{name:'Dismiss suggestion',exact:true}).click();assert.equal(await page.locator('[data-lint-code="placeholder"]').count(),0);assert.match(await page.locator('#lint-summary').textContent(),/1 dismissed/);assert.equal(await fs.readFile(file,'utf8'),text);
    await page.locator('#lint-age').fill('365');assert.equal(await page.locator('[data-lint-code]').count(),0);await page.getByRole('button',{name:'Run advisory checks',exact:true}).click();await page.waitForSelector('[data-lint-code="old-date-reference"]');assert.match(await page.locator('[data-lint-code="old-date-reference"]').textContent(),/not an assertion.*stale/);
    await command('quit');await app.close();app=null;page=await launch();await command('contextLint');await page.getByRole('button',{name:'Run advisory checks',exact:true}).click();await page.waitForSelector('[data-lint-code="empty-section"]');assert.equal(await page.locator('[data-lint-code="placeholder"]').count(),0);
    await page.getByRole('button',{name:'Restore dismissed suggestions',exact:true}).click();await page.getByRole('button',{name:'Run advisory checks',exact:true}).click();await page.waitForSelector('[data-lint-code="placeholder"]');
    await page.locator('[data-lint-code="placeholder"]').getByRole('button').first().click();assert.equal(await page.locator('#dialog').evaluate(dialog=>dialog.open),false);assert.equal(await fs.readFile(file,'utf8'),text);
    console.log('PASS: advisory budgets/empty/duplicate/placeholder checks, code exclusion, opt-in historical-date heuristic, persistent dismissal/reset and source navigation without writes.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
