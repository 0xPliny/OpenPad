const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const { replaceFile } = require('./replace-file.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const {encodings,boms}=require('./encodings.cjs');
function decode(bytes, requested) {
  let encoding = requested || 'utf8';
  let bom = false;
  let skip = 0;
  if (!encodings.includes(encoding)) throw new Error('Unsupported encoding');
  for(const [kind,prefix] of Object.entries(boms))if(bytes.subarray(0,prefix.length).equals(Buffer.from(prefix))){
    if(requested&&requested!==kind)throw new Error(`The byte order mark declares ${kind}; choose that encoding or remove the BOM explicitly outside OpenPad.`);
    encoding=kind;bom=true;skip=prefix.length;break;
  }
  const payload = bytes.subarray(skip);
  if(encoding==='utf32le'||encoding==='utf32be'){
    if(payload.length%4)throw new Error('Invalid UTF-32 length; bytes cannot round-trip.');
    for(let offset=0;offset<payload.length;offset+=4){const scalar=encoding==='utf32le'?payload.readUInt32LE(offset):payload.readUInt32BE(offset);if(scalar>0x10ffff||(scalar>=0xd800&&scalar<=0xdfff))throw new Error('Invalid Unicode scalar in UTF-32 file.');}
  }
  const unicode={utf8:'utf-8',utf16le:'utf-16le',utf16be:'utf-16be'};
  const text=unicode[encoding]?new TextDecoder(unicode[encoding],{fatal:true,ignoreBOM:true}).decode(payload):iconv.decode(payload,encoding,{stripBOM:false});
  if(!iconv.encode(text,encoding).equals(payload))throw new Error(`These bytes cannot round-trip as ${encoding}. Choose another encoding; no file was changed.`);
  if (text.includes('\0')) throw new Error('Binary files are not supported.');
  const endings = text.match(/\r\n|\r|\n/g) || [];
  const types = new Set(endings);
  return { text: text.replace(/\r\n|\r/g, '\n'), encoding, bom, eol: types.size > 1 ? 'Mixed' : types.has('\r\n') ? 'CRLF' : types.has('\r') ? 'CR' : 'LF', originalEndings: types.size > 1 ? endings : null, hash: hash(bytes) };
}
function encode(text, meta) {
  const encoding = meta.encoding || 'utf8';
  if (!encodings.includes(encoding)) throw new Error('Unsupported encoding');
  if (!['LF','CRLF','CR','Mixed'].includes(meta.eol)) throw new Error('Unsupported line endings');
  let index = 0;
  const content = text.replace(/\r\n|\r/g, '\n').replace(/\n/g, () => meta.eol === 'Mixed' ? (meta.originalEndings?.[index++] || '\n') : { LF: '\n', CRLF: '\r\n', CR: '\r' }[meta.eol]);
  if(!content.isWellFormed())throw new Error('The text contains an unpaired Unicode surrogate; no file was changed.');
  if (meta.eol === 'Mixed' && index !== meta.originalEndings?.length) throw new Error('Line count changed in a mixed-ending file. Choose LF or CRLF explicitly before saving.');
  const bytes = iconv.encode(content, encoding);
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== content) throw new Error(`Some characters cannot be represented as ${encoding}. Choose UTF-8 or UTF-16.`);
  if(meta.bom&&!boms[encoding])throw new Error('This encoding does not support a byte order mark.');
  const prefix=meta.bom?boms[encoding]:[];
  return Buffer.concat([Buffer.from(prefix), bytes]);
}
async function writeDocument(path, text, meta, expectedHash) {
  const check = async () => { if (expectedHash) {
    const current = await fs.readFile(path);
    if (hash(current) !== expectedHash) throw new Error('The file changed on disk. Use Save As to keep your edits in another file.');
  } };
  const bytes = encode(text, meta);
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, bytes, { flag: 'wx' });
    await replaceFile(temp, path, check);
  } finally { await fs.unlink(temp).catch(() => {}); }
  return hash(bytes);
}
module.exports = { decode, encode, writeDocument, hash, encodings };
