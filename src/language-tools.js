import {startCompletion} from '@codemirror/autocomplete';
import {syntaxTree} from '@codemirror/language';
import {outline,validateAPI} from './language-model.mjs';
export function installLanguageTools(ctx,ui){
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,labels}=ui;
  const panel=document.createElement('section');panel.className='outline-panel';panel.hidden=true;
  const heading=document.createElement('strong');heading.textContent='Symbols';const filter=document.createElement('input');filter.placeholder='Filter symbols';filter.setAttribute('aria-label','Filter symbols');
  const status=document.createElement('p');status.setAttribute('role','status');const list=document.createElement('div');list.id='outline-symbols';panel.append(heading,filter,status,list);$('aside').insertBefore(panel,$('#documents'));
  let timer;
  function draw(){
    if(panel.hidden)return;
    const doc=ctx.active,result=outline(doc.state,doc.language);list.replaceChildren();
    status.textContent=result.unsupported?'Outline supports JavaScript/TypeScript, Python, C/C++, Java, Rust and Go.':`${result.symbols.length} symbols${result.complete?'':' — partial parse or 2,000-symbol limit'}`;
    for(const symbol of result.symbols.filter(s=>`${s.name} ${s.kind}`.toLowerCase().includes(filter.value.toLowerCase()))){const node=button(`${symbol.name} · ${symbol.kind} · ${symbol.line}`,()=>{if(ctx.active!==doc)return;const latest=outline(doc.state,doc.language).symbols.find(s=>s.from===symbol.from&&s.name===symbol.name);if(!latest){draw();return;}const view=ctx.editorView();view.dispatch({selection:{anchor:latest.from},scrollIntoView:true});view.focus();});list.append(node);}
  }
  const schedule=()=>{if(!panel.hidden&&!timer)timer=setTimeout(()=>{timer=null;draw();},180);};
  window.addEventListener('openpad-transaction',event=>{const {doc,update}=event.detail;if(doc===ctx.active && (update.docChanged || syntaxTree(update.startState)!==syntaxTree(update.state)))schedule();});window.addEventListener('openpad-activate',schedule);filter.oninput=draw;
  commands.outline=()=>{panel.hidden=!panel.hidden;draw();};
  commands.complete=()=>startCompletion(ctx.editorView());
  commands.apiSettings=()=>{
    show('Word completion and API definitions','<label><input id="word-completion" type="checkbox">Suggest words from the buffer</label><p>API definitions add completions and hover signatures. Use a JSON array of {"label":"greet","detail":"greet(name)","info":"Description","apply":"greet()"}. Apply is optional literal inserted text. No code is executed.</p><label>Language <select id="api-language"><option value="*">All languages</option></select></label><textarea id="api-definitions" rows="12" aria-label="API definitions" spellcheck="false"></textarea>');
    for(const option of $('#language').options)if(option.value)$('#api-language').add(new Option(option.textContent,option.value));
    $('#api-language').value=ctx.active.language || '*';$('#word-completion').checked=settings.wordCompletion!==false;
    const drawAPI=()=>{$('#api-definitions').value=JSON.stringify(settings.apiEntries?.[$('#api-language').value] || [],null,2);};$('#api-language').onchange=drawAPI;drawAPI();
    body.append(button('Save completion settings',async()=>{const text=$('#api-definitions').value;if(text.length>1024*1024)throw new Error('API definitions exceed 1 MiB.');const entries=validateAPI(JSON.parse(text));settings.apiEntries={...settings.apiEntries,[$('#api-language').value]:entries};settings.wordCompletion=$('#word-completion').checked;await ctx.snapshot();closeDialog();}));
  };
  Object.assign(labels,{outline:'Toggle function and class outline',complete:'Show completions',apiSettings:'Word completion and API definitions'});
}
