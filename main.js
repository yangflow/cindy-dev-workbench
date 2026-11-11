/* Pure, lossless migration shared by the sandbox and fixture tests. */
const WorkbenchModel=(()=>{
 const clone=x=>JSON.parse(JSON.stringify(x));
 function migrate(old){if(old.version===2)return clone(old);if(old.version!==1)throw Error('未知数据版本');const s={version:2,revision:old.revision,sessions:[],repos:clone(old.repos),legacyRecords:clone(old.tasks),receipts:{},pendingCreates:{},migration:{from:1,sourceRevision:old.revision,backup:'migration-v1-r'+old.revision+'.json'}};
 for(const t of old.tasks){if(!t.cindy?.id)continue;let main=s.sessions.find(x=>x.id===t.cindy.id);if(!main){main={id:t.cindy.id,label:t.cindy.label||t.title,owned:!!t.cindy.owned,status:t.status||'todo',note:'',revision:0,verification:'legacy-pending',associations:[],children:[],legacyIds:[]};s.sessions.push(main);}main.legacyIds.push(t.id);if(t.repo)main.associations.push({id:'legacy-'+t.id,repoId:t.repo,branch:'',worktree:'',reviews:[],validation:{status:'not-run',note:'旧版未记录验证结果',head:null},revision:0,legacyTaskId:t.id,missingRepo:!s.repos.some(r=>r.id===t.repo)});}
 return s;}
 function validationStale(a){return a.validation?.status==='passed'&&(!a.validation.head||a.validation.head!==a.snapshot?.head);}
 return {clone,migrate,validationStale};
})();

'use strict';
const channel=new BroadcastChannel('cindy-dev-workbench-v1');
let state=null;let queue=Promise.resolve();const pending=new Set();const cache=new Map();const repoDiscoveries=new Map();
const fresh=()=>({version:2,revision:0,sessions:[],repos:[],legacyRecords:[],receipts:{},pendingCreates:{}});
async function readFile(path){const r=await cindy.fs({op:'read',root:'data',path});if(!r.ok&&r.errorCode!=='NOT_FOUND')throw Error('工作台数据读取失败：'+r.message);return r;}
async function writeVerified(path,value){const content=JSON.stringify(value);const r=await cindy.fs({op:'write',root:'data',path,content});if(!r.ok)throw Error('保存失败：'+r.message);const read=await readFile(path);if(!read.ok||read.content!==content)throw Error('保存回读未确认，请刷新核对');}
async function load(){if(state)return state;const found=[];let existing=false;for(const path of ['state-a.json','state-b.json']){const r=await readFile(path);if(r.ok){existing=true;try{const s=JSON.parse(r.content);if([1,2].includes(s.version)&&Number.isInteger(s.revision)&&Array.isArray(s.repos)&&s.receipts&&(s.version===1?Array.isArray(s.tasks):Array.isArray(s.sessions)&&Array.isArray(s.legacyRecords)&&s.pendingCreates))found.push(s);}catch{}}}if(!found.length&&existing)throw Error('本地数据校验失败，已停止写入。请保留数据并恢复备份。');const selected=found.sort((a,b)=>b.revision-a.revision)[0]||fresh();if(selected.version===1){const migrated=WorkbenchModel.migrate(selected);const file=migrated.migration.backup;const backup=await readFile(file);if(backup.ok&&backup.content!==JSON.stringify(selected))throw Error('旧版备份冲突，未覆盖任何备份');if(!backup.ok)await writeVerified(file,selected);state=selected;try{await save(migrated);}catch(e){state=null;throw e;}}else state=selected;if(!state.ui){await writeVerified('upgrade-ui-r'+state.revision+'.json',state);const next=WorkbenchModel.clone(state);next.ui={statuses:[{id:'todo',name:'待办',color:'gray',category:'todo'},{id:'doing',name:'进行中',color:'blue',category:'doing'},{id:'done',name:'已完成',color:'green',category:'done'},{id:'archived',name:'已归档',color:'gray',category:'done'}],labels:{}};next.items=[];await save(next);}return state;}
async function save(next){next.revision=state.revision+1;if(JSON.stringify(next).length>1500000)throw Error('工作台记录过大，请减少缓存');await writeVerified(next.revision%2?'state-a.json':'state-b.json',next);state=next;}
function getSession(s,id){const m=s.sessions.find(m=>m.id===id);if(!m)throw Error('主会话不在工作台中，请先从宿主选择');return m;}
function getRepo(s,id){const r=s.repos.find(r=>r.id===id);if(!r)throw Error('仓库不在明确清单内');return r;}
function getLink(s,p){const m=getSession(s,p.session);const a=m.associations.find(a=>a.id===p.association);if(!a)throw Error('仓库关联不存在');return {m,a,r:getRepo(s,a.repoId)};}
function checkRevision(item,revision){if(item.revision!==revision)throw Error('记录已变化，请刷新后再保存');}
async function worker(method,params){const r=await cindy.node.request({method,params,timeoutMs:120000,maxTotalMs:300000});if(!r.ok)throw Error(r.message||'仓库读取失败');return r.result;}
async function targets(){if(typeof cindy.targets?.list!=='function')throw Error('宿主未提供本机任务查询');return cindy.targets.list({targetKind:'task'});}
async function verify(id){const listed=await targets();const selected=listed.targets.find(x=>x.kind==='task'&&x.id===id);if(!selected)throw Error('Cindy 会话不可用，请从宿主清单重新选择');const actual=await cindy.targets.resolve({target:{kind:'task',id}});if(actual.id!==id||actual.kind!=='task')throw Error('宿主返回的会话身份不一致');return actual;}
function newSession(id,label,owned=false){return {id,label,owned,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'todo',note:'',revision:0,verification:'host',verifiedAt:new Date().toISOString(),associations:[],children:[],legacyIds:[]};}
function validateFields(p){if(typeof p.branch!=='string'||p.branch.length>300||typeof p.worktree!=='string'||p.worktree.length>4096||/[\0\n\r]/.test(p.branch+p.worktree))throw Error('分支或 worktree 字段无效');if(!Array.isArray(p.reviews)||p.reviews.length>30)throw Error('MR 链接列表无效');for(const url of p.reviews){let u;try{u=new URL(url);}catch{throw Error('MR 链接必须为 HTTPS 地址');}if(u.protocol!=='https:'||u.username||u.password)throw Error('MR 链接不能含凭据，且必须为 HTTPS');}if(!['not-run','passed','failed','blocked'].includes(p.validationStatus)||typeof p.validationNote!=='string'||p.validationNote.length>20000)throw Error('验证状态或说明无效');}
(function(root){
 const names={unknown:'查询未知',confirm:'待确认',none:'无 PR/MR',pending:'待合并',merged:'已合并',closed:'已关闭'};
 function review(a){if(a.error)return 'unknown';const r=a.snapshot?.reviews;if(!r)return 'confirm';if(r.status!=='ok')return 'unknown';const rows=r.items;if(!Array.isArray(rows))return 'unknown';const observed=new Set(rows.map(r=>r.url));if((a.reviews||[]).some(url=>!observed.has(url)))return 'confirm';if(!rows.length)return 'none';if(rows.some(r=>!['MERGED','OPEN','OPENED','CLOSED'].includes(r.state)))return 'unknown';if(rows.every(r=>r.state==='MERGED'))return a.snapshot?.head&&rows.every(r=>r.head===a.snapshot.head)?'merged':'confirm';if(rows.some(r=>r.state==='OPEN'||r.state==='OPENED'))return 'pending';return 'closed';}
 function summary(m){const rows=m.associations;const states=rows.map(review);return {total:rows.length,hidden:rows.filter(a=>a.hidden).length,merged:states.filter(s=>s==='merged').length,unknown:states.some(s=>s==='unknown'||s==='confirm'),needsAttention:rows.some((a,i)=>states[i]!=='merged'||a.validation?.status!=='passed'||!a.validation.head||a.validation.head!==a.snapshot?.head)};}
 const api={review,summary,names};root.WorkbenchReview=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);



const WorkbenchSource=(()=>{
function text(value,label,max,optional=false){
 if(optional&&(value===undefined||value===''))return '';
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))throw Error(label+'无效');
 return value.trim();
}
function normalize(payload){
 if(!payload||!payload.source||!Array.isArray(payload.items)||payload.items.length>500)throw Error('请提供 source 和最多 500 条 items');
 const id=text(payload.source.id,'来源 ID',80);
 if(!/^[a-zA-Z0-9._-]+$/.test(id))throw Error('来源 ID 仅支持字母、数字、点、下划线和连字符');
 const source={id,name:text(payload.source.name,'来源名称',60,true)||id};
 const seen=new Set();
 return payload.items.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('任务对象无效');
  const externalId=text(item.id,'任务 ID',200);
  if(seen.has(externalId))throw Error('同一批次任务 ID 重复');seen.add(externalId);
  const title=text(item.title,'任务标题',300),ref=text(item.ref,'显示编号',80,true);
  const url=text(item.url,'来源链接',2048,true);
  if(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('来源链接必须为不含凭据的 HTTPS 地址');}
  if(item.note!==undefined&&(typeof item.note!=='string'||item.note.length>20000))throw Error('备注过长或类型无效');
  if(item.labels!==undefined&&(!Array.isArray(item.labels)||item.labels.length>20))throw Error('每条任务最多 20 个标签');
  const labels=[...new Set((item.labels||[]).map(l=>text(l,'标签',40)))];
  if(labels.some(l=>['__proto__','constructor','prototype'].includes(l)))throw Error('标签名称无效');
  return {source,externalId,title,ref,url,note:item.note||'',labels};
 });
}
return {normalize};
})();


