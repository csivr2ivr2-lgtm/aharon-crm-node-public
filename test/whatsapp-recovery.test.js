import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {interpretDisconnect,registeredAuthPresent,readRecoveryHold,holdSession,clearHoldOnConnected,reserveSingleRecoveryProbe,backupAuthState,recoverySummary} from '../src/connectors/whatsapp-recovery.js';
test('real Boom status is preserved, logout and replaced sessions are quarantined',()=>{
 assert.deepEqual(interpretDisconnect({error:{output:{statusCode:401}}}),{code:401,reason:'logged_out',needsReview:true,autoRetry:false});
 assert.equal(interpretDisconnect({error:{output:{statusCode:440}}}).autoRetry,false);
 assert.equal(interpretDisconnect({error:{output:{statusCode:515}}}).autoRetry,true);
 assert.equal(interpretDisconnect({error:{message:'unexpected'}}).code,null);
});
async function dir(){const home=await mkdtemp(join(tmpdir(),'crm-wa-recovery-'));const auth=join(home,'auth');await mkdir(auth);await writeFile(join(auth,'creds.json'),JSON.stringify({registered:true,me:{id:'PRIVATE_SECRET'}}));await writeFile(join(auth,'session-1.json'),'{"key":"PRIVATE_KEY"}');await writeFile(join(auth,'session-abc=+.json'),'{"key":"SPECIAL_KEY"}');await writeFile(join(auth,'sessions.json'),'[{"id":"no-copy"}]');return {home,auth};}
test('only owned credential files are preserved in a restricted non-public sibling',async()=>{
 const x=await dir();try{
  assert.equal(await registeredAuthPresent(x.auth),true);
  const backup=await backupAuthState(x.auth);assert.equal(backup.ok,true);
  const record=await recoverySummary(x.auth);assert.equal(record.backup_count,1);
  const folders=(await readdir(x.auth+'.recovery')).filter(x=>x.startsWith('snapshot-'));
  assert.equal(folders.length,1);
  const files=await readdir(join(x.auth+'.recovery',folders[0]));
  assert.ok(files.includes('creds.json'));assert.ok(files.includes('session-1.json'));assert.ok(files.includes('session-abc=+.json'));assert.ok(!files.includes('sessions.json'));
  assert.match(await readFile(join(x.auth+'.recovery',folders[0],'creds.json'),'utf8'),/PRIVATE_SECRET/);
  assert.equal((await backupAuthState(x.auth,{maximum:1})).reason,'snapshot_limit');
 }finally{await rm(x.home,{recursive:true,force:true});}
});
test('quarantine survives restarts and only one explicit recovery probe is permitted',async()=>{
 const x=await dir();try{
  await holdSession(x.auth,{reason:'logged_out',code:401});
  const before=await readRecoveryHold(x.auth);await holdSession(x.auth,{reason:'logged_out',code:401});
  assert.deepEqual(await readRecoveryHold(x.auth),before);
  assert.equal((await reserveSingleRecoveryProbe(x.auth)).ok,true);
  await assert.rejects(reserveSingleRecoveryProbe(x.auth),/probe_already_used/);
  await clearHoldOnConnected(x.auth);
  assert.equal(await readRecoveryHold(x.auth),null);
  const archived=await readdir(x.auth+'.recovery');assert.ok(archived.some(x=>x.startsWith('recovered-')));
  assert.equal(await registeredAuthPresent(x.auth),true);
 }finally{await rm(x.home,{recursive:true,force:true});}
});
test('never permits probe with missing registered credentials',async()=>{
 const x=await dir();try{
  await holdSession(x.auth,{reason:'logged_out',code:401});
  await writeFile(join(x.auth,'creds.json'),'{"registered":false}');
  await assert.rejects(reserveSingleRecoveryProbe(x.auth),/original_auth_missing/);
 }finally{await rm(x.home,{recursive:true,force:true});}
});
