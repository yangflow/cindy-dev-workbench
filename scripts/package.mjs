import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build,root,files} from './build.mjs';
const dir=build();
execFileSync(process.execPath,[path.join(root,'scripts/validate-plugin-manifest.mjs'),dir],{stdio:'inherit'});
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'ghost.json'),'utf8'));
const artifact=path.join(root,'dist',`${manifest.id}-${manifest.version}.cindy`);
fs.rmSync(artifact,{force:true});
// Cindy packages are ZIPs with ghost.json at archive root.
execFileSync('zip',['-X','-q',artifact,...files],{cwd:dir,stdio:'inherit'});
const entries=execFileSync('unzip',['-Z1',artifact],{encoding:'utf8'}).trim().split('\n');
if(entries.length!==files.length||files.some(name=>!entries.includes(name)))throw Error('安装包文件清单不一致');
console.log(path.relative(root,artifact));
