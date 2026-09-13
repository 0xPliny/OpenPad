export function installMcp(ctx,ui){
  const {$,commands}=ctx,{show,body,button,labels}=ui,requests=new Map();
  const node=(tag,text)=>{const item=document.createElement(tag);item.textContent=text;return item;};
  const status=node('span','');status.id='mcp-agent-status';$('.context-watch-bar').append(status);
  window.desktop.onMcpCancel(({id})=>{const pending=requests.get(id);if(pending)pending.cancelled=true;});
  window.desktop.onMcpRequest(async message=>{
    const ticket={cancelled:false};requests.set(message.id,ticket);let ran=false,result,error;
    await ctx.run(async()=>{
      ran=true;
      try{
        const check=()=>{if(ticket.cancelled)throw new Error('CANCELLED');};check();
        if(message.operation==='set_status'){const text=message.data.message;if(typeof text!=='string'||text.length>200)throw new Error('EDITOR_UNAVAILABLE');status.textContent='Agent: '+text.replace(/[\x00-\x1f\x7f]/g,' ');result={updated:true};return;}
        if($('#dialog').open)throw new Error('EDITOR_BUSY');
        const data=message.data.document;let doc=ctx.docs.find(doc=>doc.id===data?.id);
        if(!doc){if(message.operation!=='open_file'||typeof data?.text!=='string'||typeof data.path!=='string')throw new Error('DOCUMENT_UNAVAILABLE');}
        const original=doc?.state.doc,text=original?original.toString():data.text;
        if(!text.isWellFormed()||text.length>1024*1024)throw new Error('DOCUMENT_UNAVAILABLE');
        const bytes=new TextEncoder().encode(text);if(bytes.length>1024*1024)throw new Error('DOCUMENT_UNAVAILABLE');
        const textHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
        check();if(doc&&(!ctx.docs.includes(doc)||doc.state.doc!==original))throw new Error('DOCUMENT_CHANGED');
        if(message.operation==='open_file'){
          if(doc)ctx.activate(doc);else doc=ctx.makeDoc(data);
          result={opened:true,documentId:data.id,basis:'open-buffer',textHash,lines:text.split('\n').length};
        }else if(message.operation==='reveal_range'){
          if(message.data.expectedTextHash&&message.data.expectedTextHash!==textHash)throw new Error('DOCUMENT_CHANGED');
          const {fromLine,toLine}=message.data;
          if(!Number.isSafeInteger(fromLine)||!Number.isSafeInteger(toLine)||fromLine<1||toLine<fromLine||toLine>original.lines)throw new Error('OUT_OF_RANGE');
          ctx.activate(doc);const view=ctx.editorView();view.dispatch({selection:{anchor:original.line(fromLine).from,head:original.line(toLine).to},scrollIntoView:true});view.focus();
          result={revealed:true,documentId:data.id,basis:'open-buffer',textHash,fromLine,toLine};
        }else throw new Error('EDITOR_UNAVAILABLE');
      }catch(failure){error=['EDITOR_BUSY','DOCUMENT_CHANGED','OUT_OF_RANGE','CANCELLED','DOCUMENT_UNAVAILABLE'].includes(failure.message)?failure.message:'EDITOR_UNAVAILABLE';}
    });
    if(!ran)error='EDITOR_BUSY';requests.delete(message.id);window.desktop.mcpReply({id:message.id,...(error?{error}:{result})});
  });
  const draw=value=>{const summary=$('#mcp-summary');if(summary)summary.textContent=value.running?`Enabled at ${value.url} · ${value.active} active requests · ${value.logSuppressed} log records suppressed`:'Disabled. No MCP endpoint is listening.';const log=$('#mcp-log');if(log){log.replaceChildren();for(const entry of value.logs||[])log.append(node('p',`${entry.sequence} · ${entry.operation} · ${entry.outcome} · ${entry.durationMs} ms`));}if(!value.running)status.textContent='';};
  window.desktop.onMcpState(draw);
  commands.mcp=async()=>{
    show('Local MCP access','<p>Opt-in access to the active watched folder. Tools can count, lint, inspect observation metadata, open files, select lines and show agent status. They cannot save files or make review decisions. Stop or change the watch to revoke access.</p><p>Native clients only: 127.0.0.1 with a bearer token; browser origins are rejected. Tokens exist only in memory and rotate when re-enabled. Cancellation uses disconnect, timeout or disabling; legacy cancellation notifications are unsupported.</p><p id="mcp-summary" role="status"></p><label>Endpoint <input id="mcp-url" readonly></label><label>New bearer token (shown only when enabled here) <input id="mcp-token" type="password" readonly autocomplete="off"></label><div id="mcp-actions"></div><p>Recent redacted invocation metadata is kept in memory, bounded and potentially incomplete; it is not a durable audit log. No arguments, file contents or tokens are logged.</p><div id="mcp-log"></div>');
    const actions=$('#mcp-actions'),urlInput=$('#mcp-url'),tokenInput=$('#mcp-token');
    actions.append(button('Enable / rotate token',async()=>{const result=await window.desktop.mcpStart();if(!result)return;if(!actions.isConnected){await window.desktop.mcpStop();return;}urlInput.value=result.url;tokenInput.value=result.token;draw(result);}),button('Disable MCP',async()=>{await window.desktop.mcpStop();tokenInput.value='';urlInput.value='';const value=await window.desktop.mcpState();if(actions.isConnected)draw(value);}),button('Copy new token',async()=>{const token=tokenInput.value;if(!token)throw new Error('Enable or rotate the token first.');await window.desktop.copyText(token);}),button('Refresh activity',async()=>{const value=await window.desktop.mcpState();if(actions.isConnected)draw(value);}));
    const current=await window.desktop.mcpState();if(current&&actions.isConnected){draw(current);urlInput.value=current.url||'';}
  };
  labels.mcp='Opt-in local MCP access and activity';
}
