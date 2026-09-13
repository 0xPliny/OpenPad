const fs=require('node:fs/promises');
const pageBytes=256*1024;
const continuation=byte=>byte>=0x80&&byte<=0xbf;
function sequenceStart(bytes,position){
  if(!continuation(bytes[position]))return position;
  let from=position;while(from>0&&position-from<3&&continuation(bytes[from]))from--;
  const lead=bytes[from],width=lead>=0xc2&&lead<=0xdf?2:lead>=0xe0&&lead<=0xef?3:lead>=0xf0&&lead<=0xf4?4:1;
  if(width===1||from+width>bytes.length||position>=from+width)return position;
  for(let i=from+1;i<from+width;i++)if(!continuation(bytes[i]))return position;
  const second=bytes[from+1];if(lead===0xe0&&second<0xa0||lead===0xed&&second>=0xa0||lead===0xf0&&second<0x90||lead===0xf4&&second>=0x90)return position;
  return from;
}
const versionOf=stat=>Object.fromEntries(['size','mtimeMs','ctimeMs','ino','dev'].map(key=>[key,stat[key]]));
const sameVersion=(a,b)=>['size','mtimeMs','ctimeMs','ino','dev'].every(key=>a?.[key]===b?.[key]);
async function readPage(file,offset=0,limit=pageBytes,expected){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<4||limit>pageBytes)throw new Error('Choose a nonnegative byte offset and a valid page size.');
  const handle=await fs.open(file,'r');
  try{
    const before=await handle.stat();if(!before.isFile()||!Number.isSafeInteger(before.size))throw new Error('Choose a regular file with a supported byte size.');
    if(expected&&!sameVersion(versionOf(before),expected))throw new Error('Search results are stale; search the changed file again.');
    const requested=Math.min(offset,Math.max(0,before.size-1)),readFrom=Math.max(0,requested-3),buffer=Buffer.alloc(Math.min(limit+6,before.size-readFrom));let count=0;
    while(count<buffer.length){const read=await handle.read(buffer,count,buffer.length-count,readFrom+count);if(!read.bytesRead)break;count+=read.bytesRead;}
    const bytes=buffer.subarray(0,count),start=sequenceStart(bytes,requested-readFrom);let end=Math.min(bytes.length,start+limit);if(end<bytes.length){end=sequenceStart(bytes,end);if(bytes[end-1]===13&&bytes[end]===10)end--;}
    const after=await handle.stat(),current=await fs.stat(file);if(count!==buffer.length||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||current.ino!==before.ino||current.dev!==before.dev||current.size!==before.size||current.mtimeMs!==before.mtimeMs)throw new Error('File changed while reading the page; try again.');
    const from=readFrom+start,to=readFrom+end;
    return {text:new TextDecoder('utf-8',{ignoreBOM:from!==0}).decode(bytes.subarray(start,end)),offset:from,end:to,size:before.size,version:versionOf(before),nextOffset:to<before.size?to:null,previousOffset:from?Math.max(0,from-limit):null};
  }finally{await handle.close();}
}
module.exports={readPage,pageBytes,versionOf,sameVersion};
