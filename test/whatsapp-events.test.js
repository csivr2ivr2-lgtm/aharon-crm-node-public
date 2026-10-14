import test from 'node:test';
import assert from 'node:assert/strict';
import {WhatsAppConnector,textFrom} from '../src/connectors/whatsapp.js';
import {decideInbox} from '../src/ai/inbox-decision.js';
const message=(id,content,extra={})=>({key:{id,remoteJid:'972501234567@s.whatsapp.net'},message:content,messageTimestamp:1791972000,...extra});
function connector(){const c=new WhatsAppConnector({sessionId:'wa_test'});c.sock={};c.statusValue='connected';return c;}
test('wrapped WhatsApp messages retain human text',()=>{
 assert.equal(textFrom(message('1',{ephemeralMessage:{message:{extendedTextMessage:{text:'wrapped text'}}}})),'wrapped text');
 assert.equal(textFrom(message('2',{viewOnceMessage:{message:{imageMessage:{caption:'caption'}}}})),'caption');
});
test('reaction and protocol events remain identifiable and never become reply requests',async()=>{
 const c=connector(),events=[];c.onEvent=async e=>events.push(e);
 await c.receiveMessages(c.sock,{type:'notify',messages:[message('a',{conversation:'hello'}),message('b',{reactionMessage:{text:'👍',key:{id:'a'}}}),message('c',{protocolMessage:{type:0}})]});
 assert.deepEqual(events.map(e=>e.inbox_event_type),['','reaction','technical']);
 assert.equal(events[1].is_read,true);assert.equal(events[2].is_read,true);
 for(const e of events.slice(1))assert.equal(decideInbox(e).handling_state,'no_action');
 assert.ok(events.every(e=>e.account_id==='wa_test'));
});
test('stale socket events cannot enter another session and one bad item does not abort the batch',async()=>{
 const c=connector(),events=[];c.onEvent=async e=>{if(e.external_id==='bad')throw Error('storage unavailable');events.push(e);return {inserted:true};};
 await c.receiveMessages({}, {type:'notify',messages:[message('stale',{conversation:'old'})]});
 assert.equal(events.length,0);
 await c.receiveMessages(c.sock,{type:'append',messages:[message('bad',{conversation:'fail'}),message('invalid',{conversation:'bad timestamp'},{messageTimestamp:'invalid'}),message('good',{conversation:'ok'})]});
 assert.deepEqual(events.map(e=>e.external_id),['invalid','good']);assert.equal(c.lastError,'invalid_message_timestamp');assert.equal(events[0].sent_at,'1970-01-01T00:00:00.000Z');assert.equal(decideInbox(events[0]).handling_state,'review');
});
test('missing provider acknowledgment is never reported as successful; closed socket is not retried',async()=>{
 const c=connector();let calls=0;c.sock.sendMessage=async()=>{calls++;return {key:{}};};
 await assert.rejects(c.send({to:'972501234567',body:'hello'}),/send_not_confirmed/);assert.equal(calls,1);
 c.sock.sendMessage=async()=>{calls++;throw Error('Connection Closed');};
 await assert.rejects(c.send({to:'972501234567',body:'hello'}),/Connection Closed/);assert.equal(calls,2);
 c.statusValue='disconnected';await assert.rejects(c.send({to:'972501234567',body:'hello'}),/not connected/);assert.equal(calls,2);
});


test('profile persistence failure cannot discard a real message or its verified PN',async()=>{
 const c=connector(),events=[];
 c.onEvent=async e=>{if(e.type==='whatsapp.profile')throw Error('metadata unavailable');events.push(e);return {inserted:true};};
 const result=await c.receiveMessages(c.sock,{type:'notify',messages:[message('profile',{conversation:'שלום'},{pushName:'לקוח'})]});
 assert.equal(result.imported,1);assert.equal(events[0].sender,'972501234567@s.whatsapp.net');
});
test('canonical PN ignores contradictory alternative and timestamps accept seconds or milliseconds',async()=>{
 const c=connector(),events=[];c.onEvent=async e=>{if(e.type==='message')events.push(e);return {inserted:true};};
 const m=message('pn',{conversation:'שלום'});m.key.remoteJidAlt='972509999999@s.whatsapp.net';
 await c.receiveMessages(c.sock,{type:'append',messages:[m,message('ms',{conversation:'שלום'},{messageTimestamp:1791972000000})]});
 assert.equal(events[0].sender,'972501234567@s.whatsapp.net');assert.equal(events[0].sent_at,events[1].sent_at);assert.equal(events[1].inbox_event_type,'');
});
test('socket replacement during LID lookup prevents stale message ingestion',async()=>{
 const c=connector(),events=[],old={signalRepository:{lidMapping:{getPNForLID:async()=>{c.sock={};return '972501234567@s.whatsapp.net';}}}};
 c.sock=old;c.onEvent=async e=>{events.push(e);return {inserted:true};};
 const m=message('stale-lid',{conversation:'שלום'});m.key.remoteJid='123456789012345@lid';
 await c.receiveMessages(old,{type:'notify',messages:[m]});assert.equal(events.length,0);
});
test('unconfirmed ingestion is a failure, never a duplicate, and keeps recovery anchor',async()=>{
 const c=connector();c.onEvent=async()=>undefined;
 const result=await c.receiveMessages(c.sock,{type:'append',messages:[message('missing-receipt',{conversation:'שלום'})]});
 assert.deepEqual(result,{imported:0,duplicates:0,failed:1});assert.equal(c.historyAnchorCandidates()[0].key.id,'missing-receipt');
});
test('history requests never migrate to a replacement socket mid-batch',async()=>{
 const c=connector();let first=0,second=0;
 c.sock={fetchMessageHistory:async()=>{first++;c.sock={fetchMessageHistory:async()=>{second++;return 'wrong';}};return 'accepted';}};
 const rows=[1,2].map(i=>({jid:'972501234567@s.whatsapp.net',key:{id:String(i)},timestamp:1791972000000}));
 const result=await c.requestHistory(rows);assert.equal(result.requested,1);assert.equal(first,1);assert.equal(second,0);
});
