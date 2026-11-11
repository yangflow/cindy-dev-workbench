/* Restricted script operations share the same service and write queue as the UI. */
function activeAutomationSessions(s){return s.sessions.filter(m=>!m.deleted&&!m.superseded&&(!m.itemId||s.items.some(i=>i.id===m.itemId&&!i.deleted)));}
async function automationStatus(){await load();const sessions=activeAutomationSessions(state);return {sessions:sessions.length,associations:sessions.reduce((n,m)=>n+m.associations.length,0)};}
async function automationPatrol(params,id){
 await load();if(Object.keys(params).length)throw Error('巡检范围由工作台关联确定，不接受路径或会话覆盖');
 const sessions=activeAutomationSessions(state).filter(m=>m.associations.length);
 if(!sessions.length)return {ok:true,sessions:0,checked:0,failed:0,candidates:0,changes:0};
 let failed=0;const errors=[];
 for(const m of sessions){try{const result=await service('session/sync',{session:m.id},id+':'+m.id);failed+=result.failed||0;}catch{failed++;errors.push({session:m.id,error:'主会话或关联查询失败'});}}
 const rows=[];
 for(const original of sessions){const m=state.sessions.find(x=>x.id===original.id);for(const a of m.associations){const repo=getRepo(state,a.repoId);const providerError=a.snapshot?.reviews?.status==='error';if(providerError&&!a.error){failed++;errors.push({session:m.id,error:'PR/MR 查询失败'});}const review=WorkbenchReview.review(a),stale=WorkbenchModel.validationStale(a);const eligible=!a.error&&!providerError&&review==='merged'&&a.snapshot?.cleanup?.eligible===true&&a.snapshot.dirty===false&&a.validation?.status==='passed'&&!stale;rows.push({session:m.id,repository:repo.name,branch:a.branch,worktree:a.worktree,head:a.snapshot?.head||null,review,validation:a.validation?.status||'not-run',validationStale:stale,dirty:a.snapshot?.dirty??null,eligible,error:!!a.error||providerError});}}
 const fingerprint=JSON.stringify(rows),previous=await readFile('automation-patrol.json');
 let changes=rows.length;
 if(previous.ok){try{changes=JSON.parse(previous.content).fingerprint===fingerprint?0:rows.length;}catch{throw Error('巡检检查点损坏，未覆盖');}}
 if(!failed)await writeVerified('automation-patrol.json',{fingerprint,checkedAt:new Date().toISOString()});
 return {ok:failed===0,sessions:sessions.length,checked:rows.length,failed,candidates:rows.filter(r=>r.eligible).length,changes,rows,errors};
}
function startWorkbenchAutomation(extra={},omit=[]){
 const operations={status:automationStatus,import:(params,id)=>service('source/import',params,id),patrol:automationPatrol,...extra};
 for(const key of omit)delete operations[key];
 const bridge=WorkbenchAutomation.create({
  read:readFile,write:writeVerified,
  serialize(fn){const result=queue.then(fn);queue=result.catch(()=>{});return result;},
  operations
 });
 if(typeof setInterval==='function')bridge.start();
 return bridge;
}
