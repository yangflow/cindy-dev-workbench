const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./support.cjs');const {normalize}=require('../source-model.js');
const payload=(id='tracker-a')=>({source:{id,name:'需求清单'},items:[{id:'104',ref:'REQ-104',title:'统一订单查询接口',labels:['需求','迭代 A'],url:'https://example.com/issues/104'}]});
test('same external ID from different sources is isolated; same-source imports preserve sessions and manual edits',async()=>{
 const h=harness();await h.call('source/import',payload());await h.call('source/import',payload('tracker-b'));
 let s=await h.call('state/read');assert.equal(s.items.length,2);assert.notEqual(s.items[0].id,s.items[1].id);
 const item=s.items[0];await h.call('entry/create-session',{entry:item.id});s=await h.call('state/read');
 await h.call('entry/edit',{entry:item.id,revision:s.items[0].revision,title:'人工标题',status:'doing',note:'保留',labels:['需求'],pinned:true});
 const before=await h.call('state/read');const next=payload();next.items[0].labels=['新增'];
 await h.call('source/import',next);s=await h.call('state/read');assert.equal(s.items[0].title,'人工标题');assert.equal(s.items[0].status,'doing');assert.equal(s.items[0].note,'保留');assert.equal(s.items[0].pinned,true);assert.equal(s.items[0].sessionId,before.items[0].sessionId);assert.deepEqual(s.sessions,before.sessions);assert.equal(h.created(),1);
 await h.call('entry/delete',{entry:item.id,revision:s.items[0].revision});await h.call('source/import',payload());assert.equal((await h.call('state/read')).items[0].deleted,true);
});
test('malformed batches, duplicate keys and credential-bearing URLs are rejected before any writes',async()=>{
 const h=harness();const before=await h.call('state/read');
 const bad=[{source:{id:'bad/source'},items:[]},{...payload(),items:[payload().items[0],payload().items[0]]},...['javascript:alert(1)','https://user:secret@example.com'].map(url=>({...payload(),items:[{...payload().items[0],url}]})),{...payload(),items:[{...payload().items[0],labels:['__proto__']}]},{...payload(),items:[{...payload().items[0],title:'x'.repeat(301)}]}];
 for(const input of bad){await assert.rejects(h.call('source/import',input));assert.deepEqual(await h.call('state/read'),before);}
 assert.throws(()=>normalize({...payload(),items:Array(501).fill(payload().items[0])}));
});
test('tasks without display IDs create clean session titles and imports never start development',async()=>{
 const h=harness();await h.call('source/import',{source:{id:'notes'},items:[{id:'one',title:'整理接口文档'}]});
 assert.equal(h.created(),0);assert.equal(h.calls.length,0);
 let title;h.context.cindy.tasks.create=async p=>{title=p.title;return {taskId:'host-created'};};
 await h.call('entry/create-session',{entry:(await h.call('state/read')).items[0].id});assert.equal(title,'整理接口文档');
});
