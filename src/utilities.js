import {isolateHistory} from '@codemirror/commands';
import {scalar,characterInfo} from './utilities-model.mjs';
export function installUtilities(ctx,ui){
  const {commands,$}=ctx,{show,body,button,closeDialog,labels}=ui;
  commands.characterPanel=()=>{
    const view=ctx.editorView();
    const doc=ctx.active,original=view.state.doc,selection=view.state.selection;
    show('Character panel','<label>Unicode code point <input id="character-code" value="U+03B1" maxlength="8"></label><p id="character-preview"></p><p>Insert a Unicode character at each selection. The table describes up to 256 characters in the primary selection, or the character at the cursor.</p><table id="character-table"><thead><tr><th>Character</th><th>Code point</th><th>UTF-16 units</th><th>UTF-8 bytes</th></tr></thead><tbody></tbody></table>');
    const preview=()=>{try{$('#character-preview').textContent=scalar($('#character-code').value);}catch(error){$('#character-preview').textContent=error.message;}};$('#character-code').oninput=preview;preview();
    const range=selection.main,text=range.empty?original.sliceString(range.head,Math.min(original.length,range.head+2)):original.sliceString(range.from,Math.min(range.to,range.from+512));
    for(const info of characterInfo(range.empty?[...text][0]||'':text)){const row=document.createElement('tr');for(const value of [info.character,info.code,info.units,info.bytes]){const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);}$('#character-table tbody').append(row);}
    body.append(button('Insert character',()=>{if(!view.dom.isConnected||ctx.active!==doc||view.state.doc!==original||!view.state.selection.eq(selection))throw new Error('Document or selection changed; reopen Character panel.');if(view.state.readOnly)throw new Error('This document is read-only.');const text=scalar($('#character-code').value);view.dispatch({...view.state.replaceSelection(text),annotations:isolateHistory.of('full')});closeDialog();}));
  };
  commands.checksum=async()=>{
    const view=ctx.editorView();
    const selection=view.state.selection.main,text=selection.empty?view.state.doc.toString():view.state.sliceDoc(selection.from,selection.to);
    show('Text checksums','<p>Checksums describe a snapshot of the selection, or the whole buffer, encoded as UTF-8 with its current normalized LF line endings. They are not checksums of the original disk bytes.</p><p id="checksum-status">Calculating…</p><div id="checksum-values"></div>');const container=$('#checksum-values'),status=$('#checksum-status');
    const data=new TextEncoder().encode(text);for(const algorithm of ['SHA-256','SHA-512']){const result=await crypto.subtle.digest(algorithm,data);if(!container.isConnected)return;const value=[...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join(''),row=document.createElement('p'),code=document.createElement('code');code.textContent=value;row.append(`${algorithm}: `,code,button(`Copy ${algorithm}`,()=>window.desktop.copyText(value)));container.append(row);}const md5=await window.desktop.textMd5(text);if(!container.isConnected)return;if(md5){const row=document.createElement('p'),code=document.createElement('code');code.textContent=md5;row.append('MD5: ',code,button('Copy MD5',()=>window.desktop.copyText(md5)));container.append(row);}status.textContent=`${data.length.toLocaleString()} UTF-8 bytes`;
  };
  commands.fileChecksum=async()=>{
    const doc=ctx.active;if(!doc.path)throw new Error('Save or open a disk file first.');
    show('File checksums','<p>Hashes of the file bytes read from disk, including encoding, BOM and line endings. Unsaved editor changes are excluded. Files up to 32 MiB are supported.</p><p id="file-checksum-path"></p><p id="file-checksum-status">Calculating…</p><div id="file-checksum-values"></div>');const container=$('#file-checksum-values'),status=$('#file-checksum-status');$('#file-checksum-path').textContent=doc.path;
    const result=await window.desktop.fileChecksums(doc.id);if(!container.isConnected)return;if(!result){status.textContent='Checksum calculation failed';return;}
    for(const [algorithm,value]of Object.entries(result.values)){const row=document.createElement('p'),code=document.createElement('code');code.textContent=value;row.append(`${algorithm}: `,code,button(`Copy ${algorithm}`,()=>window.desktop.copyText(value)));container.append(row);}status.textContent=`${result.bytes.toLocaleString()} file bytes`;
  };
  Object.assign(labels,{characterPanel:'Unicode character panel',checksum:'SHA-256 / SHA-512 / MD5 text checksums',fileChecksum:'File byte checksums'});
}
