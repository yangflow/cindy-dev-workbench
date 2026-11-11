'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='workbench-script/1',MAX_BYTES=180000;
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const sign=(key,value)=>crypto.createHmac('sha256',key).update(JSON.stringify(value)).digest('hex');
function readJson(file,max=MAX_BYTES){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>max||st.uid!==process.getuid()||(st.mode&0o077))throw Error('接口文件权限或大小无效');return JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
}
function atomic(file,value){
 const temp=file+'.'+crypto.randomUUID()+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);
}
function ensureDirectory(dir){
 const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw Error('队列目录必须由当前用户拥有且权限为 0700');
}
function createQueue(){
 let root,config,active=null,consumerId=null;
 function responseAt(directory,connection,request,ok,result,error){const payload={protocol:VERSION,id:request.id,requestHash:sign(connection.token,request),ok,...(ok?{result}:{error})};atomic(path.join(directory,'outbox',request.id+'.json'),{payload,signature:sign(connection.token,payload)});}
 function response(request,ok,result,error){responseAt(root,config,request,ok,result,error);}
 function heartbeatAt(directory,connection,busy){atomic(path.join(directory,'heartbeat.json'),{protocol:VERSION,instanceId:connection.instanceId,at:Date.now(),busy});}
 function heartbeat(){heartbeatAt(root,config,!!active);}
 function configure(params){
  if(typeof params.directory!=='string'||!path.isAbsolute(params.directory)||!validId(params.instanceId)||!validId(params.consumerId||params.instanceId)||!Array.isArray(params.operations)||params.operations.some(x=>!['status','import','patrol','sync'].includes(x)))throw Error('接口配置无效');
  fs.mkdirSync(params.directory,{recursive:true,mode:0o700});ensureDirectory(params.directory);const nextRoot=fs.realpathSync(params.directory),nextConsumer=params.consumerId||params.instanceId;
  if(active){if(nextRoot!==root||config.instanceId!==params.instanceId)throw Error('接口忙，不能改目录');if(nextConsumer===consumerId)return {directory:root,protocol:VERSION,operations:config.operations};}
  const file=path.join(nextRoot,'connection.json');let nextConfig;
  if(fs.existsSync(file)){nextConfig=readJson(file);if(nextConfig.protocol!==VERSION||nextConfig.instanceId!==params.instanceId||typeof nextConfig.token!=='string'||!/^[a-f0-9]{64}$/.test(nextConfig.token))throw Error('该队列属于其他插件实例');}
  else{if(fs.readdirSync(nextRoot).length)throw Error('请选择专用空目录');nextConfig={protocol:VERSION,instanceId:params.instanceId,token:crypto.randomBytes(32).toString('hex')};}
  nextConfig={...nextConfig,operations:params.operations};
  for(const name of ['inbox','processing','outbox']){const dir=path.join(nextRoot,name);fs.mkdirSync(dir,{recursive:true,mode:0o700});ensureDirectory(dir);}
  for(const name of fs.readdirSync(path.join(nextRoot,'processing')).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n))){
   const processingFile=path.join(nextRoot,'processing',name),envelope=readJson(processingFile),request=envelope.payload;
   if(request&&validId(request.id)&&name===request.id+'.json'&&envelope.signature===sign(nextConfig.token,request)&&!fs.existsSync(path.join(nextRoot,'outbox',name)))responseAt(nextRoot,nextConfig,request,false,null,'RESULT_UNKNOWN：插件曾重启，请核对工作台；本接口不会重放在途请求');
   fs.unlinkSync(processingFile);
  }
  atomic(file,nextConfig);heartbeatAt(nextRoot,nextConfig,false);
  root=nextRoot;config=nextConfig;consumerId=nextConsumer;active=null;
  return {directory:root,protocol:VERSION,operations:config.operations};
 }
 function take(){
  if(!config)throw Error('AUTOMATION_NOT_CONFIGURED');heartbeat();if(active)return active;
  const names=fs.readdirSync(path.join(root,'inbox')).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,32);
  for(const name of names){
   const file=path.join(root,'inbox',name);let request,authenticated=false;
   try{
    const envelope=readJson(file);request=envelope.payload;
    if(!request||!validId(request.id)||name!==request.id+'.json'||request.protocol!==VERSION||request.instanceId!==config.instanceId||typeof envelope.signature!=='string'||envelope.signature.length!==64||!crypto.timingSafeEqual(Buffer.from(envelope.signature),Buffer.from(sign(config.token,request))))throw Error('请求认证失败');
    authenticated=true;
    if(!config.operations.includes(request.method)||!Number.isFinite(request.createdAt)||Math.abs(Date.now()-request.createdAt)>180000)throw Error('操作未开放或请求已过期');
    const done=path.join(root,'outbox',name);
    if(fs.existsSync(done)){const previous=readJson(done,800000);if(previous.payload?.requestHash!==sign(config.token,request))throw Error('请求 ID 冲突');fs.unlinkSync(file);continue;}
    fs.renameSync(file,path.join(root,'processing',name));active=request;heartbeat();return request;
   }catch(e){if(authenticated&&request&&validId(request.id)&&config.operations.includes(request.method)&&!fs.existsSync(path.join(root,'outbox',name)))response(request,false,null,'请求认证、范围或期限校验失败');if(fs.existsSync(file))fs.unlinkSync(file);}
  }
  return null;
 }
 function finish(params){
  if(!config||!validId(params.id))throw Error('请求身份不一致');
  const done=path.join(root,'outbox',params.id+'.json');
  if(fs.existsSync(done)){
   const previous=readJson(done,800000);
   if(previous.payload?.id!==params.id||previous.payload?.protocol!==VERSION||previous.signature!==sign(config.token,previous.payload)||(active?.id===params.id&&previous.payload.requestHash!==sign(config.token,active)))throw Error('完成回执认证失败');
   if(active?.id===params.id){fs.rmSync(path.join(root,'processing',params.id+'.json'),{force:true});active=null;}heartbeat();return {ok:true};
  }
  if(!active||active.id!==params.id)throw Error('请求身份不一致');
  const result=params.result;
  if(Buffer.byteLength(JSON.stringify(result??null))>700000)response(active,false,null,'结果过大，请缩小查询范围');
  else response(active,params.ok===true,result,params.error||'工作台操作失败');
  fs.rmSync(path.join(root,'processing',active.id+'.json'),{force:true});active=null;heartbeat();return {ok:true};
 }
 return {configure,take,finish,handle(method,params){if(method==='automation/configure')return configure(params);if(method==='automation/take')return take();if(method==='automation/finish')return finish(params);throw Error('接口操作无效');}};
}
module.exports={createQueue,readJson,atomic,sign,VERSION,MAX_BYTES};
