const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createQueue,atomic,sign,VERSION}=require('../node/automation-queue.cjs');
const {submit}=require('../scripts/workbench-automation.cjs');
const {harness}=require('./support.cjs');
function fixture(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workbench-queue-')));fs.chmodSync(root,0o700);const q=createQueue(),instanceId=crypto.randomUUID();q.configure({directory:root,instanceId,operations:['status','import','patrol']});const config=JSON.parse(fs.readFileSync(path.join(root,'connection.json')));return {root,q,config,dispose:()=>fs.rmSync(root,{recursive:true,force:true})};}
function request(f,method='status',params={}){const payload={protocol:VERSION,id:crypto.randomUUID(),instanceId:f.config.instanceId,method,params,createdAt:Date.now()};atomic(path.join(f.root,'inbox',payload.id+'.json'),{payload,signature:sign(f.config.token,payload)});return payload;}
test('signed CLI request round trip, permissions and untrusted signatures',async()=>{
 const f=fixture();try{
  const pending=submit(f.root,'status',{},2000);await new Promise(r=>setTimeout(r,20));const job=f.q.take();assert.equal(job.method,'status');f.q.finish({id:job.id,ok:true,result:{sessions:0}});assert.deepEqual(await pending,{sessions:0});
  const invalid=request(f);const file=path.join(f.root,'inbox',invalid.id+'.json');atomic(file,{payload:invalid,signature:'0'.repeat(64)});assert.equal(f.q.take(),null);assert.equal(fs.existsSync(path.join(f.root,'outbox',invalid.id+'.json')),false);
  assert.equal(fs.statSync(path.join(f.root,'connection.json')).mode&0o777,0o600);
 }finally{f.dispose();}
});
test('completion is not replayed; in-flight restart reports unknown instead of executing again',()=>{
 const f=fixture();try{
  const job=request(f,'import',{source:{id:'test'},items:[]});assert.equal(f.q.take().id,job.id);f.q.finish({id:job.id,ok:true,result:{added:0}});
  atomic(path.join(f.root,'inbox',job.id+'.json'),{payload:job,signature:sign(f.config.token,job)});assert.equal(f.q.take(),null);
  const unknown=request(f);assert.equal(f.q.take().id,unknown.id);const restarted=createQueue();restarted.configure({directory:f.root,instanceId:f.config.instanceId,operations:['status']});assert.match(JSON.parse(fs.readFileSync(path.join(f.root,'outbox',unknown.id+'.json'))).payload.error,/RESULT_UNKNOWN/);assert.equal(restarted.take(),null);
 }finally{f.dispose();}
});
test('unavailable, stale, unsafe directories and non-allowlisted operations fail closed',async()=>{
 const f=fixture();try{
  request(f,'delete-worktree');assert.equal(f.q.take(),null);
  const stale=request(f);stale.createdAt=Date.now()-200000;atomic(path.join(f.root,'inbox',stale.id+'.json'),{payload:stale,signature:sign(f.config.token,stale)});assert.equal(f.q.take(),null);
  await assert.rejects(submit(f.root,'send',{},100),/未开放/);
  atomic(path.join(f.root,'heartbeat.json'),{instanceId:f.config.instanceId,at:0});await assert.rejects(submit(f.root,'status',{},100),/未运行/);
  fs.chmodSync(f.root,0o755);assert.throws(()=>createQueue().configure({directory:f.root,instanceId:f.config.instanceId,operations:['status']}),/0700/);fs.chmodSync(f.root,0o700);
  const linked=path.join(f.root,'linked');fs.symlinkSync(f.root,linked);assert.throws(()=>createQueue().configure({directory:linked,instanceId:f.config.instanceId,operations:['status']}));
 }finally{f.dispose();}
});
test('automation patrol ignores deleted and unassociated sessions and never scans the repository inventory',async()=>{
 const h=harness();await h.call('session/add',{session:'main-a'});const s=await h.call('state/read');s.repos.push({id:'not-associated',path:'/forbidden/root',name:'must-not-read'});s.sessions[0].deleted=true;
 const seeded=harness({'state-a.json':JSON.stringify(s)});seeded.context.jobId='fixture-patrol';const result=JSON.parse(JSON.stringify(await require('node:vm').runInContext("automationPatrol({},jobId)",seeded.context)));assert.equal(result.checked,0);assert.equal(seeded.calls.length,0);assert.equal(seeded.created(),0);
});
test('public script operations exclude session creation and development dispatch',async()=>{
 const h=harness();const result=await h.invokeTool('list_tools',{category:'automation'});assert.ok(result.result.tools.some(t=>t.name==='configure_script_automation'));const vm=require('node:vm');const status=vm.runInContext('scriptAutomation.status()',h.context);assert.deepEqual(Array.from(status.operations).sort(),['import','patrol','status']);
});
test('patrol only queries associated worktrees and excludes stale validation from cleanup candidates',async()=>{
 const h=harness();await h.call('session/add',{session:'main-a'});const s=await h.call('state/read');s.repos=[{id:'r',name:'selected',path:'/fixture/selected'},{id:'unused',name:'unused',path:'/forbidden'}];s.sessions[0].associations=[{id:'a',repoId:'r',branch:'feature',worktree:'/fixture/tree',revision:0,validation:{status:'passed',head:'old'},reviews:[]}];
 const seeded=harness({'state-a.json':JSON.stringify(s)},{worker:async r=>{assert.equal(r.method,'association/sync');assert.equal(r.params.path,'/fixture/selected');return {head:'current',dirty:false,reviews:{status:'ok',items:[{state:'MERGED',head:'current'}]},cleanup:{eligible:true}};}});
 const vm=require('node:vm'),run=async id=>{seeded.context.requestId=id;return JSON.parse(JSON.stringify(await vm.runInContext('automationPatrol({},requestId)',seeded.context)));};
 const first=await run('first');assert.equal(first.checked,1);assert.equal(first.candidates,0);assert.equal(first.rows[0].validationStale,true);assert.equal(seeded.calls.length,1);const again=await run('second');assert.equal(again.changes,0);assert.equal(seeded.created(),0);
});
test('patrol reports partial query failure and does not record a false successful checkpoint',async()=>{
 const h=harness();await h.call('session/add',{session:'main-a'});const s=await h.call('state/read');s.repos=[{id:'r',name:'selected',path:'/fixture/selected'}];s.sessions[0].associations=[{id:'a',repoId:'r',branch:'feature',worktree:'/fixture/tree',revision:0,validation:{status:'not-run'}}];
 const seeded=harness({'state-a.json':JSON.stringify(s)},{worker:async()=>{throw Error('fixture network error');}});const result=await require('node:vm').runInContext("automationPatrol({},'failed-run')",seeded.context);assert.equal(result.ok,false);assert.equal(result.failed,1);assert.equal(result.candidates,0);assert.equal(seeded.data.has('automation-patrol.json'),false);
});
test('CLI to Node to sandbox round trip uses the normal persistence service and keeps idle operations quiet',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workbench-chain-')));fs.chmodSync(root,0o700);const q=createQueue();let tick;const notifications=[];
 const h=harness({}, {worker:async r=>q.handle(r.method,r.params)});h.context.setInterval=fn=>{tick=fn;return 1;};h.context.cindy.send=async event=>{notifications.push(event);return {ok:true};};
 try{
  await h.call('automation/configure',{directory:root});
  const deliver=async(method,params={})=>{const pending=submit(root,method,params,2000);await tick();await require('node:vm').runInContext('queue',h.context);return pending;};
  const data={source:{id:'fixture'},items:[{id:'1',title:'Fixture requirement'}]};
  assert.equal((await deliver('import',data)).added,1);assert.equal((await h.call('state/read')).items.length,1);assert.equal(notifications.length,1);
  assert.equal((await deliver('import',data)).added,0);assert.equal(notifications.length,1);assert.equal((await deliver('patrol')).checked,0);assert.equal(notifications.length,1);
  await assert.rejects(deliver('import',{source:{id:'fixture'},items:[{id:'2',title:''}]}));assert.equal((await h.call('state/read')).items.length,1);assert.equal(h.created(),0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('oversized completion fails explicitly and releases the queue for later jobs',()=>{
 const f=fixture();try{const request1=request(f);f.q.take();f.q.finish({id:request1.id,ok:true,result:{text:'x'.repeat(710000)}});const reply=JSON.parse(fs.readFileSync(path.join(f.root,'outbox',request1.id+'.json')));assert.equal(reply.payload.ok,false);const second=request(f);assert.equal(f.q.take().id,second.id);}finally{f.dispose();}
});
test('a failed UI notification cannot discard a persisted import or hold the serial queue',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workbench-notify-')));fs.chmodSync(root,0o700);const q=createQueue();let tick;const h=harness({}, {worker:async r=>q.handle(r.method,r.params)});h.context.setInterval=fn=>{tick=fn;return 1;};h.context.cindy.send=async()=>{throw Error('fixture notification unavailable');};
 try{await h.call('automation/configure',{directory:root});const pending=submit(root,'import',{source:{id:'fixture'},items:[{id:'one',title:'Fixture requirement'}]},2000);await tick();await require('node:vm').runInContext('queue',h.context);assert.equal((await pending).added,1);assert.equal((await h.call('state/read')).items.length,1);assert.match(require('node:vm').runInContext('scriptAutomation.status().notificationError',h.context),/提示/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('failed reconfiguration keeps the original queue and never consumes another instance request',()=>{
 const a=fixture(),b=fixture();try{const other=request(b,'import',{source:{id:'other'},items:[]});assert.throws(()=>a.q.configure({directory:b.root,instanceId:a.config.instanceId,operations:['status','import']}),/其他插件实例/);assert.equal(a.q.take(),null);assert.equal(b.q.take().id,other.id);const own=request(a);assert.equal(a.q.take().id,own.id);}finally{a.dispose();b.dispose();}
});
for(const phase of ['take','finish-before','finish-after'])test(`transport recovery ${phase} never repeats a persisted import or blocks later jobs`,async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workbench-recovery-')));fs.chmodSync(root,0o700);const q=createQueue();let tick,failed=false,executions=0;
 const h=harness({}, {worker:async r=>{
  if(!failed&&r.method===`automation/${phase==='take'?'take':'finish'}`){failed=true;if(phase!=='finish-before')q.handle(r.method,r.params);throw Error('fixture lost RPC response');}
  return q.handle(r.method,r.params);
 }});h.context.setInterval=fn=>{tick=fn;return 1;};h.context.originalService=require('node:vm').runInContext('service',h.context);h.context.countImport=()=>{executions++;};require('node:vm').runInContext("service=async function(method,...args){if(method==='source/import')countImport();return originalService(method,...args);}",h.context);
 try{await h.call('automation/configure',{directory:root});const pending=submit(root,'import',{source:{id:'fixture'},items:[{id:'one',title:'Only once'}]},1500);pending.catch(()=>{});await tick();await require('node:vm').runInContext('queue',h.context);await tick();await require('node:vm').runInContext('queue',h.context);assert.equal((await pending).added,1);assert.equal(executions,1);const next=submit(root,'status',{},1500);next.catch(()=>{});await tick();await require('node:vm').runInContext('queue',h.context);assert.equal((await next).sessions,0);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'heartbeat.json'))).busy,false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('explicit PR/MR provider errors fail the patrol and cannot create a successful checkpoint',async()=>{
 const h=harness();await h.call('session/add',{session:'main-a'});const s=await h.call('state/read');s.repos=[{id:'r',name:'selected',path:'/fixture/selected'}];s.sessions[0].associations=[{id:'a',repoId:'r',branch:'feature',worktree:'/fixture/tree',revision:0,validation:{status:'not-run'}}];
 const seeded=harness({'state-a.json':JSON.stringify(s)},{worker:async()=>({head:'current',dirty:false,reviews:{status:'error',items:[]},cleanup:{eligible:false}})});const result=await require('node:vm').runInContext("automationPatrol({},'provider-error')",seeded.context);assert.equal(result.ok,false);assert.equal(result.failed,1);assert.equal(result.rows[0].error,true);assert.equal(seeded.data.has('automation-patrol.json'),false);
});
test('lost claims are redelivered to the same consumer but never replayed after sandbox restart',()=>{
 const f=fixture();try{
  const oldConsumer=crypto.randomUUID(),newConsumer=crypto.randomUUID();
  const options={directory:f.root,instanceId:f.config.instanceId,operations:['status'],consumerId:oldConsumer};f.q.configure(options);
  const job=request(f);assert.equal(f.q.take().id,job.id);assert.equal(f.q.take().id,job.id);
  f.q.configure(options);assert.equal(f.q.take().id,job.id);
  f.q.configure({...options,consumerId:newConsumer});assert.equal(f.q.take(),null);
  const response=JSON.parse(fs.readFileSync(path.join(f.root,'outbox',job.id+'.json')));assert.match(response.payload.error,/RESULT_UNKNOWN/);
  assert.equal(f.q.finish({id:job.id,ok:true,result:{}}).ok,true);assert.match(JSON.parse(fs.readFileSync(path.join(f.root,'outbox',job.id+'.json'))).payload.error,/RESULT_UNKNOWN/);
 }finally{f.dispose();}
});
test('partial directory validation failure preserves the active configuration',()=>{
 const a=fixture(),b=fixture();try{
  fs.chmodSync(path.join(b.root,'outbox'),0o755);
  assert.throws(()=>a.q.configure({directory:b.root,instanceId:b.config.instanceId,operations:['status']}),/0700/);
  const own=request(a);assert.equal(a.q.take().id,own.id);
 }finally{a.dispose();b.dispose();}
});
test('polling refreshes liveness during a delayed operation without executing it twice',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workbench-running-')));fs.chmodSync(root,0o700);const q=createQueue();let tick,release,started;
 const entered=new Promise(r=>{started=r;}),gate=new Promise(r=>{release=r;});
 const h=harness({}, {worker:async r=>q.handle(r.method,r.params)});h.context.setInterval=fn=>{tick=fn;return 1;};
 let executions=0;h.context.waitForOperation=async()=>{executions++;started();await gate;return {sessions:0};};
 require('node:vm').runInContext('automationStatus=()=>waitForOperation();',h.context);
 // The bridge captures operation functions at creation, so create a fresh bridge for this delayed fixture.
 require('node:vm').runInContext('delayedBridge=startWorkbenchAutomation();',h.context);
 try{
  await require('node:vm').runInContext(`delayedBridge.configure({directory:${JSON.stringify(root)}})`,h.context);
  const pending=submit(root,'status',{},2000);pending.catch(()=>{});await tick();await entered;
  atomic(path.join(root,'heartbeat.json'),{at:0});await tick();
  assert.ok(JSON.parse(fs.readFileSync(path.join(root,'heartbeat.json'))).at>0);assert.equal(executions,1);
  release();await require('node:vm').runInContext('queue',h.context);assert.equal((await pending).sessions,0);assert.equal(executions,1);
 }finally{release();fs.rmSync(root,{recursive:true,force:true});}
});
