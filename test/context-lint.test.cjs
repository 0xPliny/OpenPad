const test=require('node:test'),assert=require('node:assert/strict');
const {lintContext}=require('../src/context-lint.cjs');
test('recognized names do not impose invented requirements or default budgets',()=>{
  for(const name of ['AGENTS.md','cLaUdE.Md','MEMORY.md','SKILL.md','CONTEXT.md','FILES.md','.cursorrules']){const result=lintContext({text:'Useful instructions.',name:'folder/'+name});assert.equal(result.recognized,true);assert.deepEqual(result.findings,[]);}
  const result=lintContext({text:'2020-01-01\n'.repeat(600),name:'notes.md'});assert.equal(result.recognized,false);assert.equal(result.findings.some(f=>['old-date-reference','line-budget','token-budget'].includes(f.code)),false);
  assert.equal(Object.keys(require.cache).some(file=>file.includes('gpt-tokenizer')),false);
});
test('explicit budgets use supplied counts and exact UTF16 selections',()=>{
  const result=lintContext({text:'😀 TODO\r\ntext',name:'AGENTS.md',lineBudget:1,tokenCount:20,tokenBudget:10});
  assert.equal(result.lines,2);assert.deepEqual(result.findings.map(f=>f.code),['line-budget','token-budget','placeholder']);const finding=result.findings.at(-1);assert.equal(finding.from,3);assert.equal(finding.to,7);assert.equal(finding.line,1);
  assert.equal(lintContext({text:'x',tokenBudget:0}).findings.some(f=>f.code==='token-budget'),false);
});
test('empty ATX/setext sections skip fenced/frontmatter headings and preserve useful parent or code-only sections',()=>{
  const text='---\n# ignored\n---\n# Parent\n## Child\nContent\n# Empty\n\nSetext\n======\n\n# Code\n```md\n# fake\n```\n';
  const result=lintContext({text,name:'CLAUDE.md'});assert.deepEqual(result.findings.filter(f=>f.code==='empty-section').map(f=>f.line),[7,9]);
});
test('repeated prose is exact within paragraphs and excludes fenced, indented and inline-only code',()=>{
  const text='Repeat this prose.\n\nRepeat this prose.\n\nRepeat  this prose.\n\n```\nRepeat this prose.\n```\n\n    Repeat this prose.\n\n`Repeat this prose.`\n\n`Repeat this prose.`';
  const matches=lintContext({text}).findings.filter(f=>f.code==='repeated-paragraph');assert.equal(matches.length,1);assert.equal(matches[0].line,3);assert.equal(matches[0].firstLine,1);
});
test('placeholders and explicit old dates skip code/frontmatter and dates are heuristic with a configured age',()=>{
  const text='---\nTODO: 2020-01-01\n---\n`TODO 2020-01-01`\n\n    FIXME 2020-01-01\n\n```\nTODO 2020-01-01\n```\nTODO 2020-01-01 and 2025-02-30 and 2099-01-01';
  const result=lintContext({text,today:'2026-09-12',dateAgeDays:365});assert.deepEqual(result.findings.map(f=>f.code),['placeholder','old-date-reference']);assert.equal(result.findings[1].line,11);assert.equal(result.findings[1].confidence,'heuristic');
  assert.equal(lintContext({text:'2020-01-01',today:'2026-09-12'}).findings.length,0);
  assert.throws(()=>lintContext({text:'x',dateAgeDays:365}),/Provide today/);assert.throws(()=>lintContext({text:'x',today:'2025-02-30'}),/valid ISO/);
});
test('stable finding IDs, bounded result count and Unicode validation',()=>{
  const input={text:'TODO\n'.repeat(1200),name:'AGENTS.md'},a=lintContext(input),b=lintContext(input);assert.equal(a.findings.length,1000);assert.equal(a.truncated,true);assert.deepEqual(a.findings.map(f=>f.id),b.findings.map(f=>f.id));assert.equal(new Set(a.findings.map(f=>f.id)).size,1000);
  assert.throws(()=>lintContext({text:'x'.repeat(1024*1024+1)}),/1 MiB/);assert.throws(()=>lintContext({text:'\ud800'}),/Unicode/);assert.throws(()=>lintContext({text:'x',lineBudget:-1}),/nonnegative/);
});
test('an unmatched inline delimiter cannot hide placeholders in a later paragraph',()=>{
  const result=lintContext({text:'Unmatched ` delimiter\n\nTODO review this\n\nAnother ` delimiter'});assert.equal(result.findings.filter(f=>f.code==='placeholder').length,1);
});

test('indented prose continuations and list content are not mistaken for code blocks',()=>{
  for(const text of ['Instructions:\n    TODO finish','- first instruction\n    TODO finish'])assert.equal(lintContext({text}).findings.filter(f=>f.code==='placeholder').length,1);
  assert.equal(lintContext({text:'Paragraph.\n\n    TODO actual code'}).findings.filter(f=>f.code==='placeholder').length,0);
});
