const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {parseLaunch}=require('../src/cli.cjs');
test('launch parser handles line/column, read-only, multiple paths and literal dash filenames',()=>{
  const cwd=process.cwd();
  assert.deepEqual(parseLaunch(['--line=3','--column','5','--readonly','a file.txt','世界.txt'],cwd),['a file.txt','世界.txt'].map(file=>({path:path.resolve(cwd,file),line:3,column:5,readOnly:true})));
  assert.deepEqual(parseLaunch(['-n8','-c2','-ro','--','-literal.txt'],cwd),[{path:path.resolve(cwd,'-literal.txt'),line:8,column:2,readOnly:true}]);
  assert.deepEqual(parseLaunch(['--inspect=0','a.txt'],cwd),[{path:path.resolve(cwd,'a.txt')}]);
  assert.deepEqual(parseLaunch(['--encoding=Shift-JIS','a.txt'],cwd),[{path:path.resolve(cwd,'a.txt'),encoding:'shiftjis'}]);assert.throws(()=>parseLaunch(['--encoding=nope','a.txt'],cwd),/encoding/);
  for(const args of [['--line','0','a.txt'],['--column=-1','a.txt'],['--line'],['--line=2=3','a.txt']])assert.throws(()=>parseLaunch(args,cwd),/positive integer/);
});
