const { _electron: electron } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openpad-open-'));
  const first = path.join(dir, 'first file 世界.txt');
  const second = path.join(dir, 'second file.txt');
  await fs.writeFile(first, 'First file contents — 世界');
  await fs.writeFile(second, 'Second file contents');
  const executablePath = process.env.OPENPAD_EXECUTABLE;
  const baseArgs = executablePath ? [] : [path.resolve('.')];
  const env = { ...process.env, OPENPAD_USER_DATA:path.join(dir,'profile') };
  const app = await electron.launch({ ...(executablePath ? {executablePath} : {}), args:[...baseArgs, first], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await page.waitForSelector('body[data-ready="true"]');
    await page.waitForFunction(() => document.querySelector('#editor .cm-content').textContent.includes('First file contents'));
    assert.equal(await page.locator('#filepath').innerText(), await fs.realpath(first));
    const area = await page.locator('#editor').boundingBox();
    assert.ok(area.height > 100, 'File content has a visible editor area');
    const editor = page.locator('#editor .cm-content');
    await editor.fill('Unsaved first-file edits');
    async function launchSecond(file) {
      const child = spawn(executablePath || require('electron'), [...baseArgs, file], { env, windowsHide:true, stdio:'ignore' });
      await new Promise((resolve,reject) => { child.on('error',reject); child.on('exit',code => code === 0 ? resolve() : reject(new Error(`Second launch exit ${code}`))); });
    }
    await launchSecond(second);
    await page.waitForFunction(() => document.querySelector('#editor .cm-content').textContent === 'Second file contents');
    assert.equal(await page.locator('#filepath').innerText(),await fs.realpath(second));
    await launchSecond(first);
    await page.waitForFunction(() => document.querySelector('#editor .cm-content').textContent === 'Unsaved first-file edits');
    assert.equal(await page.locator('#tabs button').filter({hasText:/first file/}).count(),1);
    assert.match(await page.locator('#status').innerText(),/Unsaved/);
    console.log('PASS: cold launch filename, visible contents, real second-process file handoff, duplicate activation preserves unsaved edits.');
  } finally { app.process().kill(); await app.close().catch(()=>{}); await fs.rm(dir,{recursive:true}); }
})().catch(error => { console.error(error); process.exitCode=1; });
