'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),git=require('./git.cjs');
const SKIP=new Set(['node_modules','vendor','dist','build','target','coverage']);
async function discover(root,{maxDepth=3,maxDirectories=3000,maxRepos=200}={}){
 if(!path.isAbsolute(root)||maxDepth<1||maxDepth>5)throw Error('请选择真实上级目录，扫描层级应为 1–5');
 const actual=await fs.realpath(root);if(actual!==path.resolve(root)||(await fs.lstat(root)).isSymbolicLink())throw Error('不接受符号链接目录，请选择真实目录');
 const queue=[{dir:actual,depth:0}],repos=[],warnings=[];let visited=0,limited=false;
 while(queue.length){if(visited>=maxDirectories||repos.length>=maxRepos){limited=true;break;}const {dir,depth}=queue.shift();visited++;
 try{if((await fs.realpath(dir))!==dir||(await fs.lstat(dir)).isSymbolicLink()){warnings.push({path:dir,message:'目录身份已变化，已跳过'});continue;}const marker=await fs.lstat(path.join(dir,'.git')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(marker&&!marker.isSymbolicLink()&&(marker.isDirectory()||marker.isFile())){try{repos.push(await git.register(dir));}catch{warnings.push({path:dir,message:'Git 根目录校验失败'});}continue;}
 if(depth>=maxDepth)continue;
 const children=await fs.readdir(dir,{withFileTypes:true});children.sort((a,b)=>a.name.localeCompare(b.name));for(const entry of children){if(entry.name.startsWith('.')||SKIP.has(entry.name)||entry.isSymbolicLink()||!entry.isDirectory())continue;const child=path.join(dir,entry.name);if((await fs.realpath(child))!==child){warnings.push({path:child,message:'目录身份已变化，已跳过'});continue;}if(queue.length+visited>=maxDirectories){limited=true;continue;}queue.push({dir:child,depth:depth+1});}
 }catch{warnings.push({path:dir,message:'目录不可读取，已跳过'});}
 }
 return {root:actual,repos,visited,maxDepth,limited,warnings};
}
module.exports={discover};
