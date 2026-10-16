// Auth recovery metadata is stored OUTSIDE the Baileys auth directory.
// Never upload, log or return credentials or Signal keys. Never auto-restore a revoked session.
import {randomBytes} from 'node:crypto';
import {readdir,readFile,writeFile,mkdir,rename,copyFile,chmod,stat} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';

export const recoveryHome=sessionDir=>resolve(sessionDir)+'.recovery';
const fileName=/^[A-Za-z0-9_().@+-]{1,200}\.json$/;
const iso=()=>new Date().toISOString();
async function secureDir(dir){await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);}
async function writeAtomic(file,value){
 const dir=resolve(file,'..'),temp=join(dir,'.writing-'+randomBytes(8).toString('hex'));
 await secureDir(dir);
 try{await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(temp,file);}
 catch(error){throw error;}
}
async function safeJsonFile(path){
 try{return JSON.parse(await readFile(path,'utf8'));}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export function interpretDisconnect(lastDisconnect){
 const error=lastDisconnect?.error;
 // Baileys lastDisconnect.error is usually already a Boom; constructing a
 // new Boom around it can mask the actual status code.
 const candidates=[error?.output?.statusCode,error?.statusCode,error?.cause?.output?.statusCode,error?.data?.statusCode];
 const code=candidates.find(n=>Number.isInteger(n)&&n>=100&&n<=599)??null;
 const reason=code===401?'logged_out':code===440?'connection_replaced':code===403?'forbidden':
  code===515?'restart_required':code===408?'timed_out':code===428?'connection_closed':
  code===503?'service_unavailable':'connection_lost';
 const needsReview=[401,403,440].includes(code);
 return {code,reason,needsReview,autoRetry:!needsReview};
}
export async function registeredAuthPresent(sessionDir){
 try{
  const cred=await safeJsonFile(join(sessionDir,'creds.json'));
  return cred?.registered===true;
 }catch{return false;}
}
export async function readRecoveryHold(sessionDir){
 const record=await safeJsonFile(join(recoveryHome(sessionDir),'quarantine.json'));
 if(!record)return null;
 if(!['logged_out','forbidden','connection_replaced'].includes(record.reason))throw Error('whatsapp_recovery_metadata_invalid');
 return {reason:record.reason,code:record.code??null,since:record.since};
}
export async function holdSession(sessionDir,decision){
 const existing=await readRecoveryHold(sessionDir);
 if(existing)return existing;
 const value={reason:decision.reason,code:decision.code,since:iso()};
 await writeAtomic(join(recoveryHome(sessionDir),'quarantine.json'),value);
 return value;
}
export async function clearHoldOnConnected(sessionDir){
 const home=recoveryHome(sessionDir),hold=await readRecoveryHold(sessionDir);
 if(!hold)return;
 // Preserve a chronological incident record instead of deleting it.
 const archived=join(home,'recovered-'+Date.now()+'-'+randomBytes(4).toString('hex')+'.json');
 await rename(join(home,'quarantine.json'),archived);
}
export async function reserveSingleRecoveryProbe(sessionDir){
 const hold=await readRecoveryHold(sessionDir);
 if(!hold||hold.reason!=='logged_out')throw Error('whatsapp_recovery_not_eligible');
 if(!await registeredAuthPresent(sessionDir))throw Error('whatsapp_original_auth_missing');
 const file=join(recoveryHome(sessionDir),'one-shot-'+String(hold.since).replace(/[^0-9]/g,'')+'.json');
 try{await writeFile(file,JSON.stringify({attempted_at:iso()}),{flag:'wx',mode:0o600});}
 catch(e){if(e.code==='EEXIST')throw Error('whatsapp_recovery_probe_already_used');throw e;}
 return {ok:true,attempted:true};
}
export async function backupAuthState(sessionDir,{maximum=5}={}){
 const home=recoveryHome(sessionDir);
 if(!await registeredAuthPresent(sessionDir))return {ok:false,reason:'auth_not_registered'};
 await secureDir(home);
 const previous=(await readdir(home)).filter(x=>/^snapshot-\d{13}-[0-9a-f]{8}$/.test(x));
 if(previous.length>=maximum)return {ok:false,reason:'snapshot_limit',backups:previous.length};
 const entries=await readdir(sessionDir,{withFileTypes:true});
 // Never recurse into 'sessions/', and never copy symlinks, temp files or registry.
 const files=entries.filter(e=>e.isFile()&&fileName.test(e.name)&&e.name!=='sessions.json');
 if(!files.some(f=>f.name==='creds.json')||files.length>5000)return {ok:false,reason:'auth_files_unavailable'};
 const stamp='snapshot-'+Date.now()+'-'+randomBytes(4).toString('hex'),stage=join(home,'.pending-'+stamp),destination=join(home,stamp);
 await mkdir(stage,{mode:0o700});
 try{
  for(const entry of files){
   const from=join(sessionDir,entry.name),size=(await stat(from)).size;
   if(size<1||size>2*1024*1024)throw Error('whatsapp_auth_snapshot_bad_size');
   const to=join(stage,entry.name);
   await copyFile(from,to);await chmod(to,0o600);
  }
  await writeFile(join(stage,'snapshot-manifest'),JSON.stringify({created_at:iso(),files:files.length}),{mode:0o600});
  await rename(stage,destination);
  return {ok:true,backups:previous.length+1,file_count:files.length};
 }catch(e){
  // Leave a partially written snapshot isolated from valid snapshots; do not
  // erase or move original authentication data.
  throw Error('whatsapp_auth_snapshot_failed');
 }
}
export async function recoverySummary(sessionDir){
 const home=recoveryHome(sessionDir);
 let backups=0;
 try{backups=(await readdir(home)).filter(x=>/^snapshot-\d{13}-[0-9a-f]{8}$/.test(x)).length;}
 catch(e){if(e.code!=='ENOENT')throw e;}
 return {registered_auth_present:await registeredAuthPresent(sessionDir),
  quarantine:await readRecoveryHold(sessionDir),backup_count:backups,
  note:'Backups can protect against local loss but cannot restore server-revoked WhatsApp authorization.'};
}
