import {listTemplates,createTemplate} from './context-templates.cjs';

export function installTemplates(ctx,ui){
  const {show,body,button,closeDialog,labels}=ui;
  const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};
  ctx.commands.contextTemplates=()=>{
    show('Context-file starters');
    body.append(node('p','These are editable examples, not official schemas or required sections. Creation opens a new unsaved tab. Choose a destination later with Save As.'));
    const chooser=node('select');chooser.id='template-choice';
    for(const entry of listTemplates())chooser.append(new Option(`${entry.filename} — ${entry.title}`,entry.id));
    const name=node('input');name.id='template-name';name.maxLength=80;name.placeholder='Optional heading; lowercase slug for SKILL.md';
    const description=node('input');description.id='template-description';description.maxLength=500;description.placeholder='Optional description';
    const preview=node('textarea');preview.id='template-preview';preview.readOnly=true;preview.rows=18;preview.spellcheck=false;
    const status=node('p');status.id='template-status';status.setAttribute('role','status');
    const field=(title,input)=>{const label=node('label',title+' ');label.append(input);body.append(label);};
    field('Template',chooser);field('Name',name);field('Description',description);field('Preview',preview);body.append(status);
    let result=null,created=false;
    function refresh(){
      try{
        result=createTemplate(chooser.value,{...(name.value?{name:name.value}:{}),...(description.value?{description:description.value}:{})});
        preview.value=result.text;status.textContent=`New unsaved tab: ${result.filename}. ${result.note}`;create.disabled=false;
      }catch(error){result=null;preview.value='';status.textContent=error.message;create.disabled=true;}
    }
    const create=button('Create unsaved tab',()=>{
      if(created||!chooser.isConnected||!body.closest('dialog')?.open)return;refresh();if(!result)return;
      created=true;create.disabled=true;const value=result;closeDialog();
      ctx.makeDoc({name:value.filename,text:value.text,saved:'',language:'Markdown'});
    });
    create.id='template-create';body.append(create);
    chooser.onchange=()=>{name.value='';description.value='';refresh();};name.oninput=refresh;description.oninput=refresh;
    refresh();chooser.focus();
  };
  labels.contextTemplates='Create context file from an editable starter';
}
