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
 const c=connector(),events=[];c.onEvent=async e=>{if(e.external_id==='bad')throw Error('storage unavailable');events.push(e);};
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
