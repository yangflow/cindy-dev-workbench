import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const files=[
 'automation-main.js','automation-operations.js','node/automation-queue.cjs','scripts/workbench-automation.cjs','docs/automation.md','ghost.json','main.js','model.js','review-model.js','source-model.js',
 'icons.js','board-drag.js','ui.html','ui.css','ui.js','README.md','README.en.md',
 'CONTRIBUTING.md','docs/architecture.md','docs/sources.md','LICENSE','NOTICE',
 'node/worker.cjs','node/git.cjs','node/repo-discovery.cjs',
 'docs/screenshots/task-board.png','docs/screenshots/cross-repository.png','docs/screenshots/dark-mode.png'
];
export function build(){
 const dest=path.join(root,'dist/plugin');
 // Replace only this build's generated output directory.
 fs.rmSync(dest,{recursive:true,force:true});fs.mkdirSync(dest,{recursive:true});
 for(const file of files){
  const target=path.join(dest,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.copyFileSync(path.join(root,file),target);
 }
 console.log('Built dist/plugin (runtime files only)');return dest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))build();
