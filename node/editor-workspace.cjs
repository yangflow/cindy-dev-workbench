'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
function create(dirs,title,key){
 if(!dirs.length)throw Error('没有可打开的 worktree');
 const name=String(title||'开发工作台').replace(/[\x00-\x1f<>:"/\\|?*]/g,'-').trim().replace(/[. ]+$/,'').slice(0,90)||'开发工作台';
 const parent=path.join(os.tmpdir(),'cindy-workbench-workspaces-'+(process.getuid?.()??'user'));
 const identity=crypto.createHash('sha256').update(String(key||dirs.slice().sort().join('\n'))).digest('hex').slice(0,24);
 const directory=path.join(parent,identity);
 for(const d of [parent,directory]){fs.mkdirSync(d,{mode:0o700,recursive:true});const st=fs.lstatSync(d);if(!st.isDirectory()||st.isSymbolicLink()||(process.getuid&&st.uid!==process.getuid())||(st.mode&0o077))throw Error('工作区文件目录权限无效');}
 const file=path.join(directory,name+'.code-workspace');
 const temp=path.join(directory,crypto.randomUUID()+'.tmp');
 fs.writeFileSync(temp,JSON.stringify({folders:dirs.slice().sort().map(dir=>({name:path.basename(dir),path:dir})),settings:{}},null,2),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);
 return file;
}
module.exports={create};
