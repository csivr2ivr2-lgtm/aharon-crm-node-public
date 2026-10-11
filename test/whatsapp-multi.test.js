import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WhatsAppSessions} from '../src/connectors/whatsapp-sessions.js';

function fakeFactory(registry){
 return ({sessionId,sessionDir,label})=>{
  const item={sessionId,sessionDir,label,phoneNumber:null,statusValue:'disconnected',
   status(){return {id:this.sessionId,key:'whatsapp',status:this.statusValue,label:this.label,qr:'private-qr',pairing_code:'12345678',configured:true,last_error:null}},
   async start(){this.statusValue='connected'},
   async pairWithPhone(phone){this.statusValue='connected';return {status:'connected',phone}},
   async reconnect(){this.statusValue='connected'},
   async disconnect(){this.statusValue='disconnected'},
   async deleteSession(){this.statusValue='logged_out'},
   stop(){this.statusValue='disconnected'},
   async send({to,body}){registry.push({id:this.sessionId,to,body});if(this.statusValue!=='connected')throw Error('not connected');return {ok:true,message_id:this.sessionId+'-sent'}}
  };
  return item;
 };
}
test('multiple linked sessions persist, isolate sends and never expose QR in connector status',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'crm-whatsapp-multi-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sent=[],manager=new WhatsAppSessions({rootDir:dir,enabled:true,connectorFactory:fakeFactory(sent)});
 await manager.initialize();
 const first=await manager.pairWithPhone('972501234567',()=>{});
 const second=await manager.pairWithPhone('972521234567',()=>{});
 assert.notEqual(first.session_id,second.session_id);
 assert.ok(first.session_id.startsWith('wa_'));assert.equal(manager.status().sessions.length,3);
 assert.equal(JSON.stringify(manager.status()).includes('12345678'),false);
 assert.equal(manager.status({includeSecrets:true}).sessions.filter(s=>s.pairing_code).length,3);
 await assert.rejects(()=>manager.send({to:'972501111111',body:'wrong account'}),/whatsapp_account_id_required/);
 await manager.send({account_id:first.session_id,to:'972501111111',body:'one'});
 await manager.send({account_id:second.session_id,to:'972501111111',body:'two'});
 assert.deepEqual(sent.map(s=>s.id),[first.session_id,second.session_id]);
 assert.notEqual(manager.get(first.session_id).sessionDir,manager.get(second.session_id).sessionDir);
 const saved=JSON.parse(await readFile(join(dir,'sessions.json'),'utf8'));
 assert.equal(saved.length,2);assert.ok(saved.every(r=>r.phone&&r.id));
 const restarted=new WhatsAppSessions({rootDir:dir,enabled:true,connectorFactory:fakeFactory([])});
 await restarted.initialize();assert.equal(restarted.status().sessions.length,3);
 await restarted.disconnect(first.session_id);assert.equal(restarted.get(second.session_id).statusValue,'disconnected');
 await restarted.deleteSession(first.session_id);
 assert.equal(restarted.status().sessions.length,2);
 assert.deepEqual(JSON.parse(await readFile(join(dir,'sessions.json'),'utf8')).map(r=>r.id),[second.session_id]);
 await assert.rejects(()=>restarted.send({account_id:first.session_id,to:'972501111111',body:'stale'}),/whatsapp_session_not_found/);
});
test('invalid session ids are rejected and maximum sessions are bounded',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'crm-whatsapp-limits-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const manager=new WhatsAppSessions({rootDir:dir,enabled:true,connectorFactory:fakeFactory([])});await manager.initialize();
 assert.throws(()=>manager.get('../credentials'),/whatsapp_session_not_found/);
 for(let i=0;i<9;i++)await manager.pairWithPhone('97250'+String(1000000+i),()=>{});
 await assert.rejects(()=>manager.pairWithPhone('972509999999',()=>{}),/whatsapp_session_limit/);
});