async function service(method,p={},id){await load();if(method==='automation/configure')return scriptAutomation.configure(p);if(method==='automation/status')return scriptAutomation.status();if(method==='state/read')return state;if(method==='host/targets')return targets();if(method==='data/legacy-backup'){if(!state.migration)return {backup:null};const r=await readFile(state.migration.backup);if(!r.ok)throw Error('旧版备份不可用');return {backup:JSON.parse(r.content)};}
if(method==='entry/open-history'){const e=safeHistoryEntry(state,p);await verify(p.historySessionId);const r=await cindy.taskView({sessionId:p.historySessionId,focus:true});if(!r.ok||r.focusRequested!==true)throw Error(r.message||'宿主未确认旧会话导航');return r;}
if(method==='entry/open'){const e=findEntry(state,p.entry);const session=e.sessionId||e.id;if(e.kind==='item'&&!e.sessionId)throw Error('请先创建开发会话');await verify(session);const r=await cindy.taskView({sessionId:session,focus:true});if(!r.ok||r.focusRequested!==true)throw Error(r.message||'宿主未确认会话导航，请从 Cindy 任务列表打开');return r;}
if(method==='session/open-editor'){const m=getSession(state,p.session);await verify(m.id);const links=m.associations.filter(a=>!a.hidden).map(a=>({path:getRepo(state,a.repoId).path,branch:a.branch,worktree:a.worktree}));return worker('session/open-editor',{links});}
if(method==='repo/discover'){if(!Number.isInteger(p.maxDepth)||p.maxDepth<1||p.maxDepth>5)throw Error('扫描层级应为 1–5');const picked=await cindy.pick({mode:'directory',title:'选择要检测 Git 仓库的上级目录'});if(!picked.ok)throw Error(picked.errorCode==='CANCELLED'?'已取消导入':picked.message||'目录选择失败');const found=await worker('repo/discover',{path:picked.path,maxDepth:p.maxDepth});const token=crypto.randomUUID();const candidates=found.repos.map(r=>({...r,key:crypto.randomUUID(),existing:state.repos.some(x=>x.path===r.path)}));for(const [key,value]of repoDiscoveries)if(value.expires<Date.now())repoDiscoveries.delete(key);if(repoDiscoveries.size>=8)repoDiscoveries.delete(repoDiscoveries.keys().next().value);repoDiscoveries.set(token,{candidates,expires:Date.now()+600000});return {...found,repos:undefined,candidates,token};}
if(method==='repo/trees'){getSession(state,p.session);await verify(p.session);const r=getRepo(state,p.repo);return worker('repo/trees',{path:r.path});}
if(method==='association/diff'){const {a,r}=getLink(state,p);await verify(p.session);return worker('association/diff',{path:r.path,branch:a.branch,worktree:a.worktree});}
if(id&&state.receipts[id])return state.receipts[id];let s=WorkbenchModel.clone(state);let result={ok:true};
if(method.startsWith('entry/')||method.startsWith('ui/')||method.startsWith('source/')||method.startsWith('display/'))return extendedService(method,p,id);
if(method==='session/add'){const target=await verify(p.session);if(!s.sessions.some(m=>m.id===target.id))s.sessions.push(newSession(target.id,target.label));result={sessionId:target.id};}
else if(method==='session/create'||method==='session/resume-create'){let key=id;if(method==='session/resume-create')key=p.requestId;let intent=s.pendingCreates[key];if(!intent){if(method==='session/resume-create')throw Error('未确认创建请求不存在');if(Object.keys(s.pendingCreates).length)throw Error('已有未确认创建，请先恢复该请求，不要重复新建');if(typeof p.title!=='string'||!p.title.trim()||p.title.length>300)throw Error('请填写 Cindy 主会话标题');intent={title:p.title.trim(),requestKey:'workbench-main-'+key};s.pendingCreates[key]=intent;await save(s);s=WorkbenchModel.clone(state);}const caps=await cindy.tasks.capabilities();if(!caps.operations?.includes('create'))throw Error('宿主不支持创建普通任务');const created=await cindy.tasks.create({requestKey:intent.requestKey,title:intent.title});if(!s.sessions.some(m=>m.id===created.taskId))s.sessions.push(newSession(created.taskId,intent.title,true));delete s.pendingCreates[key];result={sessionId:created.taskId,message:'Cindy 主会话已创建，未启动模型'};}
else if(method==='session/edit'){const m=getSession(s,p.session);checkRevision(m,p.revision);const target=await verify(m.id);if(!s.ui.statuses.some(x=>x.id===p.status)||typeof p.note!=='string'||p.note.length>20000)throw Error('状态或说明无效');Object.assign(m,{label:target.label,status:p.status,note:p.note,verification:'host',verifiedAt:new Date().toISOString(),revision:m.revision+1});}
else if(method==='session/remove'){const m=getSession(s,p.session);checkRevision(m,p.revision);s.sessions=s.sessions.filter(x=>x.id!==m.id);}
else if(method==='session/archive-owned'){const m=getSession(s,p.session);if(!m.owned)throw Error('只能归档本插件创建的空闲会话');await cindy.tasks.archive({taskId:m.id});m.archived=true;m.revision++;}
else if(method==='session/child'){const m=getSession(s,p.session);checkRevision(m,p.revision);await verify(m.id);const child=await verify(p.child);if(child.id===m.id||s.sessions.some(x=>x.id===child.id)||s.sessions.some(x=>x.id!==m.id&&x.children.some(c=>c.id===child.id)))throw Error('该会话已是主会话或归属其他主会话');if(!m.children.some(c=>c.id===child.id))m.children.push({id:child.id,label:child.label,verifiedAt:new Date().toISOString()});m.revision++;}
else if(method==='association/save'){const m=getSession(s,p.session);await verify(m.id);const r=getRepo(s,p.repo);validateFields(p);let a=p.association?m.associations.find(a=>a.id===p.association):null;if(p.association&&!a)throw Error('仓库关联不存在');if(a){checkRevision(a,p.revision);}else{checkRevision(m,p.sessionRevision);if(m.associations.some(a=>a.repoId===r.id&&a.branch===p.branch&&a.worktree===p.worktree))throw Error('相同仓库、分支与 worktree 已关联');a={id:crypto.randomUUID(),revision:0};m.associations.push(a);}const changedScope=a.repoId!==r.id||a.branch!==p.branch||a.worktree!==p.worktree;const previousValidation=a.validation;const sameValidation=p.validationStatus===previousValidation?.status&&p.validationNote===previousValidation?.note&&!p.validationRefresh;if(!sameValidation&&p.validationStatus==='passed'&&(!a.snapshot?.head||a.error||changedScope))throw Error('请先成功同步当前关联，再记录验证通过');Object.assign(a,{repoId:r.id,branch:p.branch,worktree:p.worktree,reviews:[...new Set(p.reviews)],validation:{status:p.validationStatus,note:p.validationNote,head:sameValidation?previousValidation.head:a.snapshot?.head||null,checkedAt:sameValidation?previousValidation.checkedAt:new Date().toISOString(),source:'manual'},revision:a.revision+1});if(changedScope){delete a.snapshot;delete a.error;a.validation.head=null;}delete a.missingRepo;m.revision++;result={associationId:a.id};}
else if(method==='association/remove'){const m=getSession(s,p.session);const a=m.associations.find(a=>a.id===p.association);if(!a)throw Error('仓库关联不存在');checkRevision(a,p.revision);m.associations=m.associations.filter(x=>x.id!==a.id);m.revision++;}
else if(method==='session/sync'){const m=getSession(s,p.session);const target=await verify(m.id);m.label=target.label;m.verification='host';m.verifiedAt=new Date().toISOString();let failed=0;for(const a of m.associations){try{const r=getRepo(s,a.repoId);a.snapshot=await worker('association/sync',{path:r.path,provider:r.provider||'auto',branch:a.branch,worktree:a.worktree});delete a.error;}catch(e){a.error=e.message;a.failedAt=new Date().toISOString();failed++;}a.revision++;}m.revision++;result={ok:failed===0,failed,checked:m.associations.length};}
else if(method==='legacy/link'){const legacy=s.legacyRecords.find(t=>t.id===p.legacy);if(!legacy)throw Error('旧版记录不存在');const target=await verify(p.session);let m=s.sessions.find(x=>x.id===target.id);if(!m){m=newSession(target.id,target.label);s.sessions.push(m);}if(!m.legacyIds.includes(legacy.id))m.legacyIds.push(legacy.id);if(legacy.repo&&!m.associations.some(a=>a.legacyTaskId===legacy.id))m.associations.push({id:'legacy-'+legacy.id,repoId:legacy.repo,branch:'',worktree:'',reviews:[],validation:{status:'not-run',note:'来自旧版关联，尚未配置分支',head:null},revision:0,legacyTaskId:legacy.id});m.revision++;}
else if(method==='repo/add'){const picked=await cindy.pick({mode:'directory',title:'添加一个仓库根目录'});if(!picked.ok)throw Error(picked.errorCode==='CANCELLED'?'已取消添加仓库':picked.message||'目录选择失败');const r=await worker('repo/register',{path:picked.path});if(s.repos.some(x=>x.path===r.path))throw Error('仓库已在清单中');const repo={id:crypto.randomUUID(),...r};s.repos.push(repo);result={repoId:repo.id};}
else if(method==='repo/import'){const found=repoDiscoveries.get(p.token);if(!found||found.expires<Date.now())throw Error('检测结果已过期，请重新选择目录');if(!Array.isArray(p.selected)||!p.selected.length||p.selected.length>200||new Set(p.selected).size!==p.selected.length)throw Error('请选择检测结果中的仓库');const selected=p.selected.map(key=>{const candidate=found.candidates.find(x=>x.key===key);if(!candidate)throw Error('仓库不属于本次检测结果');return candidate;});const verified=[];for(const candidate of selected)verified.push(await worker('repo/register',{path:candidate.path}));let added=0,skipped=0;for(const r of verified){if(s.repos.some(x=>x.path===r.path)){skipped++;continue;}s.repos.push({id:crypto.randomUUID(),...r});added++;}result={added,skipped};}
else if(method==='repo/provider'){if(!['auto','github','gitlab'].includes(p.provider))throw Error('托管方无效');const r=getRepo(s,p.repo);r.provider=p.provider;}
else if(method==='repo/remove'){getRepo(s,p.repo);if(s.sessions.some(m=>m.associations.some(a=>a.repoId===p.repo)))throw Error('仓库仍被主会话引用，请先解除对应关联');s.repos=s.repos.filter(r=>r.id!==p.repo);}
else throw Error('不支持的工作台操作');
if(id){s.receipts[id]=result;for(const k of Object.keys(s.receipts).slice(0,-100))delete s.receipts[k];}await save(s);return result;}
channel.onmessage=({data})=>{if(!data||data.type!=='request'||typeof data.id!=='string')return;if(cache.has(data.id)){channel.postMessage(cache.get(data.id));return;}if(pending.has(data.id))return;pending.add(data.id);queue=queue.then(async()=>{let reply;try{reply={type:'response',id:data.id,ok:true,result:await service(data.method,data.params,data.id)};}catch(e){reply={type:'response',id:data.id,ok:false,error:e.message};}pending.delete(data.id);cache.set(data.id,reply);if(cache.size>100)cache.delete(cache.keys().next().value);channel.postMessage(reply);});};
const toolCatalog=[{"name": "read_workbench", "description": "读取主会话、多仓关联、明确仓库清单及旧版待关联记录。", "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": false}, "category": "sessions"}, {"name": "track_session", "description": "把宿主核验的 Cindy 任务加入主会话工作台，不创建独立需求任务。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}}, "required": ["session"], "additionalProperties": false}, "category": "sessions"}, {"name": "create_main_session", "description": "直接创建 Cindy 空主会话并显示在工作台，不启动模型。", "parameters": {"type": "object", "properties": {"title": {"type": "string"}}, "required": ["title"], "additionalProperties": false}, "category": "sessions"}, {"name": "resume_main_session_create", "description": "恢复结果未确认的同一次主会话创建，沿用原幂等键。", "parameters": {"type": "object", "properties": {"requestId": {"type": "string"}}, "required": ["requestId"], "additionalProperties": false}, "category": "sessions"}, {"name": "update_session", "description": "手动更新主会话整体阶段和说明；MR 合并不会自动完成整个需求。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}, "status": {"type": "string", "enum": ["todo", "doing", "done", "archived"]}, "note": {"type": "string"}}, "required": ["session", "revision", "status", "note"], "additionalProperties": false}, "category": "sessions"}, {"name": "untrack_session", "description": "从工作台移除主会话及其关联记录，不删除 Cindy 会话或仓库。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}}, "required": ["session", "revision"], "additionalProperties": false}, "category": "sessions"}, {"name": "archive_owned_session", "description": "归档由本插件创建的空闲 Cindy 主会话。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}}, "required": ["session"], "additionalProperties": false}, "category": "sessions"}, {"name": "link_child_session", "description": "把经宿主核验的执行会话归属主会话；不创建子代理或发送消息。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}, "child": {"type": "string"}}, "required": ["session", "revision", "child"], "additionalProperties": false}, "category": "sessions"}, {"name": "save_session_repository", "description": "新增或编辑主会话内的一条仓库关联。repo 为明确仓库 ID；修改关联须传 association 与其 revision；新增须传 sessionRevision。验证记录为手工结果，绑定当时观测 HEAD。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}, "repo": {"type": "string"}, "association": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}, "sessionRevision": {"type": "integer", "minimum": 0}, "branch": {"type": "string"}, "worktree": {"type": "string"}, "reviews": {"type": "array", "items": {"type": "string"}}, "validationStatus": {"type": "string", "enum": ["not-run", "passed", "failed", "blocked"]}, "validationNote": {"type": "string"}, "validationRefresh": {"type": "boolean", "description": "明确重新验证时传 true，将结果绑定最近成功观测的提交。"}}, "required": ["session", "repo", "branch", "worktree", "reviews", "validationStatus", "validationNote"], "additionalProperties": false}, "category": "workspace"}, {"name": "remove_session_repository", "description": "解除指定主会话内的仓库关联；不影响其他会话使用同一仓库。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}, "association": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}}, "required": ["session", "association", "revision"], "additionalProperties": false}, "category": "workspace"}, {"name": "sync_session", "description": "只同步指定主会话已明确关联的仓库和 worktree，不扫描其他目录，不自动完成需求。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}}, "required": ["session"], "additionalProperties": false}, "category": "workspace"}, {"name": "read_session_diff", "description": "读取指定主会话仓库关联选中的 worktree diff。", "parameters": {"type": "object", "properties": {"session": {"type": "string"}, "association": {"type": "string"}}, "required": ["session", "association"], "additionalProperties": false}, "category": "workspace"}, {"name": "read_legacy_backup", "description": "返回迁移前原始 v1 数据，用于核对和回退，源备份不被改写。", "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": false}, "category": "sessions"}, {"name": "link_legacy_record", "description": "保留旧版记录，并将其关联复制至宿主核验的主会话。", "parameters": {"type": "object", "properties": {"legacy": {"type": "string"}, "session": {"type": "string"}}, "required": ["legacy", "session"], "additionalProperties": false}, "category": "sessions"}, {"name": "edit_board_entry", "description": "编辑同一底层需求/主会话条目，标题、状态、备注和标签不会被重复同步覆盖。", "parameters": {"type": "object", "properties": {"entry": {"type": "string"}, "revision": {"type": "integer", "minimum": 0}, "title": {"type": "string"}, "status": {"type": "string"}, "note": {"type": "string"}, "labels": {"type": "array", "items": {"type": "string"}}, "pinned": {"type": "boolean"}}, "required": ["entry", "revision", "status", "note", "labels", "pinned"], "additionalProperties": false}, "category": "board"}, {"name": "create_entry_session", "description": "为来源任务创建 Cindy 空会话或读回现有关联，幂等、不发送开发指令。", "parameters": {"type": "object", "properties": {"entry": {"type": "string"}}, "required": ["entry"], "additionalProperties": false}, "category": "board"}, {"name": "restart_entry_session", "description": "显式重新开始：创建新的空会话，保留旧会话和发送回执，不自动重发首条指令。", "parameters": {"type": "object", "properties": {"entry": {"type": "string"}}, "required": ["entry"], "additionalProperties": false}, "category": "board"}, {"name": "start_entry_development", "description": "用户明确确认后发送可见开发指令；保留真实回执，受理或结果未知时禁止重放。禁止用于未授权真实业务开发。", "parameters": {"type": "object", "properties": {"entry": {"type": "string"}, "text": {"type": "string"}, "retry": {"type": "boolean"}}, "required": ["entry", "text"], "additionalProperties": false}, "category": "board"}, {"name": "import_source_items", "category": "sources", "description": "导入已授权来源的任务清单。来源 ID 与外部任务 ID 联合去重；先校验整批，再增量写入。保留手动编辑、会话关联及缺席条目，不发起开发。", "parameters": {"type": "object", "properties": {"source": {"type": "object", "properties": {"id": {"type": "string"}, "name": {"type": "string"}}, "required": ["id"], "additionalProperties": false}, "items": {"type": "array", "maxItems": 500, "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "ref": {"type": "string"}, "url": {"type": "string"}, "note": {"type": "string"}, "labels": {"type": "array"}}, "required": ["id", "title"], "additionalProperties": false}}}, "required": ["source", "items"], "additionalProperties": false}}, {"name": "configure_script_automation", "category": "automation", "description": "配置工作台的私有脚本队列。directory 为专用空目录或此实例已拥有的目录；不返回密钥。", "parameters": {"type": "object", "properties": {"directory": {"type": "string"}}, "required": ["directory"], "additionalProperties": false}}, {"name": "script_automation_status", "category": "automation", "description": "读取脚本接口配置与后台错误，不读取密钥。", "parameters": {"type": "object", "properties": {}, "additionalProperties": false}}];
const categoryRules={"automation":"只配置插件独占目录；脚本不可创建会话、发送指令或删除 worktree。","board": "空会话创建与开发指令发送是不同动作。不得未经授权启动真实业务开发。首条发送已受理或结果不明时禁止重放；重新开始创建新空会话并保留旧关联。", "workspace": "只操作主会话明确关联的仓库和 worktree；不扫描父目录。查询未知不算已合并；清理只预演，禁止真实删除。", "sessions": "主会话身份必须由宿主核验；不接收任意 UUID。一个需求一个主会话，多仓配置独立，单个 MR 合并不能自动完成整体需求。", "sources": "仅导入已授权获取的来源数据，来源 ID 区分不同系统或项目；批量校验失败不写入，不自动删除缺席条目，不创建会话或发送指令。"};
const toolMethods={configure_script_automation:'automation/configure',script_automation_status:'automation/status',import_source_items:'source/import',edit_board_entry:'entry/edit',create_entry_session:'entry/create-session',restart_entry_session:'entry/restart',start_entry_development:'entry/start',read_workbench:'state/read',track_session:'session/add',create_main_session:'session/create',resume_main_session_create:'session/resume-create',update_session:'session/edit',untrack_session:'session/remove',archive_owned_session:'session/archive-owned',link_child_session:'session/child',save_session_repository:'association/save',remove_session_repository:'association/remove',sync_session:'session/sync',read_session_diff:'association/diff',read_legacy_backup:'data/legacy-backup',link_legacy_record:'legacy/link'};
function validateArguments(schema,value){if(!value||typeof value!=='object'||Array.isArray(value))return false;for(const key of schema.required||[])if(!(key in value))return false;for(const [key,v] of Object.entries(value)){const p=schema.properties?.[key];if(!p)return false;if(p.type==='string'&&(typeof v!=='string'||p.minLength&&v.length<p.minLength||p.maxLength&&v.length>p.maxLength))return false;if(p.type==='integer'&&(!Number.isInteger(v)||p.minimum!==undefined&&v<p.minimum))return false;if(p.type==='boolean'&&typeof v!=='boolean')return false;if(p.type==='array'&&!Array.isArray(v))return false;if(p.type==='object'&&(!v||typeof v!=='object'||Array.isArray(v)))return false;if(p.enum&&!p.enum.includes(v))return false;}return true;}
cindy.onHostMessage(msg=>{if(msg.type!=='tool-call')return;queue=queue.then(async()=>{try{let result;if(msg.tool==='list_tools'){const category=msg.args?.category;if(!category)result={categories:Object.entries(categoryRules).map(([name])=>({name,count:toolCatalog.filter(t=>t.category===name).length}))};else result={category,tools:toolCatalog.filter(t=>t.category===category),rules:{[category]:categoryRules[category]||'未知类目，请先查询类目概览。'}};}else{const name=msg.tool==='read_workbench'?'read_workbench':msg.args?.name;const args=msg.tool==='read_workbench'?{}:(msg.args?.args||{});const t=toolCatalog.find(t=>t.name===name);if(!t){result={ok:false,errorCode:'UNKNOWN_TOOL',available:toolCatalog.map(t=>t.name),message:'请先调用 list_tools 查询操作目录'};}else if(!validateArguments(t.parameters,args)){result={ok:false,errorCode:'INVALID_ARGS',schema:t.parameters,rules:{[t.category]:categoryRules[t.category]}};}else result=await service(toolMethods[name],args,msg.callId);}await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});}catch(e){await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'WORKBENCH_FAILED',message:'操作未完成：'+e.message});}});});
function safeHistoryEntry(s,p){const e=s.items.find(x=>x.id===p.entry);if(!e?.sessionHistory?.some(h=>h.sessionId===p.historySessionId))throw Error('旧会话不属于此条目的关联历史');return e;}
function findEntry(s,id){const item=s.items.find(x=>x.id===id);if(item)return {...item,kind:'item'};const m=getSession(s,id);return {...m,kind:'session',sessionId:m.id};}
function entryRef(s,id){return s.items.find(x=>x.id===id)||getSession(s,id);}
function tagName(v){if(typeof v!=='string'||!v.trim()||v.trim().length>40||/[\x00-\x1f]/.test(v))throw Error('标签名称无效');return v.trim();}
function finish(s,id,result={ok:true}){if(id){s.receipts[id]=result;for(const key of Object.keys(s.receipts).slice(0,-100))delete s.receipts[key];}return save(s).then(()=>result);}
async function extendedService(method,p,id){let s=WorkbenchModel.clone(state);let result={ok:true};const now=new Date().toISOString();
if(method==='ui/labels'){const name=tagName(p.name);if(!['add','rename','delete','color'].includes(p.action))throw Error('标签操作无效');if(p.color&&!['red','orange','amber','green','teal','blue','violet','gray'].includes(p.color))throw Error('标签颜色无效');if(p.action==='add'||p.action==='color')s.ui.labels[name]=p.color||'gray';else if(p.action==='delete'){delete s.ui.labels[name];for(const e of [...s.items,...s.sessions])e.labels=(e.labels||[]).filter(l=>l!==name);}else{const next=tagName(p.newName);if(next!==name&&next in s.ui.labels)throw Error('标签已存在');s.ui.labels[next]=s.ui.labels[name]||'gray';delete s.ui.labels[name];for(const e of [...s.items,...s.sessions])e.labels=[...new Set((e.labels||[]).map(l=>l===name?next:l))];}}
else if(method==='ui/statuses'){if(p.expectedRevision!==s.revision)throw Error('状态配置已变化，请刷新');if(!Array.isArray(p.statuses)||!p.statuses.length)throw Error('至少保留一个状态');const ids=new Set();for(const status of p.statuses){if(typeof status.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(status.id)||ids.has(status.id)||!['todo','doing','done'].includes(status.category))throw Error('状态 ID 或类别无效');tagName(status.name);if(status.color!==undefined&&!['gray','blue','red','teal','green','orange','amber','violet'].includes(status.color))throw Error('状态颜色无效');if(status.hidden!==undefined&&typeof status.hidden!=='boolean')throw Error('列显示设置无效');const previous=s.ui.statuses.find(x=>x.id===status.id);status.color=status.color??previous?.color??(status.category==='doing'?'blue':status.category==='done'?'green':'gray');status.hidden=status.hidden??previous?.hidden??false;ids.add(status.id);}if(['todo','doing','done'].some(c=>!p.statuses.some(s=>s.category===c)))throw Error('必须保留待办、进行中和完成类别');for(const e of [...s.items,...s.sessions])if(!ids.has(e.status)){const to=p.mapping?.[e.status];if(!ids.has(to))throw Error('使用中的旧状态必须明确映射');e.status=to;e.revision=(e.revision||0)+1;}s.ui.statuses=p.statuses;}
else if(method==='entry/edit'){const e=entryRef(s,p.entry);checkRevision(e,p.revision);if(!s.ui.statuses.some(x=>x.id===p.status))throw Error('状态不存在');if(typeof p.note!=='string'||p.note.length>20000)throw Error('备注无效');if(!Array.isArray(p.labels)||p.labels.some(l=>!(l in s.ui.labels)))throw Error('请先创建标签定义');if(p.title!==undefined){if(typeof p.title!=='string'||!p.title.trim()||p.title.length>300)throw Error('标题无效');if(s.items.includes(e))e.title=p.title.trim();else e.displayTitle=p.title.trim();}Object.assign(e,{status:p.status,note:p.note,labels:[...new Set(p.labels)],pinned:!!p.pinned,revision:(e.revision||0)+1,updatedAt:now});if(e.sessionId){const m=s.sessions.find(x=>x.id===e.sessionId);if(m){m.status=e.status;m.note=e.note;m.revision++;}}}
else if(method==='entry/delete'){
 const e=entryRef(s,p.entry);checkRevision(e,p.revision);
 if(p.cascade!==undefined&&typeof p.cascade!=='boolean')throw Error('级联删除选项无效');
 if(p.cascade){
  if(p.expectedRevision!==s.revision)throw Error('关联记录已变化，请刷新后重新确认删除');
  const candidates=new Set(s.items.includes(e)?[e.sessionId,...(e.sessionHistory||[]).map(h=>h.sessionId)].filter(Boolean):[e.id]);
  const shared=new Set();
  for(const item of s.items)if(item!==e&&!item.cascadeRemovedAt)for(const id of [item.sessionId,...(item.sessionHistory||[]).map(h=>h.sessionId)])if(candidates.has(id))shared.add(id);
  for(const m of s.sessions)if(!candidates.has(m.id))for(const child of m.children||[])if(candidates.has(child.id||child.sessionId))shared.add(child.id||child.sessionId);
  for(const record of s.legacyRecords)if(candidates.has(record.cindy?.id))shared.add(record.cindy.id);
  const removed=[...candidates].filter(id=>!shared.has(id));
  s.sessions=s.sessions.filter(m=>!removed.includes(m.id));
  e.cascadeRemovedAt=now;
  result={ok:true,removedSessions:removed.length,retainedSharedSessions:shared.size};
 }
 e.deleted=true;e.revision=(e.revision||0)+1;e.updatedAt=now;
}
else if(method==='entry/move'){
 const all=[...s.items.filter(x=>!x.deleted),...s.sessions.filter(x=>!x.itemId&&!x.deleted&&!x.superseded)];
 const e=all.find(x=>x.id===p.entry);if(!e)throw Error('任务已移除，请刷新');
 if((e.revision||0)!==p.revision)throw Error('记录已变化，请刷新后再移动');
 if(!s.ui.statuses.some(x=>x.id===p.status))throw Error('目标状态已变化，请刷新');
 const placement=p.placement||'end';if(!['before','after','end'].includes(placement))throw Error('插入位置无效');
 let target;if(p.target){target=all.find(x=>x.id===p.target);if(!target||target===e||target.status!==p.status||!!target.pinned!==!!e.pinned)throw Error('排序目标无效；置顶分段保持不变');if((target.revision||0)!==p.targetRevision)throw Error('目标任务已变化，请刷新后再移动');if(placement==='end')throw Error('排序位置无效');}else if(placement!=='end')throw Error('缺少排序目标');
 const moved=all.filter(x=>x!==e&&x.status===p.status&&!!x.pinned===!!e.pinned).sort((a,b)=>(a.order||0)-(b.order||0));
 const index=target?moved.indexOf(target)+(placement==='after'?1:0):moved.length;moved.splice(index,0,e);
 const statusChanged=e.status!==p.status;e.status=p.status;
 for(let i=0;i<moved.length;i++){const row=moved[i];if((row.order||0)!==i||(row===e&&statusChanged)){row.order=i;row.revision=(row.revision||0)+1;row.updatedAt=now;}}
 if(statusChanged&&e.sessionId){const m=s.sessions.find(x=>x.id===e.sessionId);if(m&&m!==e){m.status=e.status;m.revision=(m.revision||0)+1;m.updatedAt=now;}}
 result={ok:true,entry:e.id,status:e.status,order:e.order||0};
}
else if(method==='entry/reorder'){const e=entryRef(s,p.entry);const target=entryRef(s,p.target);if(e.status!==target.status||!!e.pinned!==!!target.pinned)throw Error('只能在相同状态和置顶分段内排序');const all=[...s.items,...s.sessions.filter(m=>!s.items.some(i=>i.sessionId===m.id))].filter(x=>!x.deleted).sort((a,b)=>(a.order||0)-(b.order||0));const group=all.filter(x=>x.status===e.status&&!!x.pinned===!!e.pinned);const moved=group.filter(x=>x.id!==e.id);const index=moved.findIndex(x=>x.id===target.id);if(index<0||e.id===target.id)throw Error('排序目标无效');moved.splice(index+(p.placement==='after'?1:0),0,e);for(let i=0;i<moved.length;i++){moved[i].order=i;moved[i].updatedAt=now;}}
else if(method==='display/hide'){const {a,m}=getLink(s,p);checkRevision(a,p.revision);a.hidden=!!p.hidden;a.revision++;m.revision++;}
else if(method==='display/restore'){for(const m of s.sessions)for(const a of m.associations)if(a.hidden){a.hidden=false;a.revision++;m.revision++;}}
else if(method==='source/import'){
 const rows=WorkbenchSource.normalize(p);let added=0,updated=0;
 for(const row of rows){
  const existing=s.items.find(i=>i.source?.id===row.source.id&&i.externalId===row.externalId);
  if(!existing){s.items.push({...row,id:'source-'+encodeURIComponent(row.source.id)+'/'+encodeURIComponent(row.externalId),status:s.ui.statuses.find(st=>st.category==='todo').id,revision:0,pinned:false,order:s.items.length,createdAt:now,updatedAt:now,sessionHistory:[]});added++;}
  else{const labels=[...new Set([...(existing.labels||[]),...row.labels])];if(JSON.stringify(labels)!==JSON.stringify(existing.labels||[])){existing.labels=labels;existing.revision++;existing.updatedAt=now;updated++;}}
  for(const label of row.labels)if(!Object.hasOwn(s.ui.labels,label))s.ui.labels[label]='gray';
 }
 s.ui.lastSourceImport={at:now,sourceId:p.source.id,count:rows.length};result={added,updated,total:rows.length};
}
else if(method==='entry/create-session'||method==='entry/restart'){const item=s.items.find(i=>i.id===p.entry);if(!item||item.deleted)throw Error('只有尚未删除的来源任务使用此创建入口；主会话可直接打开');if(item.createIntent?.status==='uncertain'&&method==='entry/restart')throw Error('已有创建结果待确认，请先恢复原创建');if(item.sessionId&&method==='entry/create-session')return {sessionId:item.sessionId,existing:true};if(!item.createIntent||item.createIntent.status==='completed'){const generation=(item.generation||0)+(method==='entry/restart'?1:0);item.createIntent={requestKey:'workbench-item-'+item.id+'-'+generation,title:[item.ref,item.title].filter(Boolean).join(' ')+(generation?'（重新开始 '+generation+'）':''),generation,status:'pending'};await save(s);s=WorkbenchModel.clone(state);}const next=s.items.find(i=>i.id===p.entry);try{const receipt=await cindy.tasks.create({requestKey:next.createIntent.requestKey,title:next.createIntent.title});if(next.sessionId&&next.sessionId!==receipt.taskId)next.sessionHistory.push({sessionId:next.sessionId,launch:next.launch||null,source:'restart',at:now});const previous=s.sessions.find(m=>m.id===next.sessionId);const m=s.sessions.find(m=>m.id===receipt.taskId)||newSession(receipt.taskId,next.createIntent.title,true);if(!s.sessions.some(x=>x.id===m.id)){m.associations=previous?WorkbenchModel.clone(previous.associations).map(a=>({...a,id:crypto.randomUUID(),revision:0})):[];s.sessions.push(m);}m.itemId=next.id;if(previous&&previous.id!==m.id)previous.superseded=true;next.sessionId=receipt.taskId;next.generation=next.createIntent.generation;if(method==='entry/restart'){next.status=s.ui.statuses.find(st=>st.category==='todo').id;m.status=next.status;}next.createIntent.status='completed';next.revision++;delete next.launch;next.updatedAt=now;result={sessionId:receipt.taskId,createdEmpty:true};}catch(e){next.createIntent.status='uncertain';await save(s);throw Error('创建结果未确认，重试“创建空会话”将使用同一幂等键；不要另建重复会话');}}
else if(method==='entry/start'){const item=s.items.find(i=>i.id===p.entry);if(item?.deleted||!item?.sessionId)throw Error('先确认条目未删除并创建空会话，再明确发送开发指令');const m=getSession(s,item.sessionId);if(!m.owned)throw Error('该会话不是本插件创建，不能通过此入口发送');if(item.launch&&item.launch.status!=='rejected')throw Error('首条指令已受理或结果不明，请打开会话核对，禁止重放');if(item.launch?.status==='rejected'&&!p.retry)throw Error('上次明确拒绝；请确认后选择重试');if(typeof p.text!=='string'||!p.text.trim()||p.text.length>30000)throw Error('开发指令不能为空或过长');const current=await cindy.tasks.get({taskId:m.id});const revision=current.revision??current.task?.revision;if(!Number.isInteger(revision))throw Error('宿主没有返回可用于发送的任务修订');item.launch={status:'attempting',text:p.text,expectedRevision:revision,requestKey:'workbench-first-'+item.id+'-'+(item.generation||0)+'-'+id,at:now};await save(s);s=WorkbenchModel.clone(state);const next=s.items.find(i=>i.id===p.entry);try{const receipt=await cindy.tasks.send({taskId:m.id,expectedRevision:next.launch.expectedRevision,requestKey:next.launch.requestKey,text:next.launch.text});next.launch={...next.launch,status:'accepted',receipt};next.status=s.ui.statuses.find(st=>st.category==='doing').id;getSession(s,m.id).status=next.status;next.revision++;result={accepted:true,receipt};}catch(e){const rejected=['PERMISSION_DENIED','ROUTE_UNAVAILABLE','INVALID_REQUEST','INVALID_PARAMS','REVISION_CONFLICT','REQUEST_KEY_CONFLICT','TASK_BUSY','DELIVERY_REJECTED'].includes(e.code);next.launch={...next.launch,status:rejected?'rejected':'uncertain',error:e.code||'UNKNOWN'};await save(s);throw Error(rejected?'宿主明确拒绝发送，未标记已启动；请修复后确认重试':'发送结果不明，请打开原会话核对，禁止自动重发');}}
else throw Error('不支持的看板操作');return finish(s,id,result);}

