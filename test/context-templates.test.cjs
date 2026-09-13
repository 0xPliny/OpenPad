const test=require('node:test'),assert=require('node:assert/strict');
const {listTemplates,createTemplate}=require('../src/context-templates.cjs');
test('catalog contains exactly the seven requested starter filenames and returns independent metadata',()=>{
  const catalog=listTemplates();assert.deepEqual(catalog.map(item=>item.filename),['AGENTS.md','CLAUDE.md','MEMORY.md','SKILL.md','CONTEXT.md','FILES.md','.cursorrules']);assert.equal(new Set(catalog.map(item=>item.id)).size,7);
  catalog[0].title='changed';assert.notEqual(listTemplates()[0].title,'changed');
  for(const item of listTemplates()){const result=createTemplate(item.id);assert.equal(result.filename,item.filename);assert.match(result.text,/not an official schema/);assert.match(result.text,/^# |\n# /);assert.equal(result.text.includes('author:'),false);assert.equal(/\d{4}-\d\d-\d\d/.test(result.text),false);assert.equal(/[A-Z]:\\|\/home\/|\/path\//.test(result.text),false);}
});
test('skill frontmatter preserves validated name and safely quoted single-line description',()=>{
  const description='Use for "quoted" input: keep # and backslashes \\ literal.';
  const result=createTemplate('skill',{name:'review-context',description}),lines=result.text.split('\n');assert.equal(lines[0],'---');assert.equal(JSON.parse(lines[1].slice(6)),'review-context');assert.equal(JSON.parse(lines[2].slice(13)),description);assert.equal(lines[3],'---');assert.match(result.text,/# review-context/);
  assert.equal(createTemplate('skill').filename,'SKILL.md');assert.match(createTemplate('skill').text,/name: "my-skill"/);
});
test('invalid IDs, names, multiline metadata and oversized metadata reject without changing the catalog',()=>{
  for(const id of ['unknown','../AGENTS.md',null])assert.throws(()=>createTemplate(id),/Unknown/);
  for(const name of ['', ' leading','two\nlines','# injected','a'.repeat(81)])assert.throws(()=>createTemplate('agents',{name}),/Name/);
  for(const name of ['Uppercase','two words','-leading','trailing-','a'.repeat(65)])assert.throws(()=>createTemplate('skill',{name}),/[Nn]ame/);
  for(const description of ['', ' ', 'first\nsecond','a'.repeat(501),'\ud800'])assert.throws(()=>createTemplate('skill',{description}),/Description/);
  assert.equal(listTemplates().length,7);
});
test('creation returns text and a fixed suggested filename without writing or choosing a destination',()=>{
  const options={name:'Team notes',description:'Adapt these notes to the current project.'};const first=createTemplate('agents',options),second=createTemplate('agents',options);
  assert.deepEqual(first,second);assert.deepEqual(Object.keys(first),['templateId','filename','text','note']);assert.equal(first.filename,'AGENTS.md');assert.match(first.text,/^# Team notes/);assert.equal(options.name,'Team notes');
});
