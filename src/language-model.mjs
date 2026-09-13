import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {EditorState} from '@codemirror/state';
import {hoverTooltip} from '@codemirror/view';
import {completeAnyWord} from '@codemirror/autocomplete';

const definitions={
  FunctionDeclaration:['function',['VariableDefinition','Definition']],ClassDeclaration:['class',['VariableDefinition','Definition']],MethodDeclaration:['method',['PropertyDefinition','Definition']],
  FunctionDefinition:['function',['VariableName','FunctionDeclarator']],ClassDefinition:['class',['VariableName']],ClassSpecifier:['class',['TypeIdentifier']],StructSpecifier:['struct',['TypeIdentifier']],
  FunctionItem:['function',['BoundIdentifier']],StructItem:['struct',['TypeIdentifier']],EnumItem:['enum',['TypeIdentifier']],TraitItem:['trait',['TypeIdentifier']],
  FunctionDecl:['function',['DefName']],MethodDecl:['method',['FieldName']],TypeSpec:['type',['DefName']]
};
export const outlineLanguages=new Set(['JavaScript','JSX','TypeScript','TSX','Python','C','C++','Java','Rust','Go']);
export function outline(state,language){
  if(!outlineLanguages.has(language))return {symbols:[],unsupported:true,complete:false};
  const parsed=ensureSyntaxTree(state,state.doc.length,40),tree=parsed || syntaxTree(state),symbols=[];
  tree.iterate({enter(node){
    if(symbols.length>=2000)return false;
    const rule=definitions[node.name];if(!rule)return;
    let name;
    for(const type of rule[1]){name=node.node.getChild(type);if(name)break;}
    if(name?.name==='FunctionDeclarator')name=name.getChild('Identifier') || name.getChild('FieldIdentifier') || name.getChild('QualifiedIdentifier');
    if(name)symbols.push({name:state.doc.sliceString(name.from,name.to),kind:rule[0],from:name.from,line:state.doc.lineAt(name.from).number});
  }});
  return {symbols,unsupported:false,complete:!!parsed&&symbols.length<2000};
}
export function validateAPI(value){
  if(!Array.isArray(value)||value.length>1000)throw new Error('API definitions must be a JSON array with at most 1,000 entries.');
  const seen=new Set();
  return value.map(entry=>{
    if(!entry || typeof entry.label!=='string' || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(entry.label) || entry.label.length>200)throw new Error('Each API entry needs an identifier label.');
    if(seen.has(entry.label))throw new Error(`Duplicate API label: ${entry.label}`);seen.add(entry.label);
    for(const key of ['detail','info','apply'])if(entry[key]!==undefined && (typeof entry[key]!=='string' || entry[key].length>10000))throw new Error(`Invalid ${key} for ${entry.label}`);
    return {label:entry.label,type:'function',...(entry.detail?{detail:entry.detail}:{}),...(entry.info?{info:entry.info}:{}),...(entry.apply!==undefined?{apply:entry.apply}:{})};
  });
}
function entriesFor(doc,settings){return [...(settings.apiEntries?.['*'] || []),...(settings.apiEntries?.[doc.language] || [])];}
export function apiCompletion(context,entries){
  if(context.state.readOnly)return null;
  const word=context.matchBefore(/[\p{L}\p{N}_$]+/u);if(!word&&!context.explicit)return null;
  return {from:word?.from??context.pos,options:entries,validFor:/^[\p{L}\p{N}_$]*$/u};
}
export function completionExtensions(doc,settings){
  const apiSource=context=>apiCompletion(context,entriesFor(doc,settings));
  const wordSource=context=>settings.wordCompletion===false || context.state.readOnly?null:completeAnyWord(context);
  // Completion sources need stable identities across state queries or active completion requests restart indefinitely.
  return [EditorState.languageData.of(()=>[{autocomplete:apiSource},{autocomplete:wordSource}]),hoverTooltip((view,pos)=>{
    const line=view.state.doc.lineAt(pos),offset=pos-line.from,left=line.text.slice(0,offset).match(/[\p{L}\p{N}_$]*$/u)?.[0] || '',right=line.text.slice(offset).match(/^[\p{L}\p{N}_$]*/u)?.[0] || '',word=left+right;
    const entry=entriesFor(doc,settings).find(entry=>entry.label===word);if(!entry)return null;
    return {pos:pos-left.length,end:pos+right.length,above:true,create(){const dom=document.createElement('pre');dom.className='api-tip';dom.textContent=[entry.detail || entry.label,entry.info].filter(Boolean).join('\n');return {dom};}};
  })];
}
