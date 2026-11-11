const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
test('archive includes runtime files and screenshots while excluding developer and private files',()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-package-'));
 try{
  fs.cpSync(root,temp,{recursive:true,filter:src=>!['.git','dist','node_modules'].includes(path.basename(src))});
  fs.writeFileSync(path.join(temp,'private-sentinel.txt'),'DO NOT PACKAGE');
  cp.execFileSync(process.execPath,['scripts/package.mjs'],{cwd:temp,stdio:'pipe'});
  const manifest=JSON.parse(fs.readFileSync(path.join(temp,'ghost.json')));
  const archive=path.join(temp,'dist',`${manifest.id}-${manifest.version}.cindy`);
  const entries=cp.execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n');
  assert.ok(entries.includes('ghost.json'));
  assert.ok(entries.every(x=>!x.startsWith('/')&&!x.includes('..')));
  for(const name of ['private-sentinel.txt','package.json','AGENTS.md','tests/test.cjs','.github/workflows/verify.yml'])assert.ok(!entries.includes(name));
  for(const name of ['task-board','cross-repository','dark-mode']){
   const file=`docs/screenshots/${name}.png`;
   assert.deepEqual(cp.execFileSync('unzip',['-p',archive,file]),fs.readFileSync(path.join(temp,file)));
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
