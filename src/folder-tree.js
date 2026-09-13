export function folderTree(parent,open){
  const section=document.createElement('section');section.className='folder-tree';section.hidden=true;const filter=document.createElement('input');filter.placeholder='Filter folder files';filter.setAttribute('aria-label','Filter folder files');const tree=document.createElement('div');section.append(filter,tree);parent.append(section);let folder=null;
  function render(){
    tree.replaceChildren();if(!folder)return;const prefix=folder.root.replaceAll('\\','/').replace(/\/$/,'')+'/',query=filter.value.toLocaleLowerCase(),root={dirs:new Map(),files:[]};
    for(const path of folder.files){const relative=path.replaceAll('\\','/').slice(prefix.length);if(!relative.toLocaleLowerCase().includes(query))continue;const parts=relative.split('/');let node=root;for(const name of parts.slice(0,-1)){if(!node.dirs.has(name))node.dirs.set(name,{dirs:new Map(),files:[]});node=node.dirs.get(name);}node.files.push({name:parts.at(-1),path});}
    function draw(node,target){for(const [name,child] of [...node.dirs].sort(([a],[b])=>a.localeCompare(b))){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=name;details.append(summary);let loaded=false;details.addEventListener('toggle',()=>{if(details.open&&!loaded){loaded=true;draw(child,details);}});target.append(details);}for(const file of node.files.sort((a,b)=>a.name.localeCompare(b.name))){const button=document.createElement('button');button.textContent=file.name;button.title=file.path;button.onclick=()=>open(file.path);target.append(button);}}
    draw(root,tree);if(!tree.children.length)tree.textContent='No matching files.';
  }
  filter.oninput=render;
  return result=>{folder=result;section.hidden=!result;filter.value='';render();};
}
