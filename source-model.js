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
if(typeof module!=='undefined')module.exports=WorkbenchSource;
