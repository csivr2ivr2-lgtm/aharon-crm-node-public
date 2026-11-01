// The connector stores only the minimum Baileys auth state required for a linked device.
// No automatic snapshots, quarantine or replay of revoked credentials.
import {readdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export const recoveryHome=sessionDir=>resolve(sessionDir)+'.recovery';
const authJson=name=>typeof name==='string'&&name.length<=240&&name.endsWith('.json')&&name!=='sessions.json'&&!name.startsWith('.');

export function interpretDisconnect(lastDisconnect){
 const error=lastDisconnect?.error;
 const candidates=[error?.output?.statusCode,error?.statusCode,error?.cause?.output?.statusCode,error?.data?.statusCode];
 const code=candidates.find(n=>Number.isInteger(n)&&n>=100&&n<=599)??null;
 const reason=code===401?'logged_out':code===440?'connection_replaced':code===403?'forbidden':
  code===515?'restart_required':code===408?'timed_out':code===428?'connection_closed':
  code===503?'service_unavailable':'connection_lost';
 const needsReview=[401,403,440].includes(code);
 return {code,reason,needsReview,autoRetry:!needsReview};
}

export async function registeredAuthPresent(sessionDir){
 try{return JSON.parse(await readFile(join(sessionDir,'creds.json'),'utf8'))?.registered===true;}
 catch{return false;}
}

// Remove *legacy* recovery data, never the active auth, other sessions or registry.
// Safe to invoke on each start, including after a server restart.
export async function removeLegacyRecoveryArtifacts(sessionDir){
 await rm(recoveryHome(sessionDir),{recursive:true,force:true});
}

// Explicit user-requested deletion. The main session shares its parent directory
// with the secondary-session registry, so delete only its own auth JSON files.
export async function clearSessionLocalAuth(sessionDir,{preserveRegistry=false}={}){
 if(preserveRegistry){
  let entries=[];
  try{entries=await readdir(sessionDir,{withFileTypes:true});}
  catch(error){if(error.code!=='ENOENT')throw error;}
  for(const entry of entries){
   if(entry.isFile()&&authJson(entry.name))await rm(join(sessionDir,entry.name),{force:true});
  }
 }else await rm(sessionDir,{recursive:true,force:true});
 await removeLegacyRecoveryArtifacts(sessionDir);
}
