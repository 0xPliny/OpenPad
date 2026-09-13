const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const algorithms={'SHA-256':'sha256','SHA-512':'sha512','MD5':'md5'};
const maxBytes=32*1024*1024;
function textMd5(text){if(typeof text!=='string'||text.length>maxBytes)throw new Error('Text checksum exceeds 32 MiB of text.');return createHash('md5').update(text,'utf8').digest('hex');}
async function fileChecksums(file){
  const handle=await fs.open(file,'r');
  try{
    const before=await handle.stat();if(!before.isFile()||before.size>maxBytes)throw new Error('File checksums support regular files up to 32 MiB.');
    const hashes=Object.fromEntries(Object.entries(algorithms).map(([label,algorithm])=>[label,createHash(algorithm)]));let bytes=0;
    if(before.size){for await(const chunk of handle.createReadStream({start:0,end:before.size-1,autoClose:false})){bytes+=chunk.length;for(const hash of Object.values(hashes))hash.update(chunk);}}
    const after=await handle.stat(),current=await fs.stat(file);
    if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||current.size!==before.size||current.mtimeMs!==before.mtimeMs)throw new Error('File changed while calculating checksums; try again.');
    return {path:file,bytes,values:Object.fromEntries(Object.entries(hashes).map(([label,hash])=>[label,hash.digest('hex')]))};
  }finally{await handle.close();}
}
module.exports={textMd5,fileChecksums};
