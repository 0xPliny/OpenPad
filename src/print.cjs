const {BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {replaceFile}=require('./replace-file.cjs');
const escape=text=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
async function printDocument({text,name,pdf,directory}) {
  if(typeof text!=='string' || text.length>4*1024*1024)throw new Error('Print and PDF export currently support up to 4 MiB of text.');
  const file=path.join(directory,`print-${randomUUID()}.html`);
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(String(name))}</title><style>@page{margin:15mm}body{font:10pt Consolas,monospace}h1{font:12pt sans-serif}pre{white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}</style></head><body><h1>${escape(String(name))}</h1><pre>${escape(text)}</pre></body></html>`;
  let window;
  try{
    await fs.mkdir(directory,{recursive:true});await fs.writeFile(file,html,{flag:'wx'});
    window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
    await window.loadFile(file);
    if(pdf){
      const bytes=await window.webContents.printToPDF({printBackground:false,preferCSSPageSize:true});
      const temp=`${pdf}.${randomUUID()}.tmp`;
      try{await fs.writeFile(temp,bytes,{flag:'wx'});await replaceFile(temp,pdf);}finally{await fs.unlink(temp).catch(()=>{});}
      return {path:pdf};
    }
    return await new Promise((resolve,reject)=>window.webContents.print({silent:false,printBackground:false},(success,reason)=>{
      if(success)resolve({printed:true});else if(/cancel/i.test(reason))resolve({cancelled:true});else reject(new Error(reason || 'Printing failed.'));
    }));
  }finally{window?.destroy();await fs.unlink(file).catch(()=>{});}
}
module.exports={printDocument};
