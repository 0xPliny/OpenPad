
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'openpad-templates-ui-')),file=path.join(root,'AGENTS.md'),profile=path.join(root,'profile');let app;
  const original='Existing instructions must survive.\n';await fs.writeFile(file,original);
  const command=name=>app.evaluate(({BrowserWindow},name)=>BrowserWindow.getAllWindows()[0].webContents.send('command',name),name);
  try{
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[file]}:{args:[path.resolve('.'),file]}),env:{...process.env,OPENPAD_USER_DATA:profile}});
    const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.waitForSelector('body[data-ready="true"]');
    const editor=()=>page.locator('.cm-editor').first();
    await editor().locator('.cm-content').evaluate(node=>{const view=node.cmTile.root.view;view.dispatch({changes:{from:view.state.doc.length,insert:'Unsaved original edit.'}});});
    await command('contextTemplates');assert.equal(await page.locator('#template-choice option').count(),7);assert.equal(await page.locator('#template-preview').evaluate(node=>node.readOnly),true);
    const preview=await page.locator('#template-preview').inputValue();assert.match(preview,/not an official schema/);
    await page.locator('#dialog-close').click();assert.equal(await editor().locator('.cm-content').evaluate(node=>node.cmTile.root.view.state.doc.toString()),original+'Unsaved original edit.');
    await command('contextTemplates');await page.locator('#template-create').click();
    await page.waitForFunction(()=>!document.querySelector('#dialog').open);
    assert.equal(await editor().locator('.cm-content').evaluate(node=>node.cmTile.root.view.state.doc.toString()),preview);
    assert.equal(await fs.readFile(file,'utf8'),original);
    // Recovery stores reveal whether the generated tab has a path and whether the original dirty buffer survived.
    await command('quit');await app.close();app=null;
    const {SessionStore}=require('../src/session.cjs');
    const saved=await new SessionStore(profile).load(),sameName=saved.docs.filter(doc=>doc.name==='AGENTS.md');assert.equal(sameName.length,2);
    const canonical=await fs.realpath(file),bound=sameName.find(doc=>doc.path===canonical),generated=sameName.find(doc=>!doc.path);assert.ok(bound);assert.ok(generated);assert.equal(bound.text,original+'Unsaved original edit.');assert.equal(generated.text,preview);assert.equal(generated.saved,'');
    assert.equal(await fs.readFile(file,'utf8'),original);
    app=await electron.launch({...(process.env.OPENPAD_EXECUTABLE?{executablePath:process.env.OPENPAD_EXECUTABLE,args:[]}:{args:[path.resolve('.')]}),env:{...process.env,OPENPAD_USER_DATA:profile}});
    const second=await app.firstWindow();second.setDefaultTimeout(15000);await second.waitForSelector('body[data-ready="true"]');await command('contextTemplates');await second.locator('#template-choice').selectOption('skill');
    await second.locator('#template-name').fill('Invalid Name');assert.equal(await second.locator('#template-create').isDisabled(),true);assert.equal(await second.locator('#template-preview').inputValue(),'');
    await second.locator('#template-name').fill('review-context');await second.locator('#template-description').fill('Use "quoted" input <b>literally</b>.');assert.equal(await second.locator('#template-create').isEnabled(),true);assert.equal(await second.locator('#dialog b').count(),0);
    const skill=await second.locator('#template-preview').inputValue();assert.match(skill,/name: "review-context"/);assert.match(skill,/description: /);await second.locator('#template-create').click();
    assert.equal(await second.locator('.cm-content').first().evaluate(node=>node.cmTile.root.view.state.doc.toString()),skill);assert.equal(await fs.readFile(file,'utf8'),original);
    console.log('PASS: seven starters, readonly preview, validated skill metadata, safe text rendering, unsaved creation and same-name dirty file preservation across restart.');
  }finally{if(app){app.process().kill();await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
