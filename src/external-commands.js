export function installExternalCommands(ctx,ui){
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,listPicker,labels}=ui;
  const panel=document.createElement('section');panel.className='command-output';panel.hidden=true;
  const heading=document.createElement('strong'),status=document.createElement('p'),output=document.createElement('pre'),stop=document.createElement('button'),hide=document.createElement('button');
  status.setAttribute('role','status');status.id='command-status';output.id='command-output-text';stop.textContent='Stop command';hide.textContent='Hide output';stop.disabled=true;panel.append(heading,stop,hide,status,output);$('.workspace').after(panel);
  let job=null,starting=false;const pending=[];
  hide.onclick=()=>panel.hidden=true;stop.onclick=()=>window.desktop.stopCommand(job);
  function result(message){if(message.id!==job){if(job===null&&starting)pending.push(message);return;}if(message.type==='output')output.append(document.createTextNode(message.text));else{status.textContent=message.error?`Failed: ${message.error}`:message.reason || `Exited with code ${message.code}.`;stop.disabled=true;job=null;}}
  window.desktop.onCommandResult(result);
  const start=async definition=>{if(job)throw new Error('Stop the running command first.');const doc=ctx.active,source=ctx.editorView().state,selection=source.sliceDoc(source.selection.main.from,source.selection.main.to);if(definition.saveBefore && !await ctx.save(doc))return;panel.hidden=false;heading.textContent=definition.name;status.textContent='Starting…';output.replaceChildren();pending.splice(0);starting=true;let started;try{started=await window.desktop.runCommand({definition,id:doc.id,name:doc.name,selection});}finally{starting=false;}if(!started){status.textContent='Command did not start.';return;}job=started.id;heading.textContent=`${started.name} — ${started.executable}`;status.textContent=`Running in ${started.cwd}`;stop.disabled=false;for(const message of pending.splice(0))result(message);};
  commands.runCommand=()=>{const definitions=Array.isArray(settings.externalCommands)?settings.externalCommands:[];if(!definitions.length)return commands.commandSettings();listPicker('Run saved command',definitions.map(definition=>({label:definition.name,action:()=>start(definition)})));};
  commands.commandOutput=()=>panel.hidden=!panel.hidden;
  commands.stopCommand=()=>window.desktop.stopCommand(job);
  commands.commandSettings=()=>{
    show('External commands','<p>Configure local programs you want to run. Arguments are separate strings, with no implicit shell. Supported substitutions: ${file}, ${dir}, ${name}, ${selection}. Set cwd to file, workspace or inherit. Save-before-run uses the current buffer. Output is capped at 1 MiB; timeout is in seconds. Windows Stop also terminates descendants.</p><textarea id="external-command-json" rows="15" aria-label="External command definitions" spellcheck="false"></textarea>');
    $('#external-command-json').value=JSON.stringify(settings.externalCommands || [{name:'Example',executable:'node',args:['--version'],cwd:'inherit',timeout:60,saveBefore:false}],null,2);
    body.append(button('Save commands',async()=>{const text=$('#external-command-json').value;if(text.length>1024*1024)throw new Error('Command definitions exceed 1 MiB.');const definitions=await window.desktop.validateCommands(JSON.parse(text));if(definitions){settings.externalCommands=definitions;await ctx.snapshot();closeDialog();}}));
  };
  Object.assign(labels,{runCommand:'Run saved external command',stopCommand:'Stop external command',commandSettings:'Configure external commands',commandOutput:'Show command output'});
}
