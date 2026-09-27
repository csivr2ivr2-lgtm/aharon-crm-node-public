import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
// Reports only file and line, never matched secret values. Heuristic, not proof of absence.
const patterns=[
 /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AIza[A-Za-z0-9_-]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AKIA[A-Z0-9]{16})\b/,
 /["']?(?:password|passwd|access_token|refresh_token|api_key|client_secret|session_secret|db_password)["']?\s*[:=]\s*["'][^"'\n]{12,}["']/i,
 /:\/\/[^\s/:]+:[^\s/@]{4,}@/,
 /["'](?:noiseKey|signedIdentityKey|signedPreKey)["']\s*:/
];
const findings=[];let scanned=0;
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(['node_modules','.git','runtime'].includes(e.name))continue;const path=join(dir,e.name);if(e.isDirectory())await walk(path);else{
 if(path.includes('scan-secrets.mjs')||path.endsWith('package-lock.json'))continue;
 if(e.name==='.env'||/\.(pem|key|enc|onnx|safetensors)$/.test(e.name)){findings.push({file:path,line:0,reason:'sensitive_file'});continue;}
 const text=await readFile(path,'utf8');scanText(text,path);}}
}
function scanText(text,path){scanned++;text.split('\n').forEach((line,index)=>{if(patterns.some(p=>p.test(line)))findings.push({file:path,line:index+1,reason:'potential_secret'});});}
if(process.argv[2]){const history=JSON.parse(await readFile(process.argv[2],'utf8'));for(const entry of history){const data=JSON.parse(entry.result.content.find(c=>c.type==='text').text);for(const file of data.files||[])scanText(file.patch||'',entry.sha+':'+file.filename);}}
else await walk('.');
console.log(JSON.stringify({scanned,findings},null,2));process.exitCode=findings.length?1:0;
