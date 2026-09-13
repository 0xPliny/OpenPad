import {validateLanguage} from './custom-language.mjs';
const example={name:'Example DSL',extensions:['dsl'],keywords:['BEGIN','END','PRINT'],types:['Number','Text'],caseSensitive:false,lineComment:'#',blockComment:['/*','*/'],strings:['"',"'"],fold:['BEGIN','END']};
export function installCustomLanguages(ctx,ui){
  const {$,commands,settings}=ctx,{show,body,button,closeDialog,labels}=ui;
  commands.customLanguages=()=>{
    show('Custom languages','<p>Literal keyword, comment, string and folding rules. This is OpenPad JSON, not the Notepad++ UDL XML format. Folding is bounded to 1 MiB and strings end at the end of each line.</p><label>Definition <select id="custom-language-list"><option value="">New language</option></select></label><textarea id="custom-language-json" rows="16" aria-label="Custom language JSON" spellcheck="false"></textarea>');
    const select=$('#custom-language-list'),input=$('#custom-language-json');
    for(const name of Object.keys(settings.customLanguages||{}))select.add(new Option(name,name));
    input.value=JSON.stringify(example,null,2);select.onchange=()=>{input.value=JSON.stringify(settings.customLanguages?.[select.value] || example,null,2);};
    const read=()=>{if(input.value.length>1024*1024)throw new Error('Language definition exceeds 1 MiB.');return validateLanguage(JSON.parse(input.value));};
    body.append(button('Save and use language',async()=>{const definition=read();settings.customLanguages={...settings.customLanguages,[definition.name]:definition};ctx.refreshLanguages();for(const doc of ctx.docs.filter(d=>d.language===`Custom: ${definition.name}`))await ctx.setLanguage(doc,doc.language);await ctx.setLanguage(ctx.active,`Custom: ${definition.name}`);await ctx.snapshot();closeDialog();}),button('Import JSON',async()=>{const value=await window.desktop.importDefinition();if(value){const definition=validateLanguage(value);input.value=JSON.stringify(definition,null,2);select.value='';}}),button('Export JSON',async()=>{await window.desktop.exportDefinition(read());}),button('Delete selected language',async()=>{const name=select.value;if(!name)throw new Error('Select a saved custom language first.');if(ctx.docs.some(doc=>doc.language===`Custom: ${name}`))throw new Error('Choose another language in every tab using this definition before deleting it.');delete settings.customLanguages[name];ctx.refreshLanguages();await ctx.snapshot();closeDialog();}));
  };
  labels.customLanguages='Create, import and export custom languages';
}
