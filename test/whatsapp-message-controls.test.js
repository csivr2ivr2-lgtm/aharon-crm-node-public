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
test('revoke circuit breaker fails closed before any database lookup or provider operation',async()=>{
 let touched=false;
 const database={execute:async()=>{touched=true;throw Error('database must not be queried')}};
 await assert.rejects(requestWhatsAppDelete('msg_1',{database,send:async()=>{touched=true;throw Error('network must not be touched')}}),/whatsapp_delete_paused_safety_review/);
 assert.equal(touched,false);
});
test('revoke is hidden even for a recent valid outbound WhatsApp message',async()=>{
 const m={id:'msg_2',channel:'whatsapp',session_id:'whatsapp-main',jid:'972501234567@s.whatsapp.net',provider_message_id:'XYZ',sent_at:new Date(Date.now()-1000).toISOString()};
 const database={execute:async sql=>sql.includes('FROM whatsapp_message_receipts')?[[{account_key:'whatsapp:whatsapp-main',jid:m.jid,provider_message_id:'XYZ',status_level:4}]]:[[]]};
 const [result]=await outgoingControls([m],database);
 assert.equal(result.delivery_status,'read');
 assert.equal(result.can_delete_for_everyone,false);
});
test('outbox status never lies about read receipts and hides repeated delete',async()=>{
 const m={id:'msg_1',channel:'whatsapp',session_id:'whatsapp-main',jid:'972501234567@s.whatsapp.net',provider_message_id:'ABC',sent_at:new Date().toISOString()};
 const database={execute:async sql=>sql.includes('FROM whatsapp_message_receipts')?[[{account_key:'whatsapp:whatsapp-main',jid:m.jid,provider_message_id:'ABC',status_level:4}]]:sql.includes('FROM whatsapp_delete_requests')?[[{message_id:'msg_1',status:'requested'}]]:[]};
 const [result]=await outgoingControls([m],database);
 assert.equal(result.delivery_status,'read');assert.equal(result.can_delete_for_everyone,false);
 assert.equal(result.deletion_status,'requested');
});
