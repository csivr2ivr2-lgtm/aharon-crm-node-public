import test from 'node:test';
import assert from 'node:assert/strict';
import {requestWhatsAppDelete,recordWhatsAppReceipt,resolveWaReceipt,resolveWaStatus,outgoingControls} from '../src/whatsapp-message-controls.js';
test('status map is grounded in provider receipts only',()=>{
 assert.equal(resolveWaStatus({status:4}),'read');
 assert.equal(resolveWaStatus({status:1}),null);
 assert.equal(resolveWaReceipt({readTimestamp:123}),'read');
 assert.equal(resolveWaReceipt({receiptTimestamp:123}),'delivered');
 assert.equal(resolveWaReceipt({}),null);
});
test('receipt reject malformed account and preserves monotonic updates',async()=>{
 let sql='',args;const db={execute:async(s,p)=>{sql=s;args=p;return [{affectedRows:1}]}};
 assert.equal((await recordWhatsAppReceipt({account_id:'other',jid:'972501234567@s.whatsapp.net',provider_message_id:'ABC',status:'read'},db)).skipped,'invalid_receipt');
 assert.equal(sql,'');
 await recordWhatsAppReceipt({account_id:'whatsapp-main',jid:'972501234567@s.whatsapp.net',provider_message_id:'ABC',status:'read'},db);
 assert.match(sql,/GREATEST\(status_level/);assert.equal(args[3],4);
});
test('delete is strictly scoped to a recent outgoing WhatsApp message and original account',async()=>{
 const m={id:'msg_1',provider_message_id:'ABC123',sent_at:new Date(Date.now()-30000).toISOString(),direction:'out',channel:'whatsapp',jid:'972501234567@s.whatsapp.net',integration_key:'whatsapp:wa_abcdef0123456789'};
 let calls=0;let sent;
 const db={execute:async(sql,p)=>{
  if(sql.includes('FROM messages m'))return [[m]];
  if(sql.includes('INSERT IGNORE'))return [{affectedRows:++calls===1?1:0}];
  if(sql.includes('UPDATE whatsapp_delete_requests'))return [{affectedRows:1}];
  throw Error(sql);
 }};
 const first=await requestWhatsAppDelete('msg_1',{database:db,send:async v=>{sent=v;return {ok:true,message_id:v.message_id}}});
 assert.equal(first.status,'requested');
 assert.deepEqual(sent,{account_id:'wa_abcdef0123456789',to:m.jid,message_id:'ABC123'});
 await assert.rejects(requestWhatsAppDelete('msg_1',{database:db,send:async()=>{throw Error('should not call')}}),/already_requested/);
});
test('delete never touches email and never deletes old or inbound messages',async()=>{
 const base={id:'msg_1',provider_message_id:'ABC123',sent_at:new Date(Date.now()-5000).toISOString(),direction:'out',channel:'whatsapp',jid:'972501234567@s.whatsapp.net',integration_key:'whatsapp:whatsapp-main'};
 for(const changes of [{channel:'email'},{direction:'in'},{sent_at:new Date(Date.now()-48*3600*1000).toISOString()}]){
  const database={execute:async(sql)=>{if(sql.includes('FROM messages m'))return [[{...base,...changes}]];throw Error('mutation reached')}};
  await assert.rejects(requestWhatsAppDelete('msg_1',{database,send:async()=>{throw Error('sent')}}),/not_allowed|window_expired/);
 }
});
test('outbox status never lies about read receipts and hides repeated delete',async()=>{
 const m={id:'msg_1',channel:'whatsapp',session_id:'whatsapp-main',jid:'972501234567@s.whatsapp.net',provider_message_id:'ABC',sent_at:new Date().toISOString()};
 const database={execute:async sql=>sql.includes('FROM whatsapp_message_receipts')?[[{account_key:'whatsapp:whatsapp-main',jid:m.jid,provider_message_id:'ABC',status_level:4}]]:sql.includes('FROM whatsapp_delete_requests')?[[{message_id:'msg_1',status:'requested'}]]:[]};
 const [result]=await outgoingControls([m],database);
 assert.equal(result.delivery_status,'read');assert.equal(result.can_delete_for_everyone,false);
 assert.equal(result.deletion_status,'requested');
});
