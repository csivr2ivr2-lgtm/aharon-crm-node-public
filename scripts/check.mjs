import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const files=[];
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','runtime'].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else files.push(path);}}
await walk('.');let failures=0;
for(const file of files){
 if(/.(?:js|mjs|cjs)$/.test(file)){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){failures++;console.error(file,r.stderr);}}
 if(file.endsWith('.php')){failures++;console.error('Legacy executable:',file);}
 if(file.startsWith('src/')||file==='README.md'){
  const text=await readFile(file,'utf8');
  for(const old of ['service'+'.php','WORKSPACE_'+'BASE_URL','WORKSPACE_'+'SERVICE_TOKEN','register'+'SearchBackendRoutes','server-'+'unified'])if(text.includes(old)){failures++;console.error('Legacy reference:',file);}
 }
}
console.log(`Checked ${files.length} source files; ${failures} failures`);process.exitCode=failures?1:0;
