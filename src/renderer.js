import {observationField,observationGutter} from './context-provenance.mjs';
import {paneSync,documentChanges,restoredSelection,scrollPosition,captureScroll,restoreScroll} from './pane-state.mjs';
import {changeHistory,initializeHistory,acceptSavedHistory,toggleHistory,historyGutter} from './change-history.mjs';
import {labels as encodingLabels} from './encodings.cjs';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, Transaction, Text } from '@codemirror/state';
import { EditorView, highlightWhitespace, highlightTrailingWhitespace } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import { languages } from '@codemirror/language-data';
import { LanguageDescription } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { undo, redo } from '@codemirror/commands';
import { installFeatures } from './features.js';
import { bookmarkExtension, bookmarks, setBookmarks } from './editing.js';
import { completionExtensions } from './language-model.mjs';
import { customLanguage } from './custom-language.mjs';
import { restoreLanguageSettings } from './language-settings.mjs';
import {visibilityExtensions} from './visibility.js';
import {marks,setMarks} from './marks.mjs';
import './style.css';

const $ = selector => document.querySelector(selector);
const docs = [];
const closedFiles = [];
let active;
let sequence = 1;
let busy = false;
const pendingCommands=[];
let externalOpenPending = false;
let ready = false;
let snapshotTimer;
let maxSnapshotTimer;
let recoveryError = '';
const settings = { theme: 'dark', fontSize: 14, fontFamily: 'Cascadia Code, Consolas, monospace', tabSize: 4, recovery: true, defaultWrap: false, collapsedGroups: [] };
const languageSelect = $('#language');
for (const language of languages) languageSelect.add(new Option(language.name, language.name));
function refreshLanguages(){languageSelect.querySelectorAll('[data-custom]').forEach(option=>option.remove());for(const name of Object.keys(settings.customLanguages||{})){const option=new Option(`Custom: ${name}`,`Custom: ${name}`);option.dataset.custom='true';languageSelect.add(option);}if(active)languageSelect.value=active.language;}
function showLanguageWarnings(warnings){if(!warnings.length)return;$('#dialog-title').textContent='Language settings recovery';const message=document.createElement('p');message.textContent=`Your buffers were retained. ${warnings.join(' ')}`;$('#dialog-body').replaceChildren(message);if(!$('#dialog').open)$('#dialog').showModal();}
function detectLanguage(name){const extension=name.includes('.')?name.split('.').at(-1).toLowerCase():'';const custom=Object.values(settings.customLanguages||{}).find(def=>def.extensions.some(ext=>ext.toLowerCase()===extension));return custom?{name:`Custom: ${custom.name}`}:LanguageDescription.matchFilename(languages,name);}
const theme = EditorView.theme({ '&': { height: '100%', fontSize: 'var(--editor-size)', backgroundColor: 'var(--editor-bg)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--editor-font)', lineHeight: '1.7' }, '.cm-content': { padding: '20px 0' }, '.cm-gutters': { backgroundColor: 'var(--editor-bg)', border: 'none' }, '.cm-lineNumbers .cm-gutterElement': { minWidth: '45px', paddingRight: '18px' } });
$('#tabs').setAttribute('role','tablist');$('#editor').setAttribute('role','tabpanel');
const view = new EditorView({ parent: $('#editor') });
let mainRestore=Promise.resolve(),mainRestoring=false;view.scrollDOM.addEventListener('scroll',scheduleSnapshot);
function metadata(doc) { return `${doc.encoding}|${doc.eol}|${doc.bom}`; }
function dirty(doc) { return !doc.readOnly && (doc.state.doc !== doc.savedDoc || metadata(doc) !== doc.savedMeta); }
function themeExtensions() { return settings.theme === 'light' || (settings.theme === 'system' && !matchMedia('(prefers-color-scheme: dark)').matches) ? [] : oneDark; }
function displayExtensions(){return [visibilityExtensions(settings),...(settings.changeHistory?[historyGutter]:[]),...(settings.whitespace?[highlightWhitespace(),highlightTrailingWhitespace()]:[])];}
function applySettings() {
  document.documentElement.dataset.theme = themeExtensions().length === 0 ? 'light' : 'dark';
  document.documentElement.style.setProperty('--editor-size', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--editor-font', settings.fontFamily);
  for (const doc of docs) {
    const effects = [doc.colors.reconfigure(themeExtensions()), doc.indenting.reconfigure(EditorState.tabSize.of(settings.tabSize)),doc.display.reconfigure(displayExtensions()),toggleHistory.of(!!settings.changeHistory)];
    if (doc === active) view.dispatch({ effects }); else doc.state = doc.state.update({ effects }).state;
  }
  scheduleSnapshot();window.dispatchEvent(new Event('openpad-edit'));
}
async function snapshot() {
  clearTimeout(snapshotTimer);
  clearTimeout(maxSnapshotTimer); maxSnapshotTimer = null;
  if (!ready) return true;
  await mainRestore;await featureContext.captureLayout?.();if(active)active.mainScroll=captureScroll(view);
  const state = { activeId: active?.id, sequence, settings, docs: settings.recovery ? docs.filter(doc => !doc.readOnly).map(doc => ({ id: doc.id, name: doc.name, text: doc.state.doc.toString(), saved: doc.saved, savedMeta: doc.savedMeta, encoding: doc.encoding, eol: doc.eol, bom: doc.bom, pinned: doc.pinned, group: doc.group, language: doc.language, wrap: doc.wrap, selection: doc.mainSelection.main.head,mainView:{selection:doc.mainSelection.toJSON(),scroll:doc.mainScroll}, large: doc.large, locked:!!doc.locked, bookmarks:doc.state.field(bookmarks),marks:doc.state.field(marks) })) : [] };
  const result = await window.desktop.snapshot(state);
  recoveryError = result ? '' : 'Recovery snapshot failed — save your files before exiting.';
  updateStatus(); return !!result;
}
function scheduleSnapshot() { if (!ready) return; clearTimeout(snapshotTimer); snapshotTimer = setTimeout(() => snapshot(), 700); if (!maxSnapshotTimer) maxSnapshotTimer = setTimeout(() => snapshot(), 5000); }
function makeDoc(data = {}) {
  const doc = { id: crypto.randomUUID(), name: `Untitled-${sequence++}`, saved: '', encoding: 'utf8', eol: 'LF', bom: false, wrap: settings.defaultWrap, language: '', pinned: false, group: '', ...data, lang: new Compartment(), wrapping: new Compartment(), colors: new Compartment(), indenting: new Compartment(), writable:new Compartment(), display:new Compartment() };
  doc.saved = data.saved ?? data.text ?? '';
  doc.savedMeta = data.savedMeta || metadata(doc);
  doc.state = EditorState.create({ doc: data.text || '', selection: { anchor: Math.min(data.selection || 0, (data.text || '').length) }, extensions: [EditorView.contentAttributes.of(()=>({'aria-label':`Editor: ${doc.name}`})),basicSetup,observationField,observationGutter,bookmarkExtension,marks,changeHistory,completionExtensions(doc,settings),doc.display.of(displayExtensions()), doc.colors.of(themeExtensions()), theme, doc.lang.of([]), doc.indenting.of(EditorState.tabSize.of(settings.tabSize)), doc.wrapping.of(doc.wrap && !doc.large ? EditorView.lineWrapping : []), doc.writable.of(EditorState.readOnly.of(!!doc.readOnly || !!doc.locked)), EditorView.editable.of(!doc.readOnly), EditorView.updateListener.of(update => {
    if(!update.transactions.length||update.transactions.every(tr=>tr.annotation(paneSync))){window.dispatchEvent(new Event('openpad-view'));return;}
    doc.state = update.state;
    if(update.view===view)doc.mainSelection=update.state.selection;else if(update.docChanged)doc.mainSelection=doc.mainSelection.map(update.changes);
    if (!active) return;
    if (update.docChanged) { if (update.state.doc.eq(doc.savedDoc)) doc.savedDoc = update.state.doc; renderTabs(); scheduleSnapshot(); }
    if (update.selectionSet) scheduleSnapshot();
    if(update.startState.field(bookmarks)!==update.state.field(bookmarks)||update.startState.field(marks)!==update.state.field(marks))scheduleSnapshot();
    window.dispatchEvent(new CustomEvent('openpad-transaction',{detail:{doc,update}}));
    if(update.docChanged)window.dispatchEvent(new Event('openpad-edit'));
    updateStatus();
  })] });
  if(data.bookmarks)doc.state=doc.state.update({effects:setBookmarks.of(data.bookmarks)}).state;
  if(data.marks)doc.state=doc.state.update({effects:setMarks.of(data.marks)}).state;
  doc.savedDoc = (data.text || '') === doc.saved ? doc.state.doc : EditorState.create({ doc: doc.saved }).doc;
  doc.state=doc.state.update({effects:initializeHistory.of({saved:doc.savedDoc,enabled:!!settings.changeHistory})}).state;
  doc.mainSelection=restoredSelection(data.mainView?.selection,doc.state.doc.length,doc.state.selection);doc.mainScroll=scrollPosition(data.mainView?.scroll);
  docs.push(doc); activate(doc);
  const detected = detectLanguage(doc.name);
  if (!doc.large && (doc.language || detected)) setLanguage(doc, doc.language || detected.name);
  return doc;
}
function showMain(doc){view.setState(doc.state.update({selection:doc.mainSelection,annotations:Transaction.addToHistory.of(false)}).state);doc.mainSynced=doc.state;mainRestoring=true;const pending=mainRestore=restoreScroll(view,doc.mainScroll);pending.then(()=>{if(mainRestore===pending)mainRestoring=false;});}
function activate(doc, focus = true) {
  if(active){active.mainSelection=view.state.selection;if(!mainRestoring)active.mainScroll=captureScroll(view);}
  active = doc; showMain(doc); languageSelect.value = doc.language;
  $('#filepath').textContent = doc.path || doc.previewPath || 'Unsaved document';
  $('#wrap').textContent = `Wrap: ${doc.wrap ? 'on' : 'off'}`;
  $('#wrap').setAttribute('aria-pressed', String(doc.wrap));
  renderTabs(); updateStatus(); if (focus) view.focus();
  scheduleSnapshot(); window.dispatchEvent(new Event('openpad-activate'));
  if (doc.path) window.desktop.diskState(doc.id).then(state => { if (active === doc) { doc.diskState = state; updateStatus(); } });
}
function renderTabs() {
  const focusedTab=document.activeElement?.closest('#tabs .tab')?.dataset.id,focusedClose=document.activeElement?.classList.contains('close');
  $('#tabs').replaceChildren(); $('#documents').replaceChildren();
  const pinnedTabs = document.createElement('div'); pinnedTabs.className = 'pinned-tabs';
  const regularTabs = document.createElement('div'); regularTabs.className = 'regular-tabs';
  $('#tabs').append(pinnedTabs,regularTabs);
  for (const doc of [...docs.filter(d => d.pinned), ...docs.filter(d => !d.pinned)]) {
    const tab = document.createElement('div'); tab.className = `tab ${doc === active ? 'active' : ''}`;
    tab.dataset.group=doc.group||'';tab.dataset.groupColor=doc.group?(['mint','blue','purple','amber','rose'].includes(settings.groupColors?.[doc.group])?settings.groupColors[doc.group]:'mint'):'';tab.title=doc.group?`Group: ${doc.group}`:'';
    tab.draggable=true;tab.dataset.id=doc.id;
    tab.ondragstart=event=>event.dataTransfer.setData('text/openpad-tab',doc.id);
    tab.ondragover=event=>{if(event.dataTransfer.types.includes('text/openpad-tab'))event.preventDefault();};
    tab.ondrop=event=>{event.preventDefault();const source=docs.find(d=>d.id===event.dataTransfer.getData('text/openpad-tab'));if(!source || source===doc)return;docs.splice(docs.indexOf(source),1);docs.splice(docs.indexOf(doc),0,source);source.pinned=doc.pinned;renderTabs();scheduleSnapshot();};
    tab.classList.toggle('pinned', !!doc.pinned);
    const button = document.createElement('button'); button.textContent = `${doc.pinned ? '◆ ' : ''}${dirty(doc) ? '● ' : ''}${doc.name}`; button.onclick = () => activate(doc); button.title = doc.path || doc.name;
    button.id=`tab-${doc.id}`;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(doc===active));button.setAttribute('aria-controls','editor');button.setAttribute('aria-label',`${doc.name}${dirty(doc)?', unsaved changes':''}${doc.pinned?', pinned':''}${doc.group?`, group ${doc.group}`:''}`);button.tabIndex=doc===active?0:-1;
    button.onkeydown=event=>{if(event.altKey||event.ctrlKey||event.metaKey)return;if(event.key==='Enter'||event.key===' '){event.preventDefault();view.focus();return;}const order=[...docs.filter(d=>d.pinned),...docs.filter(d=>!d.pinned)],index=order.indexOf(doc),next={ArrowLeft:(index+order.length-1)%order.length,ArrowRight:(index+1)%order.length,Home:0,End:order.length-1}[event.key];if(next===undefined)return;event.preventDefault();activate(order[next],false);document.getElementById(`tab-${order[next].id}`)?.focus();};
    const close = document.createElement('button'); close.textContent = '×'; close.className = 'close'; close.setAttribute('aria-label', `Close ${doc.name}`); close.onclick = () => run(() => closeDoc(doc));
    close.tabIndex=doc===active?0:-1;tab.setAttribute('role','presentation');
    tab.append(button, close); (doc.pinned ? pinnedTabs : regularTabs).append(tab);
    const item = document.createElement('button'); item.className = `document ${doc === active ? 'selected' : ''}`; item.textContent = `${doc.group ? `[${doc.group}] ` : ''}${dirty(doc) ? '●' : '≡'}  ${doc.name}`; item.title = doc.path || doc.name; item.onclick = () => activate(doc); $('#documents').append(item);
  }
  const grouped = new Map();
  [...$('#documents').children].forEach((item,index) => { const doc = [...docs.filter(d => d.pinned), ...docs.filter(d => !d.pinned)][index]; if (!doc.group) return; if (!grouped.has(doc.group)) { const section = document.createElement('details'); section.open = !settings.collapsedGroups.includes(doc.group) || doc === active; const summary = document.createElement('summary'); summary.textContent = doc.group; section.append(summary); section.ontoggle = () => { settings.collapsedGroups = settings.collapsedGroups.filter(name => name !== doc.group); if (!section.open) settings.collapsedGroups.push(doc.group); scheduleSnapshot(); }; grouped.set(doc.group,section); $('#documents').append(section); } grouped.get(doc.group).append(item); });
  if(focusedTab){const tabButton=document.getElementById(`tab-${focusedTab}`)||document.getElementById(`tab-${active.id}`);(focusedClose?tabButton?.parentElement.querySelector('.close'):tabButton)?.focus();}
  $('#editor').setAttribute('aria-labelledby',`tab-${active.id}`);
  document.title = `${dirty(active) ? '● ' : ''}${active.name} — OpenPad`;
}
function updateStatus() {
  if (!active) return;
  const target=featureContext.editorView();const head = target.state.selection.main.head;
  const line = target.state.doc.lineAt(head);
  $('#position').textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
  $('#encoding').textContent = `${encodingLabels[active.encoding]||active.encoding}${active.bom ? ' BOM' : ''} · ${active.eol}`;
  $('#count').textContent = `${view.state.doc.length.toLocaleString()} characters`;
  $('#status').textContent = recoveryError || (active.diskState && active.diskState !== 'unchanged' ? `Disk file ${active.diskState} — Reload or Save As` : active.previewInfo || `${active.locked?'Read-only buffer · ':''}${dirty(active) ? '● Unsaved changes' : '✓ All changes saved'}`);
}
async function setLanguage(doc, name) {
  if(name && (name.startsWith('Custom: ')?!settings.customLanguages?.[name.slice(8)]:!languages.some(language=>language.name===name)))name='';
  doc.language = name;
  const support = name.startsWith('Custom: ')?customLanguage(settings.customLanguages?.[name.slice(8)]):name ? await languages.find(language => language.name === name).load() : [];
  if (doc.language !== name) return;
  const effects = doc.lang.reconfigure(support);
  if (active === doc) { languageSelect.value = name; view.dispatch({ effects }); }
  else doc.state = doc.state.update({ effects }).state;
}
async function save(doc, saveAs = false) {
  if (doc.state.readOnly) throw new Error('This document is read-only. Toggle read-only off, stop monitoring, or open the full file to save it.');
  const invoking=active===doc?featureContext.editorView():null;
  const savedDocument = doc.state.doc;
  const savedMetadata = metadata(doc);
  const text = savedDocument.toString();
  const result = await window.desktop.save({ id: doc.id, text, saveAs, encoding: doc.encoding, eol: doc.eol, bom: doc.bom });
  if (!result) return false;
  Object.assign(doc, result, { saved: text });
  const historyEffect=acceptSavedHistory.of(savedDocument);if(active===doc)view.dispatch({effects:historyEffect});else doc.state=doc.state.update({effects:historyEffect}).state;
  doc.savedDoc = savedDocument; doc.savedMeta = savedMetadata; doc.diskState = 'unchanged';
  const detected = detectLanguage(doc.name);
  if (detected && !doc.large) await setLanguage(doc, detected.name);
  if (active === doc) {activate(doc,false);if(invoking?.dom.isConnected)invoking.focus();} else renderTabs();
  return !dirty(doc);
}
async function closeDoc(doc, quitting = false) {
  if (dirty(doc)) {
    const choice = await window.desktop.confirmClose(doc.name);
    if (choice === 2 || (choice === 0 && !await save(doc))) return false;
  }
  await window.desktop.forget(doc.id);
  if(doc.path && !quitting){closedFiles.push(doc.path);if(closedFiles.length>20)closedFiles.shift();}
  const index = docs.indexOf(doc); docs.splice(index, 1);
  if (docs.length) activate(docs[Math.min(index, docs.length - 1)]);
  else if (!quitting) makeDoc();
  scheduleSnapshot();
  return true;
}
async function run(action) {
  if (busy) return;
  busy = true;
  try { await action(); }
  catch (error) { $('#status').textContent = error.message; }
  finally { busy = false; if (externalOpenPending) drainExternalFiles(); drainCommands(); }
}
function dispatchCommand(name){
  if(!commands[name])return;
  if(pendingCommands.length>=100){$('#status').textContent='Too many pending commands. Wait for the current operation to finish.';return;}
  // File operations can update the visible tab before their final snapshot finishes.
  pendingCommands.push(name);drainCommands();
}
function drainCommands(){if(!ready||busy||!pendingCommands.length)return;run(commands[pendingCommands.shift()]);}
function drainExternalFiles() {
  if (!ready || busy) return;
  externalOpenPending = false;
  run(async () => {
    for (const data of await window.desktop.takeOpenFiles() || []) {
      const existing = docs.find(doc => doc.id === data.id);
      const doc=existing || makeDoc(data);activate(doc);
      if(data.launch?.readOnly){doc.locked=true;view.dispatch({effects:doc.writable.reconfigure(EditorState.readOnly.of(true))});}
      if(data.launch?.line || data.launch?.column){const line=view.state.doc.line(Math.min(data.launch.line || 1,view.state.doc.lines));view.dispatch({selection:{anchor:Math.min(line.to,line.from+(data.launch.column || 1)-1)},scrollIntoView:true});}
    }
  });
}
const commands = {
  undo: () => undo(featureContext.editorView()), redo: () => redo(featureContext.editorView()),
  new: () => makeDoc(),
  open: async () => { for (const data of await window.desktop.open() || []) { const existing = docs.find(doc => doc.id === data.id); if (existing) activate(existing); else makeDoc(data); } },
  save: () => save(active), saveAs: () => save(active, true),
  close: () => closeDoc(active),
  reopenClosed: async()=>{const file=closedFiles.at(-1);if(!file)throw new Error('No saved file has been closed in this session.');const data=await window.desktop.openPath(file);if(data){closedFiles.pop();const existing=docs.find(d=>d.id===data.id);if(existing)activate(existing);else makeDoc(data);}},
  closeGroup:async()=>{const group=active.group;if(!group)throw new Error('Assign a named group first.');for(const doc of docs.filter(doc=>doc.group===group))if(!await closeDoc(doc))break;},
  pinGroup:()=>{const group=active.group;if(!group)throw new Error('Assign a named group first.');const members=docs.filter(doc=>doc.group===group),pinned=!members.every(doc=>doc.pinned);for(const doc of members)doc.pinned=pinned;renderTabs();scheduleSnapshot();},
  saveGroup:async()=>{const group=active.group;if(!group)throw new Error('Assign a named group first.');for(const doc of docs.filter(doc=>doc.group===group&&dirty(doc)))if(!await save(doc))break;},
  closeAll: async()=>{for(const doc of [...docs])if(!await closeDoc(doc))break;},
  closeOthers: async()=>{const keep=active;for(const doc of docs.filter(d=>d!==keep&&!d.pinned))if(!await closeDoc(doc))break;if(docs.includes(keep))activate(keep);},
  tabLeft:()=>moveTab(-1),tabRight:()=>moveTab(1),
  readOnly:()=>{if(active.readOnly || active.monitoring)throw new Error('Stop monitoring or open the full file before changing its read-only state.');active.locked=!active.locked;view.dispatch({effects:active.writable.reconfigure(EditorState.readOnly.of(active.locked))});scheduleSnapshot();},
  find: () => { openSearchPanel(featureContext.editorView()); },
  wrap: () => { active.wrap = !active.wrap; view.dispatch({ effects: active.wrapping.reconfigure(active.wrap ? EditorView.lineWrapping : []) }); activate(active); },
  quit: async () => { if (settings.recovery) { if (!await snapshot()) return; } else { for (const doc of [...docs]) if (!await closeDoc(doc, true)) return; if (!await snapshot()) return; } await window.desktop.quit(); }
};
function moveTab(direction){const peers=docs.filter(d=>d.pinned===active.pinned),peer=peers[peers.indexOf(active)+direction];if(!peer)return;const index=docs.indexOf(active),next=docs.indexOf(peer);docs.splice(index,1);docs.splice(next,0,active);renderTabs();scheduleSnapshot();}
function reloadBuffer(doc,data){
  const changes=documentChanges(doc.state.doc,Text.of(data.text.split('\n')));
  const change=doc.state.update({changes,...(data.preview?{effects:[setMarks.of([]),setBookmarks.of([])],annotations:Transaction.addToHistory.of(false)}:{})});doc.mainSelection=doc.mainSelection.map(change.changes);let next=change.state;
  next=next.update({effects:initializeHistory.of({saved:next.doc,enabled:!!settings.changeHistory})}).state;
  Object.assign(doc,data,{state:next,saved:data.text,savedDoc:next.doc,diskState:'unchanged'});doc.savedMeta=metadata(doc);
  renderTabs();scheduleSnapshot();window.dispatchEvent(new CustomEvent('openpad-edit',{detail:{doc,update:{startState:change.startState,changes:change.changes}}}));updateStatus();
}
const featureContext={ $, docs, get active() { return active; }, view, commands, run, makeDoc, activate, save, dirty, settings, applySettings, snapshot, renderTabs, setLanguage,reloadBuffer,refreshLanguages,showLanguageWarnings,updateStatus,scheduleSnapshot };
installFeatures(featureContext);
document.querySelectorAll('[data-command]').forEach(button => button.onclick = () => dispatchCommand(button.dataset.command));
languageSelect.onchange = () => run(() => setLanguage(active, languageSelect.value));
window.desktop.onCommand(name => {
  if (name === 'open-external') { externalOpenPending = true; drainExternalFiles(); }
  else dispatchCommand(name);
});
window.desktop.bootstrap().then(data => {
  const restored=restoreLanguageSettings(data?.settings);
  Object.assign(settings, data?.settings || {},restored.settings); sequence = data?.sequence || 1;
  refreshLanguages();
  applySettings();
  for (const doc of data?.docs || []) makeDoc(doc);
  if (!docs.length) makeDoc(); else activate(docs.find(doc => doc.id === data.activeId) || docs[0]);
  ready = true;window.dispatchEvent(new Event('openpad-ready')); document.body.dataset.ready = 'true';
  drainExternalFiles();
  drainCommands();
  if (data?.recoveryWarning) { recoveryError = data.recoveryWarning; updateStatus(); }
  showLanguageWarnings(restored.warnings);
});
