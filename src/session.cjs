const fs = require('node:fs/promises');
const path = require('node:path');
const { hash } = require('./files.cjs');
const { replaceFile } = require('./replace-file.cjs');
const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const optional=(value,check)=>value===undefined||check(value),string=value=>typeof value==='string',boolean=value=>typeof value==='boolean';
function validData(data){
  if(!record(data)||data.version!==1||!Array.isArray(data.docs)||!optional(data.name,string)||!optional(data.activeId,string)||!optional(data.sequence,value=>Number.isSafeInteger(value)&&value>0))return false;
  const ids=new Set();
  for(const doc of data.docs){
    if(!record(doc)||!string(doc.text))return false;
    if(!['id','name','path','saved','savedMeta','encoding','eol','language','group','hash'].every(key=>optional(doc[key],string)))return false;
    // Restored IDs bind Save to disk records, so aliases cannot safely represent distinct buffers.
    if(doc.id!==undefined){if(!doc.id||ids.has(doc.id))return false;ids.add(doc.id);}else if(doc.path)return false;
    if(!['bom','pinned','wrap','large','locked','readOnly'].every(key=>optional(doc[key],boolean)))return false;
    if(!optional(doc.selection,value=>Number.isSafeInteger(value)&&value>=0))return false;
    if(!optional(doc.bookmarks,value=>Array.isArray(value)&&value.every(position=>Number.isSafeInteger(position)&&position>=0&&position<=doc.text.length)))return false;
    if(!optional(doc.originalEndings,value=>value===null||(Array.isArray(value)&&value.every(ending=>['\n','\r','\r\n'].includes(ending)))))return false;
  }
  if(data.settings===undefined)return true;
  const settings=data.settings;if(!record(settings))return false;
  if(!['theme','fontFamily'].every(key=>optional(settings[key],string)))return false;
  if(!['recovery','defaultWrap','whitespace','wordCompletion','changeHistory','documentMap','eolGlyphs','indentGuides'].every(key=>optional(settings[key],boolean)))return false;
  if(!optional(settings.tabSize,value=>Number.isInteger(value)&&value>=1&&value<=8)||!optional(settings.fontSize,value=>Number.isFinite(value)&&value>=10&&value<=32))return false;
  if(!optional(settings.collapsedGroups,value=>Array.isArray(value)&&value.every(string)))return false;
  if(!['macros','shortcuts','groupColors'].every(key=>optional(settings[key],record)))return false;
  if(!['recentSearch','externalCommands'].every(key=>optional(settings[key],Array.isArray)))return false;
  // Custom language/API definitions have a renderer sanitizer that retains buffers and reports skipped definitions.
  return true;
}
function parseSnapshot(raw){const envelope=JSON.parse(raw);if(typeof envelope?.payload!=='string'||hash(Buffer.from(envelope.payload))!==envelope.hash)return null;const data=JSON.parse(envelope.payload);return validData(data)?data:null;}
async function writeSynced(file,content){const handle=await fs.open(file,'w');try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}}
class SessionStore {
  constructor(directory) { this.file = path.join(directory, 'session.json'); this.queue = Promise.resolve(); }
  async load() {
    this.warning='';
    for (const file of [this.file, `${this.file}.bak`]) {
      try {
        const data=parseSnapshot(await fs.readFile(file,'utf8'));
        if(data)return data;
        this.warning = 'Recovery checksum or structure failed validation; attempting the previous snapshot.';
      } catch (error) { if (error.code !== 'ENOENT') this.warning = 'A recovery snapshot was unreadable; attempting the previous snapshot.'; }
    }
    return { version: 1, docs: [], settings: {} };
  }
  save(data) {
    if(!validData({...data,version:1}))return Promise.reject(new Error('Invalid recovery snapshot.'));
    const payload = JSON.stringify({ ...data, version: 1 });
    const content = JSON.stringify({ payload, hash: hash(Buffer.from(payload)) });
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`,backupTemp=`${this.file}.bak.tmp`;
      try {
        await writeSynced(temp,content);
        let previous;
        try{const raw=await fs.readFile(this.file,'utf8');if(parseSnapshot(raw))previous=raw;}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
        // Backup promotion must be atomic too, and a checksum alone cannot establish a recoverable generation.
        if(previous){await writeSynced(backupTemp,previous);await replaceFile(backupTemp,`${this.file}.bak`);}
        await replaceFile(temp,this.file);
        return true;
      }finally{await Promise.all([temp,backupTemp].map(file=>fs.unlink(file).catch(()=>{})));}
    });
    return this.queue;
  }
}
module.exports = { SessionStore };
