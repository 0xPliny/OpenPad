function sessionReport(session){
  const cell=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
  const changes=session.events.filter(event=>event.type!=='issue');
  const rows=session.events.map(event=>'| '+[event.timestamp,event.type,event.path,event.byteDelta??'—',event.lineDelta??'—','unknown',event.message||event.rangeReason||''].map(cell).join(' | ')+' |');
  return [
    '# OpenPad observed session','',
    'Session: '+cell(session.sessionId),'',
    'Folder: '+cell(session.root),'',
    cell(session.startedAt)+' — '+cell(session.updatedAt),'',
    changes.length+' retained change observations. Byte delta: '+changes.reduce((sum,event)=>sum+event.byteDelta,0)+'. Line delta: '+changes.reduce((sum,event)=>sum+event.lineDelta,0)+'.','',
    'Filesystem events establish observed changes, not writer identity or approval. Intermediate writes may be coalesced or missed. This report includes retained metadata only; it is not a complete audit trail or token-cost report. Coverage issues: '+(session.status?.issues||0)+'; older events dropped: '+(session.status?.droppedEvents||0)+'.','',
    '| Time | Event | Path | Byte delta | Line delta | Writer | Note |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
    ...rows,''
  ].join('\n');
}
module.exports={sessionReport};
