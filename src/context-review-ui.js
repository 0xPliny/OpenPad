export function installReview(ctx,ui){
  const {$,commands}=ctx,{show,body,button,compareTexts,labels}=ui;
  const node=(tag,text)=>{const result=document.createElement(tag);result.textContent=text;return result;};
  let generation=0;
  for(const event of ['close','cancel','openpad-dialog-replace'])$('#dialog').addEventListener(event,()=>generation++);
  async function detail(key){
    const request=generation,record=await window.desktop.contextReviewGet(key);if(request!==generation||!record)return;
    show('Review observed change','<p>This change already happened on disk. Acknowledging it does not approve a write, restore a file or identify its author. Current disk state is not checked.</p><div id="review-summary"></div><div id="review-diff"></div><div id="review-actions"></div>');
    const summary=$('#review-summary');
    summary.append(node('h3',record.event.path),node('p',`${record.root} · ${record.event.timestamp} · ${record.event.type} · writer unknown`),node('p',`Session ${record.event.sessionId} · decision: ${record.decision.value} · revision ${record.decision.revision}`));
    for(const [name,side] of [['Before',record.before],['After',record.after]])summary.append(node('p',`${name}: ${side.state}${side.reason?' — '+side.reason:''}`));
    if(record.before.state!=='unavailable'&&record.after.state!=='unavailable')compareTexts(record.before.text||'',record.after.text||'',$('#review-diff'));
    else{
      $('#review-diff').append(node('p','A complete comparison is unavailable. Missing text is not an empty baseline.'));
      for(const [name,side] of [['Before',record.before],['After',record.after]])if(side.state==='present')$('#review-diff').append(node('h4',name),node('pre',side.text));
    }
    for(const [label,decision] of [['Acknowledge observation','acknowledged'],['Needs attention','needs-attention'],['Mark unreviewed','unreviewed']])$('#review-actions').append(button(label,async()=>{
      const current=generation,result=await window.desktop.contextReviewDecide({key,expectedRevision:record.decision.revision,decision});if(current!==generation||!result)return;await detail(key);
    }));
    $('#review-actions').append(button('Back to review queue',commands.contextReview));
  }
  commands.contextReview=async()=>{
    const request=generation,result=await window.desktop.contextReviewList();if(request!==generation||!result)return;
    show('Observed review queue','<p>Read-only snapshots of changes captured while review retention was enabled in Agent Watch. Decisions concern individual historical observations, not the current disk state. Snapshot contents are retained locally across restart, separately from metadata-only activity history.</p>');
    if(result.warning)body.append(node('p',result.warning));
    body.append(node('p',`${result.records.length} retained observations · ${result.evicted} evicted by limits. New observations require an active watch with snapshot retention enabled.`));
    for(const record of [...result.records].reverse())body.append(button(`${record.event.path} · ${record.event.type} · ${record.decision.value} · ${record.event.timestamp}`,()=>detail(record.key)));
  };
  labels.contextReview='Review observed changes and saved decisions';
}
