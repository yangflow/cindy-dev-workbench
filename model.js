/* Pure, lossless migration shared by the sandbox and fixture tests. */
const WorkbenchModel=(()=>{
 const clone=x=>JSON.parse(JSON.stringify(x));
 function migrate(old){if(old.version===2)return clone(old);if(old.version!==1)throw Error('未知数据版本');const s={version:2,revision:old.revision,sessions:[],repos:clone(old.repos),legacyRecords:clone(old.tasks),receipts:{},pendingCreates:{},migration:{from:1,sourceRevision:old.revision,backup:'migration-v1-r'+old.revision+'.json'}};
 for(const t of old.tasks){if(!t.cindy?.id)continue;let main=s.sessions.find(x=>x.id===t.cindy.id);if(!main){main={id:t.cindy.id,label:t.cindy.label||t.title,owned:!!t.cindy.owned,status:t.status||'todo',note:'',revision:0,verification:'legacy-pending',associations:[],children:[],legacyIds:[]};s.sessions.push(main);}main.legacyIds.push(t.id);if(t.repo)main.associations.push({id:'legacy-'+t.id,repoId:t.repo,branch:'',worktree:'',reviews:[],validation:{status:'not-run',note:'旧版未记录验证结果',head:null},revision:0,legacyTaskId:t.id,missingRepo:!s.repos.some(r=>r.id===t.repo)});}
 return s;}
 function validationStale(a){return a.validation?.status==='passed'&&(!a.validation.head||a.validation.head!==a.snapshot?.head);}
 return {clone,migrate,validationStale};
})();
