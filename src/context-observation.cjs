const path=require('node:path');
const {createHash}=require('node:crypto');
function within(root,file){const relative=path.relative(root,file);return relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
function latestRecorded(sessions,file){
  for(let i=sessions.length-1;i>=0;i--){const session=sessions[i];
    for(let j=session.events.length-1;j>=0;j--){const event=session.events[j],target=path.resolve(session.root,event.path),relative=path.relative(target,file);
      // A later directory/read failure must invalidate earlier matching-hash evidence too.
      if(relative===''||(event.type==='issue'&&within(target,file)))return event;
    }
  }
  return null;
}
function matchesText(event,text){return !!event?.ranges&&event.afterTextHash===createHash('sha256').update(text,'utf8').digest('hex');}
module.exports={within,latestRecorded,matchesText};
