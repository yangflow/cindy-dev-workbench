const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {harness}=require('./support.cjs');
test('editor title uses the associated requirement reference and keeps every worktree',async()=>{
 const h=harness();await h.call('session/add',{session:'main-a'});const s=await h.call('state/read');s.repos=[{id:'r',name:'fixture',path:'/fixture/repo'}];const m=s.sessions[0];m.label='REQ-42 fixture requirement';m.associations=[{repoId:'r',branch:'feature-a',worktree:'/fixture/a'},{repoId:'r',branch:'feature-b',worktree:'/fixture/b'}];
 const seeded=harness({'state-a.json':JSON.stringify(s)},{worker:async r=>r.params});const result=await seeded.call('session/open-editor',{session:m.id});assert.equal(result.title,'REQ-42');assert.equal(result.links.length,2);assert.deepEqual(result.links.map(l=>l.worktree),['/fixture/a','/fixture/b']);
});
test('card links resolve only existing unambiguous sources and preserve PR/MR links',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ui.js'),'utf8');const helpers=source.slice(source.indexOf('function entrySession('),source.indexOf('function taskCard('));
 const context={state:{sessions:[{id:'s',associations:[{repoId:'r',branch:'a',reviews:['https://example.invalid/mr/1']},{repoId:'r',branch:'b',snapshot:{reviews:{items:[{id:2,url:'https://example.invalid/mr/2'}]}}}]}],items:[{id:'i',ref:'REQ-42',url:'https://example.invalid/issues/42'}],repos:[{id:'r',name:'repo'}]},node:(tag,text,cls)=>({tag,text,cls,children:[],append(...children){this.children.push(...children);}}),link:(url,label)=>({url,label})};vm.createContext(context);vm.runInContext(helpers,context);
 assert.equal(vm.runInContext("entrySource({title:'REQ-42 fixture',sessionId:'s'}).url",context),'https://example.invalid/issues/42');
 const links=vm.runInContext("cardReviews({sessionId:'s'})",context);assert.equal(links.children.length,3);
 assert.equal(vm.runInContext("entrySource({title:'unrelated'})",context),null);
 context.state.items.push({id:'j',ref:'REQ-42',url:'https://other.invalid/42'});assert.equal(vm.runInContext("entrySource({title:'REQ-42 fixture',sessionId:'s'})",context),null);
});
test('review-style workspace uses sorted folders, empty settings and a stable named file',()=>{
 const editor=require('../node/editor-workspace.cjs');const dirs=['/fixture/z-tree','/fixture/a-tree'];const key='fixture-'+require('node:crypto').randomUUID();
 const first=editor.create(dirs,'REQ-42',key);try{const second=editor.create(dirs.slice().reverse(),'REQ-42',key);assert.equal(second,first);assert.equal(path.basename(first),'REQ-42.code-workspace');const data=JSON.parse(fs.readFileSync(first,'utf8'));assert.deepEqual(data,{folders:[{name:'a-tree',path:'/fixture/a-tree'},{name:'z-tree',path:'/fixture/z-tree'}],settings:{}});}finally{fs.rmSync(path.dirname(first),{recursive:true,force:true});}
});
test('external links use the host-supported same-page navigation and reject unsafe URLs',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ui.js'),'utf8');const fn=source.slice(source.indexOf('function link('),source.indexOf('function renderPrevious('));const context={URL,node:(tag,text)=>({tag,text})};vm.createContext(context);vm.runInContext(fn,context);
 const a=vm.runInContext("link('https://example.invalid/task/42','REQ-42')",context);assert.equal(a.href,'https://example.invalid/task/42');assert.equal(a.target,undefined);
 for(const url of ['javascript:alert(1)','http://example.invalid','https://user:secret@example.invalid','https://']){context.badUrl=url;assert.equal(vm.runInContext('link(badUrl).href',context),undefined);}
});
