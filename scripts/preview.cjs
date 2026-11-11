// Isolated screenshot preview. Only fictional in-memory data; no host or real repositories.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('../tests/support.cjs');
const root=path.resolve(__dirname,'..');
const statuses=[{id:'todo',name:'待办',color:'gray',category:'todo'},{id:'doing',name:'进行中',color:'blue',category:'doing'},{id:'done',name:'已完成',color:'green',category:'done'},{id:'archived',name:'已归档',color:'gray',category:'done'}];
const link=(id,repoId,state,validation='not-run')=>({id,repoId,revision:0,branch:'feat/unified-order-query',worktree:'/example/worktrees/'+repoId,reviews:['https://example.com/pull/104'],validation:{status:validation,head:validation==='passed'?'7ab42c1':null,note:validation==='passed'?'单元测试与接口契约检查通过':'等待验证'},snapshot:{head:'7ab42c1',commit:'7ab42c1 feat: unify order query',dirty:false,reviews:{status:'ok',items:[{id:104,state,url:'https://example.com/pull/104',head:'7ab42c1',target:'main'}]},checkedAt:'2026-01-15T09:30:00Z'}});
const task=(id,ref,title,status,labels,note,extra={})=>({id,externalId:ref,source:{id:'sample-work',name:'需求清单'},ref,title,status,labels,note,revision:0,pinned:false,order:0,sessionHistory:[],url:'https://example.com/work/'+ref,updatedAt:'2026-01-15T09:30:00Z',...extra});
const state={version:2,revision:0,ui:{statuses,labels:{'需求':'blue','缺陷':'red','体验':'teal','迭代 A':'gray'}},items:[
 task('req-104','REQ-104','统一订单查询接口','doing',['需求','迭代 A'],'打通接口、管理端与共享契约，保持分页与筛选规则一致。',{sessionId:'main-a',pinned:true}),
 task('issue-38','ISSUE-38','修复导出文件名的编码问题','todo',['缺陷'],'覆盖中文、空格与特殊字符的下载场景。'),
 task('doc-12','DOC-12','补齐跨仓接口变更说明','todo',['需求'],'记录兼容策略、验证步骤与上线顺序。'),
 task('req-98','REQ-98','优化多语言表单的错误提示','done',['体验'],'字段定位、提示文案与键盘操作已完成检查。',{sessionId:'main-b'}),
 task('req-81','REQ-81','统一操作日志字段','archived',['需求'],'字段契约与历史记录兼容检查已完成。')
],sessions:[
 {id:'main-a',itemId:'req-104',label:'REQ-104 统一订单查询接口',status:'doing',owned:true,revision:0,children:[],legacyIds:[],associations:[link('a','api','OPEN','passed'),link('b','console','MERGED','passed'),link('c','contracts','OPEN')]},
 {id:'main-b',itemId:'req-98',label:'REQ-98 优化多语言表单的错误提示',status:'done',owned:true,revision:0,children:[],legacyIds:[],associations:[link('d','console','MERGED','passed')]}
],repos:[{id:'api',name:'api-service',path:'/example/projects/api-service',provider:'github'},{id:'console',name:'console-web',path:'/example/projects/console-web',provider:'github'},{id:'contracts',name:'shared-contracts',path:'/example/projects/shared-contracts',provider:'github'}],legacyRecords:[],receipts:{},pendingCreates:{}};
const h=harness({'state-a.json':JSON.stringify(state)},{worker:async()=>{throw Error('演示环境不调用外部工具');}});
let queue=Promise.resolve();
const assets=new Set(['ui.js','ui.css','icons.js','review-model.js','board-drag.js']);
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/wake'){res.end('{}');return;}
  if(url.pathname==='/rpc'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1000000)throw Error('请求过大');}
   const msg=JSON.parse(body);queue=queue.then(async()=>{
    try{const result=await h.call(msg.method,msg.params,msg.id);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({type:'response',id:msg.id,ok:true,result}));}
    catch(e){res.end(JSON.stringify({type:'response',id:msg.id,ok:false,error:e.message}));}
   });return;
  }
  if(url.pathname==='/preview-bridge.js'){
   res.setHeader('Content-Type','text/javascript');res.end("window.BroadcastChannel=class{postMessage(message){fetch('/rpc',{method:'POST',body:JSON.stringify(message)}).then(r=>r.json()).then(data=>this.onmessage?.({data}));}};");return;
  }
  if(url.pathname==='/'){
   const dark=url.searchParams.get('theme')==='dark';
   const theme=dark?'--panel-bg:#202622;--surface:#252b27;--text-primary:#e4ebe5;--text-secondary:#a6b0a8;--border-default:#3e4540;':'--panel-bg:#f8f9f6;--surface:#ffffff;--text-primary:#202321;--text-secondary:#727973;--border-default:#dfe3df;';
   let html=fs.readFileSync(path.join(root,'ui.html'),'utf8').replace('<script src="icons.js">','<script src="/preview-bridge.js"></script><script src="icons.js">');
   html=html.replace('<link rel="stylesheet" href="ui.css">','<link rel="stylesheet" href="ui.css"><style>:root{'+theme+'}html{background:var(--panel-bg)}</style>');
   res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;
  }
  const name=url.pathname.slice(1);
  if(assets.has(name)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(root,name)));return;}
  res.writeHead(404);res.end();
 }catch{res.writeHead(500);res.end('预览请求失败');}
});
server.listen(0,'127.0.0.1',()=>console.log(`Fictional preview: http://127.0.0.1:${server.address().port}`));
