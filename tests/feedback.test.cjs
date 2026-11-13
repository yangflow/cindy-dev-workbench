const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ui.js'),'utf8');
function transport(fetch){
 let id=0;const timers=new Map(),posts=[];
 const context={fetch,AbortController,crypto:{randomUUID:()=>String(++id)},BroadcastChannel:class{constructor(){context.channel=this;}postMessage(msg){posts.push(msg);}},setInterval:fn=>{timers.set(++id,{fn,interval:true});return id;},clearInterval:n=>timers.delete(n),setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:n=>timers.delete(n)};
 vm.createContext(context);vm.runInContext(source.slice(0,source.indexOf('\nconst $=')),context);
 return {context,posts,timers,request:(method,params)=>{context.input={method,params};return vm.runInContext('request(input.method,input.params)',context);},reply:result=>context.channel.onmessage({data:{type:'response',id:posts[0].id,ok:true,result}})};
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('wake HTTP failure never broadcasts a write',async()=>{const h=transport(async()=>({ok:false,status:503}));await assert.rejects(h.request('session/create',{title:'fixture'}),/HTTP 503/);assert.equal(h.posts.length,0);assert.equal(h.timers.size,0);});
test('a hung wake fails visibly before broadcasting and clears timers',async()=>{const h=transport(()=>new Promise(()=>{}));const result=h.request('association/save',{});const rejection=assert.rejects(result,/唤醒宿主超时.*尚未发送/);[...h.timers.values()].find(t=>t.ms===15000).fn();await rejection;assert.equal(h.posts.length,0);assert.equal(h.timers.size,0);});
test('transport resends one request identity, stops after receipt and ignores late duplicates',async()=>{const h=transport(async()=>({ok:true}));const result=h.request('session/create',{title:'fixture'});await flush();[...h.timers.values()].find(t=>t.interval).fn();assert.equal(h.posts.length,2);assert.equal(h.posts[0].id,h.posts[1].id);h.reply({sessionId:'fixture'});assert.equal((await result).sessionId,'fixture');h.reply({sessionId:'duplicate'});assert.equal(h.timers.size,0);});
test('unknown result times out without replaying or leaving timers running',async()=>{const h=transport(async()=>({ok:true}));const result=h.request('session/sync',{});await flush();const rejection=assert.rejects(result,/结果待确认.*核对原操作/);[...h.timers.values()].find(t=>t.ms===300000).fn();await rejection;assert.equal(h.posts.length,1);assert.equal(h.timers.size,0);});
test('shared action blocks concurrent new controls and preserves confirmed success when refresh fails',async()=>{
 const notices=[],attrs=new Map();let resolve,calls=0;
 const context={notice:t=>notices.push(t),request:()=>{calls++;return new Promise(r=>resolve=r);},load:async()=>{throw Error('fixture refresh failure');}};
 vm.createContext(context);vm.runInContext('let actionPending=false;'+source.slice(source.indexOf('async function action('),source.indexOf('\nfunction phaseSelect')),context);
 const b=()=>({disabled:false,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)});
 context.first=b();context.second=b();const first=vm.runInContext("action(first,'session/create',{})",context);assert.equal(context.first.disabled,true);
 const second=vm.runInContext("action(second,'session/create',{})",context);await flush();assert.equal(calls,1);assert.equal(await second,null);
 resolve({sessionId:'fixture'});assert.equal((await first).sessionId,'fixture');assert.match(notices.at(-1),/已创建空主会话.*界面刷新未完成.*勿重复提交/);assert.equal(context.first.disabled,false);assert.equal(attrs.size,0);
});
