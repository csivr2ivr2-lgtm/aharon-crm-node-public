import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {interpretDisconnect,registeredAuthPresent,removeLegacyRecoveryArtifacts,clearSessionLocalAuth,recoveryHome} from '../src/connectors/whatsapp-recovery.js';

async function setup(){
 const home=await mkdtemp(join(tmpdir(),'crm-wa-min-auth-'));
 const auth=join(home,'auth'),other=join(auth,'sessions','wa_aaaaaaaaaaaaaaaa');
 await mkdir(other,{recursive:true});
 await writeFile(join(auth,'creds.json'),JSON.stringify({registered:true}));
 await writeFile(join(auth,'session-abc=+.json'),'{"key":"MAIN"}');
 await writeFile(join(auth,'sessions.json'),'[{"id":"wa_aaaaaaaaaaaaaaaa"}]');
 await writeFile(join(other,'creds.json'),'{"registered":true}');
 const legacy=recoveryHome(auth);
 await mkdir(join(legacy,'snapshot-1234567890123-deadbeef'),{recursive:true});
 await writeFile(join(legacy,'quarantine.json'),'{}');
 await writeFile(join(legacy,'snapshot-1234567890123-deadbeef','creds.json'),'LEGACY_PRIVATE');
 return {home,auth,other,legacy};
}
test('real WhatsApp auth revocations are distinguished from transient network failures',()=>{
 assert.deepEqual(interpretDisconnect({error:{output:{statusCode:401}}}),{code:401,reason:'logged_out',needsReview:true,autoRetry:false});
 assert.equal(interpretDisconnect({error:{output:{statusCode:403}}}).autoRetry,false);
 assert.equal(interpretDisconnect({error:{output:{statusCode:440}}}).autoRetry,false);
 assert.equal(interpretDisconnect({error:{output:{statusCode:515}}}).autoRetry,true);
 assert.equal(interpretDisconnect({error:{message:'unexpected'}}).code,null);
});
test('removing obsolete backups preserves active auth, secondary accounts and registry',async t=>{
 const x=await setup();t.after(()=>rm(x.home,{recursive:true,force:true}));
 assert.equal(await registeredAuthPresent(x.auth),true);
 await removeLegacyRecoveryArtifacts(x.auth);
 await assert.rejects(readdir(x.legacy),{code:'ENOENT'});
 assert.equal(await registeredAuthPresent(x.auth),true);
 assert.equal(await readFile(join(x.auth,'sessions.json'),'utf8'),'[{"id":"wa_aaaaaaaaaaaaaaaa"}]');
 assert.equal(await readFile(join(x.other,'creds.json'),'utf8'),'{"registered":true}');
 await removeLegacyRecoveryArtifacts(x.auth);
});
test('explicit main deletion only clears its authentication files and obsolete backups',async t=>{
 const x=await setup();t.after(()=>rm(x.home,{recursive:true,force:true}));
 await clearSessionLocalAuth(x.auth,{preserveRegistry:true});
 assert.equal(await registeredAuthPresent(x.auth),false);
 await assert.rejects(readFile(join(x.auth,'session-abc=+.json'),'utf8'),{code:'ENOENT'});
 await assert.rejects(readdir(x.legacy),{code:'ENOENT'});
 assert.equal(await readFile(join(x.auth,'sessions.json'),'utf8'),'[{"id":"wa_aaaaaaaaaaaaaaaa"}]');
 assert.equal(await readFile(join(x.other,'creds.json'),'utf8'),'{"registered":true}');
});
