import {installContext} from './context-ui.js';
import {installMcp} from './mcp-ui.js';
import {installTemplates} from './context-templates-ui.js';
import {peerState,documentChanges,paneSync,restoredSelection,captureScroll,restoreScroll} from './pane-state.mjs';
import {folderTree} from './folder-tree.js';
import {installUtilities} from './utilities.js';
import {labels as encodingLabels,boms} from './encodings.cjs';
import {installVisibility} from './visibility.js';
import {installMarks} from './marks.mjs';
import { EditorState,Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { isolateHistory } from '@codemirror/commands';
import { installEditing } from './editing.js';
import { installReplacement } from './replacement-ui.js';
import { installTransforms } from './transform-ui.js';
import { installLanguageTools } from './language-tools.js';
import { installCustomLanguages } from './custom-language-ui.js';
import { restoreLanguageSettings } from './language-settings.mjs';
import { installExternalCommands } from './external-commands.js';

export function installFeatures(ctx) {
  const { $, commands, docs, view, run, makeDoc, activate, settings } = ctx;
  let dialogEditor=view;
  let folder, merge, markdownVisible = false, paletteItems = [], paletteIndex = 0;
  const dialog = $('#dialog');
  const body = $('#dialog-body');
  const labels = { new:'New document', open:'Open files', save:'Save', saveAs:'Save As', saveAll:'Save all', close:'Close tab', quit:'Exit (retain recovery session)', undo:'Undo', redo:'Redo', find:'Find / Replace in document', folder:'Open folder', folderSearch:'Find in folder', quickOpen:'Quick open file or tab', palette:'Command palette', settings:'Settings and preferences', compare:'Compare two buffers', markdown:'Toggle Markdown preview', replacePreview:'Preview replacement', goto:'Go to line', formatJson:'Format JSON', sortLines:'Sort lines', dedupe:'Remove duplicate lines', trim:'Trim trailing whitespace', pin:'Pin / unpin tab', group:'Name tab group', reload:'Reload from disk', encoding:'Encoding and line endings', largePreview:'Open large file preview', nextTab:'Next tab', previousTab:'Previous tab', wrap:'Toggle word wrap', resetLayout:'Reset layout' };
  const shortcuts = { new:'Ctrl+N', open:'Ctrl+O', save:'Ctrl+S', saveAs:'Ctrl+Shift+S', close:'Ctrl+W', find:'Ctrl+F', folder:'Ctrl+Shift+O', folderSearch:'Ctrl+Shift+F', quickOpen:'Ctrl+P', palette:'Ctrl+Shift+P', settings:'Ctrl+,', goto:'Ctrl+G', wrap:'Alt+Z', undo:'Ctrl+Z', redo:'Ctrl+Y' };
  function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function button(text, action) { const node = element('button', text); node.type = 'button'; node.onclick = () => run(action); return node; }
  function closeDialog() { merge?.destroy(); merge = null; dialog.close(); (dialogEditor?.dom.isConnected?dialogEditor:view).focus(); }
  $('#dialog-close').onclick = closeDialog;
  dialog.addEventListener('cancel', () => { merge?.destroy(); merge = null; });
  function show(title, markup = '') { dialog.dispatchEvent(new Event('openpad-dialog-replace'));dialogEditor=ctx.editorView?.()||view;merge?.destroy(); merge = null; $('#dialog-title').textContent = title; body.innerHTML = markup; if (!dialog.open) dialog.showModal(); }
  function adopt(data) { if (!data) return; const old = docs.find(doc => doc.id === data.id); if (old) activate(old); else makeDoc(data); }
  function replaceText(text,view=ctx.editorView()) { if(!view.dom.isConnected)throw new Error('The invoking editor was closed; reopen the command.');if (view.state.readOnly) throw new Error('The document is read-only.'); view.dispatch({ changes: { from:0, to:view.state.doc.length, insert:text }, annotations:isolateHistory.of('full') }); }
  function listPicker(title, items) {
    show(title, '<input id="picker-query" aria-label="Filter" placeholder="Type to filter…" autocomplete="off"><div id="picker-results" role="listbox"></div>');
    const input = $('#picker-query'), results = $('#picker-results');
    function draw() {
      const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      paletteItems = items.filter(item => terms.every(term => item.label.toLowerCase().includes(term))).slice(0,100); paletteIndex = 0;
      results.replaceChildren();
      paletteItems.forEach((item, index) => { const node = button(item.label, async () => { closeDialog(); await item.action(); }); node.setAttribute('role','option'); node.dataset.index = index; results.append(node); });
      select();
    }
    function select() { [...results.children].forEach((node,index) => { node.classList.toggle('selected',index === paletteIndex); node.setAttribute('aria-selected',String(index === paletteIndex)); }); results.children[paletteIndex]?.scrollIntoView({ block:'nearest' }); }
    input.oninput = draw;
    input.onkeydown = event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); paletteIndex = Math.max(0,Math.min(paletteItems.length - 1,paletteIndex + (event.key === 'ArrowDown' ? 1 : -1))); select(); } else if (event.key === 'Enter' && paletteItems[paletteIndex]) { event.preventDefault(); results.children[paletteIndex].click(); } };
    draw(); input.focus();
  }
  commands.palette = () => listPicker('Commands', Object.keys(commands).map(name => ({ label:`${labels[name] || name}${shortcuts[name] ? ` — ${shortcuts[name]}` : ''}`, action:commands[name] })));
  commands.quickOpen = () => listPicker('Quick open — tabs and current folder', [ ...docs.map(doc => ({ label:`${doc.name} — ${doc.path || 'Unsaved tab'}`, action:() => activate(doc) })), ...(folder?.files || []).filter(path => !docs.some(doc => doc.path === path)).map(path => ({ label:path, action:async () => adopt(await window.desktop.openPath(path)) })) ]);
  commands.folder = async () => { const result = await window.desktop.openFolder(); if (!result) return; folder = result;renderFolder(result); $('#folder-name').textContent = result.root; $('#folder-name').title = 'Quick-open indexes up to 10,000 files / 15 directory levels, excluding .git, node_modules, dist, release and symlinks.'; commands.quickOpen(); };
  commands.largePreview = async () => adopt(await window.desktop.largePreview());
  const previewBar=document.createElement('div');previewBar.className='editor-toolbar';previewBar.hidden=true;previewBar.innerHTML='<span id="preview-range"></span><div><button data-command="previewPrevious">Previous page</button><button data-command="previewNext">Next page</button><button data-command="previewGoto">Go to byte</button><button data-command="previewSearch">Search whole file</button></div>';$('#editor').before(previewBar);
  const refreshPreview=()=>{const page=ctx.active?.preview;previewBar.hidden=!page;if(!page)return;$('#preview-range').textContent=`Bytes ${page.offset.toLocaleString()}–${page.end.toLocaleString()} of ${page.size.toLocaleString()} (end excluded)`;previewBar.querySelector('[data-command="previewPrevious"]').disabled=page.previousOffset===null&&!ctx.active.previewTrail?.length;previewBar.querySelector('[data-command="previewNext"]').disabled=page.nextOffset===null;};window.addEventListener('openpad-activate',refreshPreview);window.addEventListener('openpad-edit',refreshPreview);
  async function loadPreview(doc,offset,direction='goto',version){if(!doc.preview)throw new Error('Open a large-file preview first.');const target=ctx.editorView(),original=doc.preview;const data=await window.desktop.previewPage({id:doc.id,offset,version});if(!data)return false;if(ctx.active!==doc||doc.preview!==original||!target.dom.isConnected)throw new Error('Preview changed; retry navigation.');const trail=doc.previewTrail||[];ctx.reloadBuffer(doc,data);doc.previewTrail=data.preview.size!==original.size?[]:direction==='next'?[...trail.slice(-999),original.offset]:direction==='previous'?trail.slice(0,-1):[];target.dispatch({selection:{anchor:0},scrollIntoView:true});refreshPreview();return true;}
  commands.previewNext=()=>{const doc=ctx.active;if(doc.preview?.nextOffset!=null)return loadPreview(doc,doc.preview.nextOffset,'next');};
  commands.previewPrevious=()=>{const doc=ctx.active;if(doc.preview?.previousOffset!=null)return loadPreview(doc,doc.previewTrail?.at(-1)??doc.preview.previousOffset,'previous');};
  commands.previewGoto=()=>{const doc=ctx.active;if(!doc.preview)throw new Error('Open a large-file preview first.');show('Go to preview byte','<p>Byte offsets start at zero. A position inside a valid UTF-8 character moves back to its first byte. Search and marks apply to the displayed page.</p><label>Byte offset <input id="preview-offset" type="number" min="0"></label>');$('#preview-offset').value=doc.preview.offset;$('#preview-offset').max=Math.max(0,doc.preview.size-1);body.append(button('Open page',async()=>{const offset=+$('#preview-offset').value;if(!Number.isSafeInteger(offset)||offset<0||offset>Math.max(0,doc.preview.size-1))throw new Error('Choose a byte offset within the file.');await loadPreview(doc,offset);closeDialog();}));};
  let previewSearchId=0,previewSearchProgress=null;window.desktop.onPreviewSearchProgress(message=>previewSearchProgress?.(message));
  commands.previewSearch=()=>{
    const doc=ctx.active;if(!doc.preview)throw new Error('Open a large-file preview first.');
    show('Search whole preview file','<p>Exact, case-sensitive UTF-8 text matching across the disk file. Results use zero-based byte offsets. Stops at 1,000 matches or after 30 seconds; cancellation leaves the preview unchanged.</p><label>Text to find <input id="preview-query" maxlength="32768"></label><p id="preview-search-status"></p><div id="preview-search-results"></div>');
    const query=$('#preview-query'),status=$('#preview-search-status'),results=$('#preview-search-results'),dialog=$('#dialog');let activeRequest=0;
    const cancel=()=>{if(activeRequest){window.desktop.cancelPreviewSearch(activeRequest);activeRequest=0;}cancelButton.disabled=true;if(status.isConnected)status.textContent='Cancelled';};
    const cancelButton=button('Cancel file search',cancel);cancelButton.onclick=cancel;cancelButton.disabled=true;
    const report=message=>{if(message.requestId===activeRequest&&status.isConnected)status.textContent=`Read ${message.bytesRead.toLocaleString()} of ${message.size.toLocaleString()} bytes…`;};previewSearchProgress=report;
    const dispose=()=>{cancel();if(previewSearchProgress===report)previewSearchProgress=null;dialog.removeEventListener('close',dispose);dialog.removeEventListener('openpad-dialog-replace',dispose);};dialog.addEventListener('close',dispose);dialog.addEventListener('openpad-dialog-replace',dispose);
    query.oninput=()=>{if(activeRequest)cancel();results.replaceChildren();};
    body.append(button('Find in whole file',async()=>{
      const id=++previewSearchId;activeRequest=id;cancelButton.disabled=false;results.replaceChildren();status.textContent='Searching…';
      const response=await window.desktop.previewSearch({id:doc.id,requestId:id,query:query.value});if(activeRequest!==id||!results.isConnected)return;activeRequest=0;cancelButton.disabled=true;
      if(!response||response.error){status.textContent=response?.error||'Search failed';return;}if(response.cancelled){status.textContent='Cancelled';return;}
      const result=response.result;status.textContent=result.capped?'Stopped at 1,000 matches; more may exist.':`${result.matches.length.toLocaleString()} matches; searched ${result.bytesRead.toLocaleString()} bytes`;
      for(const match of result.matches)results.append(button(`Byte ${match.from.toLocaleString()}`,async()=>{if(await loadPreview(doc,match.from,'goto',result.version))closeDialog();}));
    }),cancelButton);
  };
  Object.assign(labels,{previewNext:'Next large-file preview page',previewPrevious:'Previous large-file preview page',previewGoto:'Go to byte in large-file preview',previewSearch:'Search entire large-file preview'});

  commands.saveWorkspace = () => { show('Save named workspace','<label>Name <input id="workspace-name" maxlength="80"></label>'); body.append(button('Save workspace',async () => { if (!settings.recovery) throw new Error('Enable recovery in Settings before saving a workspace.'); if (!await ctx.snapshot()) return; if (await window.desktop.saveWorkspace($('#workspace-name').value.trim())) closeDialog(); })); };
  commands.loadWorkspace = async () => listPicker('Open named workspace', (await window.desktop.listWorkspaces() || []).map(name => ({label:name,action:async () => { if (!settings.recovery) throw new Error('Enable recovery before switching workspaces.'); if (!await ctx.snapshot()) return; const data = await window.desktop.loadWorkspace(name); if (!data) return; const restored=restoreLanguageSettings(data.settings); settings.customLanguages={...settings.customLanguages,...restored.settings.customLanguages}; settings.apiEntries={...settings.apiEntries,...restored.settings.apiEntries}; ctx.refreshLanguages(); docs.splice(0); for (const doc of data.docs) makeDoc(doc); if (!docs.length) makeDoc(); activate(docs.find(doc => doc.id === data.activeId) || docs[0]); restorePaneLayout(data.settings?.paneLayout); await ctx.snapshot(); ctx.showLanguageWarnings(restored.warnings); }})));
  commands.saveAll = async () => { for (const doc of docs) if (ctx.dirty(doc) && !await ctx.save(doc)) break; };
  commands.saveCopy=async()=>{const doc=ctx.active;const result=await window.desktop.saveCopy({id:doc.id,text:doc.state.doc.toString(),encoding:doc.encoding,eol:doc.eol,bom:doc.bom});if(result){show('Copy saved');body.append(element('p',result.path));}};
  commands.renameFile=()=>{const doc=ctx.active;if(!doc.path || doc.state.readOnly)throw new Error('Open an editable saved file first.');show('Rename file','<label>New filename <input id="rename-name"></label><p>Renames the saved file in its current folder. Unsaved buffer edits remain unsaved. An existing destination is never replaced.</p>');$('#rename-name').value=doc.name;body.append(button('Rename',async()=>{const result=await window.desktop.renameFile({id:doc.id,name:$('#rename-name').value});if(result){Object.assign(doc,result);activate(doc);await ctx.snapshot();closeDialog();}}));};
  commands.trashFile=async()=>{const doc=ctx.active;if(!doc.path || doc.state.readOnly)throw new Error('Open an editable saved file first.');if(await window.desktop.trashFile(doc.id)){delete doc.path;delete doc.hash;doc.saved='';doc.savedDoc=EditorState.create().doc;doc.diskState='unchanged';activate(doc);await ctx.snapshot();}};
  commands.revealFile=()=>window.desktop.revealFile(ctx.active.id);
  const print=async pdf=>{const doc=ctx.active;const result=await window.desktop.printDocument({text:doc.state.doc.toString(),name:doc.name,pdf});if(result?.path){show('PDF exported');body.append(element('p',result.path));}};
  commands.print=()=>print(false);commands.exportPdf=()=>print(true);Object.assign(labels,{print:'Print complete buffer',exportPdf:'Export complete buffer as PDF'});
  labels.readOnly='Toggle read-only buffer';Object.assign(labels,{closeGroup:'Close tabs in current group',pinGroup:'Pin or unpin current group',saveGroup:'Save current group'});
  Object.assign(labels,{saveCopy:'Save a copy',renameFile:'Rename file',trashFile:'Move file to Recycle Bin',revealFile:'Show file in Explorer',reopenClosed:'Reopen last closed file',closeAll:'Close all tabs',closeOthers:'Close other unpinned tabs',tabLeft:'Move tab left',tabRight:'Move tab right'});
  commands.nextTab = () => activate(docs[(docs.indexOf(ctx.active) + 1) % docs.length]);
  commands.previousTab = () => activate(docs[(docs.indexOf(ctx.active) + docs.length - 1) % docs.length]);
  commands.pin = () => { ctx.active.pinned = !ctx.active.pinned; ctx.renderTabs(); ctx.snapshot(); };
  commands.group = () => { const doc = ctx.active; show('Name tab group','<label>Group name <input id="group-name" maxlength="80"></label><label>Group color <select id="group-color"><option value="mint">Mint</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="amber">Amber</option><option value="rose">Rose</option></select></label>'); $('#group-name').value = doc.group;$('#group-color').value=settings.groupColors?.[doc.group]||'mint'; body.append(button('Apply', () => { if(!docs.includes(doc))throw new Error('The target tab was closed. Reopen the group dialog.');doc.group = $('#group-name').value.trim();if(doc.group)settings.groupColors={...settings.groupColors,[doc.group]:$('#group-color').value}; ctx.renderTabs(); ctx.snapshot(); closeDialog(); })); };
  commands.reload = async () => {
    const doc = ctx.active; if (!doc.path) throw new Error('Save this document to disk first.');
    if (ctx.dirty(doc) && !await window.desktop.confirmReload()) return;
    const data = await window.desktop.reload({ id:doc.id }); if (!data) return;
    ctx.reloadBuffer(doc,data);
  };
  commands.goto = () => { const view=ctx.editorView();const doc=ctx.active;show('Go to line','<label>Line number <input id="line-number" type="number" min="1"></label>'); body.append(button('Go', () => { if(ctx.active!==doc||!view.dom.isConnected)throw new Error('The invoking editor changed; reopen Go to line.');const number = Number($('#line-number').value); if (!Number.isInteger(number) || number < 1 || number > view.state.doc.lines) throw new Error('Enter a line number in this document.'); const line = view.state.doc.line(number); closeDialog(); view.dispatch({ selection:{ anchor:line.from }, scrollIntoView:true }); })); $('#line-number').focus(); };
  commands.formatJson = () => replaceText(JSON.stringify(JSON.parse(view.state.doc.toString()), null, settings.tabSize));
  commands.sortLines = () => replaceText(view.state.doc.toString().split('\n').sort().join('\n'));
  commands.dedupe = () => replaceText([...new Set(view.state.doc.toString().split('\n'))].join('\n'));
  commands.trim = () => replaceText(view.state.doc.toString().replace(/[\t ]+$/gm,''));
  commands.openEncoding=()=>{show('Open with encoding','<label>Encoding <select id="open-encoding"></select></label><p>Choose the byte encoding explicitly. Invalid or non-round-tripping input is rejected. Files already open keep their current buffer; use Reopen with encoding to reinterpret them.</p>');$('#open-encoding').replaceChildren(...Object.entries(encodingLabels).map(([value,label])=>new Option(label,value)));body.append(button('Choose files',async()=>{const encoding=$('#open-encoding').value;closeDialog();for(const data of await window.desktop.open(encoding)||[])adopt(data);}));};labels.openEncoding='Open file with explicit encoding';
  commands.encoding = () => {
    const doc = ctx.active;
    show('Encoding and line endings', '<p>Convert the next save explicitly. Reopen reinterprets the disk bytes and asks before discarding edits.</p><label>Encoding <select id="file-encoding"><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="utf16be">UTF-16 BE</option><option value="windows1252">Windows-1252</option></select></label><label>Line endings <select id="file-eol"><option>LF</option><option>CRLF</option><option>CR</option><option>Mixed</option></select></label><label><input id="file-bom" type="checkbox"> Byte order mark</label>');
    $('#file-encoding').replaceChildren(...Object.entries(encodingLabels).map(([value,label])=>new Option(label,value)));
    $('#file-encoding').value = doc.encoding; $('#file-eol').value = doc.eol; $('#file-bom').checked = doc.bom;
    body.append(button('Use for next save', () => { if (doc.readOnly) throw new Error('Read-only preview'); if ($('#file-eol').value === 'Mixed' && !doc.originalEndings) throw new Error('Mixed endings can only be preserved from an existing mixed file.'); doc.encoding = $('#file-encoding').value; doc.eol = $('#file-eol').value; doc.bom = !!boms[doc.encoding] && $('#file-bom').checked; activate(doc); ctx.snapshot(); closeDialog(); }));
    body.append(button('Reopen with encoding', async () => { if (!doc.path) throw new Error('This document has no disk file.'); if (ctx.dirty(doc) && !await window.desktop.confirmReload()) return; const data = await window.desktop.reload({ id:doc.id, encoding:$('#file-encoding').value }); if (data) { docs.splice(docs.indexOf(doc),1); makeDoc({...data,locked:doc.locked,pinned:doc.pinned,group:doc.group}); closeDialog(); } }));
  };
  commands.settings = () => {
    show('Settings', '<input id="settings-filter" aria-label="Search settings" placeholder="Search settings: theme, font, backup, wrap…"><div id="settings-fields"><label data-terms="theme appearance light dark system">Theme <select id="setting-theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label><label data-terms="font size">Font size <input id="setting-size" type="number" min="10" max="32"></label><label data-terms="font family">Font family <input id="setting-font"></label><label data-terms="indent tabs size">Tab width <input id="setting-tabs" type="number" min="1" max="8"></label><label data-terms="backup recovery restore session"><input id="setting-recovery" type="checkbox"> Restore tabs and unsaved buffers on restart</label><p data-terms="backup recovery restore session">Recovery snapshots stay in your local app data, with one previous generation. Disabling recovery clears both generations. Explicitly closing a tab still asks about unsaved edits.</p><label data-terms="wrap"><input id="setting-wrap" type="checkbox"> Word wrap for new documents</label></div>');
    $('#setting-theme').value = settings.theme; $('#setting-size').value = settings.fontSize; $('#setting-font').value = settings.fontFamily; $('#setting-tabs').value = settings.tabSize; $('#setting-recovery').checked = settings.recovery; $('#setting-wrap').checked = settings.defaultWrap;
    $('#settings-filter').oninput = event => body.querySelectorAll('[data-terms]').forEach(node => node.hidden = !node.dataset.terms.includes(event.target.value.toLowerCase()));
    body.append(button('Apply settings', async () => { const size = Number($('#setting-size').value), tabs = Number($('#setting-tabs').value); if (!Number.isInteger(size) || size < 10 || size > 32 || !Number.isInteger(tabs) || tabs < 1 || tabs > 8) throw new Error('Font size must be 10–32 and tab width 1–8.'); Object.assign(settings,{ theme:$('#setting-theme').value, fontSize:size, fontFamily:$('#setting-font').value || 'monospace', tabSize:tabs, recovery:$('#setting-recovery').checked, defaultWrap:$('#setting-wrap').checked }); ctx.applySettings(); await ctx.snapshot(); if (!settings.recovery) await ctx.snapshot(); closeDialog(); }));
  };
  commands.shortcuts = async () => {
    const entries=await window.desktop.shortcuts();
    show('Keyboard shortcuts','<p>Use Ctrl, Alt, Shift plus a key, such as Ctrl+Alt+S. Empty means unassigned. Conflicting app shortcuts are rejected.</p><input id="shortcut-filter" aria-label="Filter shortcuts" placeholder="Filter commands…"><div id="shortcut-rows"></div>');
    const inputs=new Map();
    for(const entry of entries){const row=element('label',entry.label);row.className='shortcut-row';const input=document.createElement('input');input.value=entry.accelerator;input.setAttribute('aria-label',entry.label);row.append(input);$('#shortcut-rows').append(row);inputs.set(entry.id,input);}
    $('#shortcut-filter').oninput=event=>body.querySelectorAll('.shortcut-row').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(event.target.value.toLowerCase()));
    body.append(button('Apply shortcuts',async()=>{const result=await window.desktop.setShortcuts(Object.fromEntries([...inputs].map(([id,input])=>[id,input.value.trim()])));if(result){settings.shortcuts=result;Object.assign(shortcuts,result);await ctx.snapshot();closeDialog();}}),button('Restore defaults',async()=>{const result=await window.desktop.setShortcuts({});if(result){settings.shortcuts=result;Object.assign(shortcuts,result);await ctx.snapshot();closeDialog();}}));
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',() => ctx.applySettings());
  function compareTexts(a,b,parent) {
    const extensions = [EditorState.readOnly.of(true),EditorView.editable.of(false),EditorView.theme({ '&':{ height:'420px' }, '.cm-scroller':{ overflow:'auto',fontFamily:'var(--editor-font)' } })];
    merge?.destroy(); merge = new MergeView({ a:{doc:a,extensions},b:{doc:b,extensions},parent,highlightChanges:true,gutter:true });
  }
  commands.compare = () => {
    if (docs.length < 2) throw new Error('Open two documents to compare.');
    show('Compare buffers — read-only snapshots','<div class="compare-selectors"><label>Left <select id="compare-left"></select></label><label>Right <select id="compare-right"></select></label></div><div id="compare-view"></div>');
    docs.forEach(doc => { $('#compare-left').add(new Option(doc.name,doc.id)); $('#compare-right').add(new Option(doc.name,doc.id)); });
    $('#compare-left').value = ctx.active.id; $('#compare-right').value = docs.find(doc => doc !== ctx.active).id;
    const draw = () => { $('#compare-view').replaceChildren(); compareTexts(docs.find(doc => doc.id === $('#compare-left').value).state.doc.toString(),docs.find(doc => doc.id === $('#compare-right').value).state.doc.toString(),$('#compare-view')); };
    $('#compare-left').onchange = draw; $('#compare-right').onchange = draw; draw();
    body.append(button('Previous difference',()=>goToPreviousChunk(merge.a)),button('Next difference',()=>goToNextChunk(merge.a)));
  };
  commands.replacePreview = () => { const view=ctx.editorView();
    const doc = ctx.active; if (doc.readOnly) throw new Error('Read-only preview');
    const original = doc.state.doc;
    show('Preview replacement — current document, literal text','<p>Multiline literal replacement. No document changes occur until Apply.</p><label>Find <textarea id="preview-find" rows="3"></textarea></label><label>Replace with <textarea id="preview-replace" rows="3"></textarea></label><div id="replacement-count" role="status"></div><div id="replacement-diff"></div>');
    let replacement = null;
    const preview = button('Preview', () => { const find = $('#preview-find').value; if (!find) throw new Error('Enter text to find.'); const before = original.toString(); const pieces = before.split(find); replacement = pieces.join($('#preview-replace').value); $('#replacement-count').textContent = `${pieces.length - 1} replacements in ${doc.name}`; $('#replacement-diff').replaceChildren(); compareTexts(before,replacement,$('#replacement-diff')); });
    const apply = button('Apply replacement', () => { if (replacement === null) throw new Error('Preview the replacement first.'); if (ctx.active !== doc || doc.state.doc !== original) throw new Error('The document changed. Close and create a new preview.'); replaceText(replacement,view); closeDialog(); });
    for (const input of [$('#preview-find'),$('#preview-replace')]) input.oninput = () => { replacement = null; $('#replacement-count').textContent = 'Inputs changed — preview again before applying.'; };
    body.append(preview,apply);
  };
  const preview = element('article',null,'markdown-preview'); preview.id = 'markdown-preview'; preview.hidden = true;
  $('#editor').parentElement.append(preview);
  function renderMarkdown() { if (!markdownVisible) return; preview.innerHTML = DOMPurify.sanitize(marked.parse(ctx.active.state.doc.toString()),{ FORBID_TAGS:['img','iframe','style','form'], FORBID_ATTR:['style'] }); }
  preview.addEventListener('click',event => { if (event.target.closest('a')) event.preventDefault(); });
  commands.markdown = () => { markdownVisible = !markdownVisible; preview.hidden = !markdownVisible; renderMarkdown(); };
  let previewTimer;
  window.addEventListener('openpad-edit',() => { clearTimeout(previewTimer); previewTimer = setTimeout(renderMarkdown,200); });
  window.addEventListener('openpad-activate',renderMarkdown);
  const folderTools = element('div',null,'folder-tools');
  folderTools.append(button('Open folder',commands.folder),button('Quick open',commands.quickOpen),button('Find in folder',() => commands.folderSearch()));
  folderTools.append(element('div','No folder selected','folder-name')); folderTools.lastChild.id = 'folder-name';
  $('aside').insertBefore(folderTools,$('#documents'));
  const renderFolder=folderTree(folderTools,path=>run(async()=>adopt(await window.desktop.openPath(path))));
  commands.refreshFolder=async()=>{const result=await window.desktop.refreshFolder();if(result){folder=result;renderFolder(result);}};folderTools.append(button('Refresh folder',commands.refreshFolder));labels.refreshFolder='Refresh current folder tree';
  const searchPanel = element('section',null,'folder-search'); searchPanel.id = 'folder-search'; searchPanel.hidden = true;
  searchPanel.innerHTML = '<div class="search-controls"><textarea id="folder-query" rows="2" aria-label="Search folder" placeholder="Search text (multiple lines supported)"></textarea><input id="folder-include" aria-label="Include extensions" placeholder="Extensions: js,txt"><input id="folder-exclude" aria-label="Exclude names" value=".git,node_modules,dist,release"><label><input id="folder-case" type="checkbox">Case</label><label><input id="folder-regex" type="checkbox">Regex</label><button id="folder-start">Search</button><button id="folder-cancel">Cancel</button><button id="folder-hide" aria-label="Hide folder search">×</button></div><p id="folder-progress" role="status">Searches saved disk contents. Up to 1,000 matches. Disk files over 10 MiB, unreadable/invalidly encoded files and symlinks are skipped. Regex uses JavaScript syntax; use \\n for multiline matches.</p><div id="folder-results"></div>';
  $('.workspace').after(searchPanel);
  const scope=document.createElement('select');scope.id='search-scope';scope.setAttribute('aria-label','Search scope');for(const [value,label] of [['folder','Folder on disk'],['tabs','Open buffers'],['document','Current buffer'],['selection','Selection']])scope.add(new Option(label,value));$('.search-controls').prepend(scope);
  let bufferSearchSnapshots=new Map(),searchGeneration=0;
  const extra=document.createElement('div');extra.className='search-controls';extra.innerHTML='<label><input id="folder-word" type="checkbox">Whole words</label><label><input id="folder-dot" type="checkbox">Dot matches newline</label><label>Disk encoding <select id="search-encoding"><option value="">Unicode BOM / UTF-8</option><option value="windows1252">Windows-1252</option><option value="utf16le">UTF-16 LE</option><option value="utf16be">UTF-16 BE</option></select></label><button id="search-clear-history">Clear query history</button><label>Recent queries <select id="search-history" aria-label="Recent search queries"></select></label>';
  extra.querySelector('#search-encoding').replaceChildren(new Option('Unicode BOM / UTF-8',''),...Object.entries(encodingLabels).map(([value,label])=>new Option(label,value)));
  $('.search-controls').after(extra);$('#search-history').onchange=()=>{$('#folder-query').value=$('#search-history').value;$('#search-history').selectedIndex=-1;};$('#folder-query').title='The latest 20 queries are kept locally with settings. Clear query history removes them.';
  const history=()=>{const queries=Array.isArray(settings.recentSearch)?settings.recentSearch.filter(q=>typeof q==='string'&&q.length<=32768).slice(0,20):[];$('#search-history').replaceChildren(...queries.map(query=>new Option(query,query)));$('#search-history').selectedIndex=-1;return queries;};
  $('#search-clear-history').title='Clears both rolling recovery generations. Named workspace snapshots retain their historical settings.';
  $('#search-clear-history').onclick=()=>run(async()=>{settings.recentSearch=[];history();await ctx.snapshot();await ctx.snapshot();});
  commands.folderSearch = () => { searchPanel.hidden = false; history();$('#folder-query').focus(); };
  $('#folder-hide').onclick = () => { searchPanel.hidden = true; };
  $('#folder-start').onclick = () => run(async () => {
    const generation=++searchGeneration;await window.desktop.cancelSearch({before:generation});if(generation!==searchGeneration)return;$('#folder-results').replaceChildren();
    const query=$('#folder-query').value;if(!query)throw new Error('Enter a search term.');
    settings.recentSearch=[query,...history().filter(q=>q!==query)].slice(0,20);history();ctx.snapshot();
    const options={requestId:generation,query,include:$('#folder-include').value,exclude:$('#folder-exclude').value,caseSensitive:$('#folder-case').checked,regex:$('#folder-regex').checked,wholeWord:$('#folder-word').checked,dotAll:$('#folder-dot').checked,encoding:$('#search-encoding').value};
    bufferSearchSnapshots=new Map();
    if(scope.value==='folder') {if (!folder) throw new Error('Open a folder first.');$('#folder-progress').textContent = `Searching saved disk contents in ${folder.root}…`;await window.desktop.search(options);return;}
    const searchView=ctx.editorView();if(scope.value==='selection'&&searchView.state.selection.main.empty)throw new Error('Select text before searching the selection.');
    const selected=scope.value==='tabs'?docs:[ctx.active];
    const buffers=selected.map(doc=>{const selection=searchView.state.selection.main,from=scope.value==='selection'?selection.from:0,to=scope.value==='selection'?selection.to:doc.state.doc.length;bufferSearchSnapshots.set(doc.id,{doc,text:doc.state.doc});return {id:doc.id,name:doc.name,text:doc.state.doc.sliceString(from,to),from};});
    $('#folder-progress').textContent=`Searching ${scope.selectedOptions[0].textContent} including unsaved edits…`;await window.desktop.search({...options,buffers});
  });
  $('#folder-cancel').onclick = async () => { const generation=++searchGeneration;await window.desktop.cancelSearch({before:generation});if(generation===searchGeneration)$('#folder-progress').textContent = 'Cancelled. Results are incomplete.'; };
  window.desktop.onSearchResult(result => {
    if(result.requestId!==searchGeneration)return;
    if (result.type === 'scanning-file') return;
    if(result.type==='buffer-match'){const snapshot=bufferSearchSnapshots.get(result.bufferId);if(!snapshot)return;const line=snapshot.text.lineAt(result.from);$('#folder-results').append(button(`${snapshot.doc.name}:${line.number}:${result.from-line.from+1}  ${result.preview}`,()=>{if(!docs.includes(snapshot.doc)||snapshot.doc.state.doc!==snapshot.text)throw new Error('The buffer changed after this search. Search again.');activate(snapshot.doc);view.dispatch({selection:{anchor:result.from,head:result.to},scrollIntoView:true});}));return;}
    if (result.type === 'match') { const node = button(`${result.path}:${result.line}:${result.column}  ${result.preview}`,async () => { const data=await window.desktop.openPath(result.path,{encoding:result.encoding,hash:result.hash});if(!data)return;const existing=docs.find(doc=>doc.id===data.id);if(existing&&(existing.encoding!==result.encoding||ctx.dirty(existing)||existing.hash!==result.hash))throw new Error('The open buffer differs from the search snapshot. Search this buffer again.');adopt(data); const line = view.state.doc.line(Math.min(result.line,view.state.doc.lines)); view.dispatch({selection:{anchor:Math.min(line.to,line.from + result.column - 1)},scrollIntoView:true}); }); $('#folder-results').append(node); }
    else if (result.type === 'error') $('#folder-progress').textContent = `Search error: ${result.message}`;
    else $('#folder-progress').textContent = `${result.type === 'done' ? 'Finished' : 'Searching'}: ${result.count} matches, ${result.scanned} files/buffers searched, ${result.skipped} skipped.${result.capped ? ' Limit reached — results incomplete.' : ''} Scope: ${result.scope==='buffers'?'Open buffers (includes unsaved edits); max 32 MiB total':'saved disk files; max 10 MiB per file'}.`;
  });
  commands.resetLayout = () => { markdownVisible = false; preview.hidden = true; searchPanel.hidden = true; setPanes([]); closeDialog(); };
  const splitPanel = element('div',null,'split-panel'); splitPanel.hidden = true; $('.workspace').after(splitPanel);
  const panes = [];
  let paneArrangement='columns',paneHeight=35;
  function rememberPanes(){settings.paneLayout={documents:panes.map(pane=>pane.doc.id),views:panes.map(pane=>({selection:pane.view.state.selection.toJSON(),scroll:captureScroll(pane.view)})),arrangement:paneArrangement,height:paneHeight};}
  function restorePaneLayout(value){
    const valid=value&&Array.isArray(value.documents)&&value.documents.length<=3&&value.documents.every(id=>typeof id==='string')&&['columns','rows'].includes(value.arrangement)&&Number.isFinite(value.height)&&value.height>=20&&value.height<=60;
    setPanes(valid?value.documents:[],valid?value.arrangement:'columns',valid?value.height:35,valid&&Array.isArray(value.views)?value.views:[]);
  }
  ctx.captureLayout=async()=>{await Promise.all(panes.map(pane=>pane.restoring));rememberPanes();};
  let focusedEditor=view;
  window.addEventListener('focusin',event=>{if(view.dom.contains(event.target))focusedEditor=view;else{const pane=panes.find(pane=>pane.view.dom.contains(event.target));if(pane)focusedEditor=pane.view;}ctx.updateStatus();window.dispatchEvent(new Event('openpad-view'));});
  ctx.editorView=()=>panes.some(pane=>pane.view===focusedEditor&&pane.doc===ctx.active)?focusedEditor:view;

  function mirror(target,canonical,changes){
    const mapping=changes||documentChanges(target.state.doc,canonical.doc),scroll=target.scrollSnapshot().map(mapping),next=peerState(canonical,target.state,mapping);
    target.setState(next);if(scroll)target.update([next.update({effects:scroll,annotations:[paneSync.of(true),Transaction.addToHistory.of(false)]})]);
  }
  function syncPanes(detail) {
    for (const pane of panes) {
      if (!docs.includes(pane.doc)) {pane.doc = ctx.active;rememberPanes();}
      pane.select.replaceChildren(); docs.forEach(doc => pane.select.add(new Option(doc.name,doc.id))); pane.select.value = pane.doc.id;
      if(pane.shownDoc!==pane.doc){pane.view.setState(pane.doc.state);pane.shownDoc=pane.doc;}
      else if(pane.synced!==pane.doc.state||pane.view.contentDOM.getAttribute('aria-label')!==`Editor: ${pane.doc.name}`){if(pane.view.state!==pane.doc.state)mirror(pane.view,pane.doc.state,detail?.doc===pane.doc&&detail.update.startState.doc===pane.view.state.doc?detail.update.changes:undefined);}
      pane.synced=pane.doc.state;
    }
  }
  let syncing = false;
  // Rebuilding a peer search panel may focus it; retain the originating editor or input.
  function synchronize(event) { if (syncing) return;const detail=event?.detail; const focused=document.activeElement;syncing = true; try { if (ctx.active&&ctx.active.mainSynced!==ctx.active.state){if(view.state!==ctx.active.state)mirror(view,ctx.active.state,detail?.doc===ctx.active&&detail.update.startState.doc===view.state.doc?detail.update.changes:undefined);ctx.active.mainSynced=ctx.active.state;} syncPanes(detail);if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true}); } finally { syncing = false; } }
  function setPanes(ids,arrangement='columns',height=35,positions=[]){
    panes.forEach(pane=>pane.view.destroy());panes.splice(0);splitPanel.replaceChildren();splitPanel.hidden=!ids.length;focusedEditor=view;
    paneArrangement=arrangement;paneHeight=height;splitPanel.dataset.arrangement=arrangement;splitPanel.style.height=`${height}vh`;splitPanel.style.gridTemplateColumns=arrangement==='columns'?`repeat(${Math.max(1,ids.length)},minmax(0,1fr))`:'minmax(0,1fr)';splitPanel.style.gridTemplateRows=arrangement==='rows'?`repeat(${Math.max(1,ids.length)},minmax(0,1fr))`:'minmax(0,1fr)';
    for (let i = 0; i < ids.length; i++) {
      const container = element('section'); const select = document.createElement('select'); select.setAttribute('aria-label',`Pane ${i + 2} document`); container.append(select); splitPanel.append(container);
      const pane = { doc:docs.find(doc=>doc.id===ids[i])||ctx.active, select };
      pane.view = new EditorView({ parent:container, state:pane.doc.state.update({selection:restoredSelection(positions[i]?.selection,pane.doc.state.doc.length,pane.doc.state.selection),annotations:Transaction.addToHistory.of(false)}).state, dispatch:transaction => {
        syncing = true;
        try { pane.view.update([transaction]); pane.doc.state = pane.view.state; } finally { syncing = false; }
        synchronize({detail:{doc:pane.doc,update:{startState:transaction.startState,changes:transaction.changes}}});
      } });
      pane.shownDoc=pane.doc;pane.synced=pane.doc.state;
      pane.view.scrollDOM.addEventListener('scroll',()=>{window.dispatchEvent(new Event('openpad-view'));ctx.scheduleSnapshot();});pane.restoring=restoreScroll(pane.view,positions[i]?.scroll);
      container.addEventListener('focusin',event => { if (event.target !== select && ctx.active !== pane.doc) activate(pane.doc,false); });
      select.onchange = () => { pane.doc = docs.find(doc => doc.id === select.value); activate(pane.doc,false); synchronize();rememberPanes();ctx.snapshot(); };
      panes.push(pane);
    }
    synchronize();rememberPanes();ctx.snapshot();
  }
  commands.split=()=>setPanes(panes.length?[]:Array.from({length:3},(_,i)=>docs[(docs.indexOf(ctx.active)+i+1)%docs.length].id));
  commands.paneLayout=()=>{
    show('Pane layout','<label>Extra panes <select id="pane-count"><option value="0">None</option><option value="1">One</option><option value="2">Two</option><option value="3">Three</option></select></label><label>Extra-pane arrangement <select id="pane-arrangement"><option value="columns">Side by side</option><option value="rows">Stacked</option></select></label><label>Window height for extra panes (%) <input id="pane-height" type="number" min="20" max="60"></label><p>The main editor stays above these panes. Document assignments and this layout restore with the session or named workspace.</p>');
    $('#pane-count').value=panes.length;$('#pane-arrangement').value=paneArrangement;$('#pane-height').value=paneHeight;
    body.append(button('Apply pane layout',()=>{const count=+$('#pane-count').value,arrangement=$('#pane-arrangement').value,height=+$('#pane-height').value;if(!Number.isInteger(count)||count<0||count>3||!['columns','rows'].includes(arrangement)||!Number.isFinite(height)||height<20||height>60)throw new Error('Use zero to three extra panes and a height from 20 to 60 percent.');const ids=Array.from({length:count},(_,i)=>panes[i]?.doc.id||docs[(docs.indexOf(ctx.active)+i+1)%docs.length].id);const positions=panes.map(pane=>({selection:pane.view.state.selection.toJSON(),scroll:captureScroll(pane.view)}));setPanes(ids,arrangement,height,positions);closeDialog();}));
  };
  window.addEventListener('openpad-ready',()=>restorePaneLayout(settings.paneLayout));
  window.addEventListener('openpad-edit',synchronize); window.addEventListener('openpad-activate',synchronize); window.addEventListener('openpad-transaction',synchronize);
  Object.assign(labels,{paneLayout:'Pane layout: arrangement and session restoration',split:'Toggle four editor panes',saveWorkspace:'Save named workspace',loadWorkspace:'Open named workspace',shortcuts:'Keyboard shortcuts'});
  window.desktop.shortcuts().then(entries=>{for(const entry of entries || []) shortcuts[entry.id]=entry.accelerator;});
  $('#encoding').role = 'button'; $('#encoding').tabIndex = 0; $('#encoding').title = 'Change encoding and line endings'; $('#encoding').onclick = () => run(commands.encoding); $('#encoding').onkeydown = event => { if (event.key === 'Enter') run(commands.encoding); };
  const toolbar = $('.editor-toolbar>div'); toolbar.prepend(button('Compare',commands.compare),button('Preview',commands.markdown));
  installEditing(ctx,{show,body,button,closeDialog,listPicker,labels});
  installReplacement(ctx,{show,body,button,closeDialog,compareTexts,labels});
  installTransforms(ctx,{show,body,button,closeDialog,compareTexts,labels});
  installLanguageTools(ctx,{show,body,button,closeDialog,labels});
  installCustomLanguages(ctx,{show,body,button,closeDialog,labels});
  installUtilities(ctx,{show,body,button,closeDialog,labels});
  installVisibility(ctx,{show,body,button,closeDialog,labels});
  installMarks(ctx,{show,body,button,closeDialog,labels});
  installContext(ctx,{show,body,button,closeDialog,compareTexts,labels});
  installMcp(ctx,{show,body,button,closeDialog,labels});
  installTemplates(ctx,{show,body,button,closeDialog,labels});
  installExternalCommands(ctx,{show,body,button,closeDialog,listPicker,labels});
}
