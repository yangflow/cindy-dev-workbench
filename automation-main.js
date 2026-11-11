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
if(typeof module!=='undefined')module.exports=WorkbenchAutomation;
