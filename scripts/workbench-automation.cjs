'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJson,atomic,sign,VERSION,MAX_BYTES}=require('../node/automation-queue.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function submit(directory,method,params={},timeoutMs=160000){
 const root=fs.realpathSync(directory),connection=readJson(path.join(root,'connection.json'));
 if(connection.protocol!==VERSION||!connection.operations.includes(method))throw Error('插件未开放此脚本操作');
 const heartbeat=readJson(path.join(root,'heartbeat.json'));
 if(heartbeat.instanceId!==connection.instanceId||Date.now()-heartbeat.at>15000)throw Error('工作台接口未运行，请启动 Cindy 并启用插件');
 const payload={protocol:VERSION,instanceId:connection.instanceId,id:crypto.randomUUID(),method,params,createdAt:Date.now()};
 const envelope={payload,signature:sign(connection.token,payload)};
 if(Buffer.byteLength(JSON.stringify(envelope))>MAX_BYTES)throw Error('请求过大，请拆分任务批次');
 const request=path.join(root,'inbox',payload.id+'.json'),reply=path.join(root,'outbox',payload.id+'.json');
 atomic(request,envelope);
 const until=Date.now()+timeoutMs;
 while(Date.now()<until){
  if(fs.existsSync(reply)){
   const frame=readJson(reply,800000),response=frame.payload;
   if(!response||frame.signature!==sign(connection.token,response)||response.id!==payload.id||response.requestHash!==sign(connection.token,payload))throw Error('响应认证失败');
   if(!response.ok)throw Error(response.error||'插件操作失败');
   return response.result;
  }
  await sleep(150);
 }
 // Never replay a request whose execution may already have started.
 throw Error('工作台结果未确认，请核对运行记录，不要自动重放');
}
function summary(operation,result){
 if(operation==='import'||operation==='sync')return `同步完成：新增 ${result.added||0} 项，标签更新 ${result.updated||0} 项`;
 if(operation==='patrol')return `巡检完成：${result.sessions||0} 个需求，${result.checked||0} 个关联，${result.candidates||0} 个清理预演候选，${result.failed||0} 项失败`;
 return '工作台脚本接口就绪';
}
function errorSummary(error){if(error.code==='ENOENT')return '脚本接口目录或连接文件不存在，请先启动 Cindy 并配置接口';if(error.code==='EACCES'||error.code==='EPERM')return '脚本接口访问被拒绝，请核对专用目录权限';return String(error.message).slice(0,500);}
async function main(){
 const args=process.argv.slice(2),option=key=>args[args.indexOf(key)+1];
 const directory=args.includes('--queue')?option('--queue'):null;
 const operation=args.includes('--operation')?option('--operation'):null;
 if(!directory||!['status','import','patrol','sync'].includes(operation))throw Error('需要 --queue 专用目录 与 --operation 操作');
 let params={};if(operation==='import')params=JSON.parse(fs.readFileSync(0,'utf8'));
 const result=await submit(directory,operation,params);
 if(result.ok===false)throw Error('巡检未完整成功，请核对工作台中的失败项');
 process.stdout.write(JSON.stringify({protocol:'cindy-script/1',type:'complete',status:'success',resultText:summary(operation,result)})+'\n');
}
if(require.main===module)main().catch(e=>{process.stderr.write(errorSummary(e)+'\n');process.stdout.write(JSON.stringify({protocol:'cindy-script/1',type:'complete',status:'failed',resultText:errorSummary(e)})+'\n');process.exitCode=1;});
module.exports={submit,summary};
