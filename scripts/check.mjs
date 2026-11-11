import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {root,files} from './build.mjs';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'ghost.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.version!==manifest.version)throw Error('package.json 与 ghost.json 版本必须一致');
execFileSync(process.execPath,[path.join(root,'scripts/validate-plugin-manifest.mjs'),root],{stdio:'inherit'});
for(const name of files){
 if(!fs.statSync(path.join(root,name)).isFile())throw Error(`缺少随包文件 ${name}`);
 if(/\.(js|cjs)$/.test(name))execFileSync(process.execPath,['--check',path.join(root,name)],{stdio:'inherit'});
}
for(const file of [manifest.entry,manifest.node.entry,manifest.mainView.html,manifest.taskView.html])if(!files.includes(file))throw Error(`缺少声明文件 ${file}`);
const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
for(const name of ['model.js','review-model.js','source-model.js','automation-main.js','automation-operations.js']){
 const source=fs.readFileSync(path.join(root,name),'utf8').replace(/\nif\(typeof module!=='undefined'\)module.exports=(?:WorkbenchSource|WorkbenchAutomation);\n$/,'').trim();
 if(!main.includes(source))throw Error(`${name} 与 main.js 内嵌模型不一致`);
}
console.log('Version, manifest entries, syntax and model copies checked');