/* Shared sandbox-side automation bridge. It never exposes raw persistence files. */
const WorkbenchAutomation=(()=>{
 function create(options){
  let config=null,timer=null,polling=false,lastError=null,notificationError=null,runningId=null,pendingFinish=null;
  const consumerId=crypto.randomUUID();
  const ops=Object.keys(options.operations);
  async function notify(text,tone){try{const r=await cindy.send({type:'notify',text,tone});notificationError=r?.ok===false?'工作台提示暂未显示':null;}catch{notificationError='工作台提示暂不可用';}}
  async function node(method,params){const r=await cindy.node.request({method,params,timeoutMs:30000});if(!r.ok)throw Error(r.message||'自动化工作进程不可用');return r.result;}
  async function initialize(){return node('automation/configure',{...config,consumerId,operations:ops});}
  async function finishPending(){
   if(!pendingFinish)return;const outcome=pendingFinish;
   try{await node('automation/finish',outcome);}catch{await initialize();await node('automation/finish',outcome);}
   if(pendingFinish===outcome){pendingFinish=null;runningId=null;lastError=null;}
  }
  async function poll(){
   if(polling||!config)return;polling=true;
   try{
    if(pendingFinish){await finishPending();return;}
    let job;try{job=await node('automation/take',{});}catch(e){await initialize();job=await node('automation/take',{});}
    if(job&&!runningId){
     runningId=job.id;
     const work=options.serialize(async()=>{
      let outcome;
      try{
       if(Date.now()-job.createdAt>180000)throw Error('请求已过期，未执行');
       if(!Object.hasOwn(options.operations,job.method))throw Error('此操作未开放');
       const result=await options.operations[job.method](job.params||{},job.id);
       outcome={id:job.id,ok:true,result};
       const changes=result.changes??((result.added||0)+(result.updated||0));
       if(result.ok===false||changes>0)await notify(result.ok===false?'工作台巡检有失败项，请查看自动化记录':'工作台已更新：'+changes+' 项变化，请打开工作台查看',result.ok===false?'warning':'success');
      }catch(e){outcome={id:job.id,ok:false,error:String(e.message||'操作失败').slice(0,300)};await notify('工作台脚本操作失败，请查看自动化记录','error');}
      pendingFinish=outcome;await finishPending();
     });
     work.catch(e=>{lastError=e.message;});
    }
    if(!runningId)lastError=null;
   }catch(e){lastError=e.message;}
   finally{polling=false;}
  }
  function run(){if(!timer)timer=setInterval(poll,1000);}
  async function configure(params){
   if(runningId)throw Error('接口忙，不能改目录');
   if(typeof params.directory!=='string'||!params.directory)throw Error('请输入自动化专用目录');
   const previous=await options.read('automation-queue.json');
   const instanceId=previous.ok?JSON.parse(previous.content).instanceId:crypto.randomUUID();
   const next={directory:params.directory,instanceId};
   const result=await node('automation/configure',{...next,consumerId,operations:ops});
   config={...next,directory:result.directory};await options.write('automation-queue.json',config);run();
   return {configured:true,directory:config.directory,protocol:result.protocol,operations:ops};
  }
  async function start(){
   try{const r=await options.read('automation-queue.json');if(!r.ok)return;config=JSON.parse(r.content);await initialize();run();}
   catch(e){lastError=e.message;if(config)run();}
  }
  return {configure,start,status:()=>({configured:!!config,lastError,notificationError,operations:ops})};
 }
 return {create};
})();

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

const scriptAutomation=startWorkbenchAutomation();
