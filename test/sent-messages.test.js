import test from 'node:test';
import assert from 'node:assert/strict';
import {listSentMessages,decodeSentCursor,encodeSentCursor} from '../src/sent-messages.js';
const hoursAgo=hours=>new Date(Date.now()-hours*3600000).toISOString();
const rows=[
 {id:'msg_3',conversation_id:'c1',external_id:'WAMESSAGE3',recipient:'972501234567@s.whatsapp.net',subject:'',snippet:'היי',sent_at:hoursAgo(1)},
 {id:'msg_2',conversation_id:'c2',external_id:'EMAILMESSAGE2',recipient:'buyer@example.com',subject:'פרטים',snippet:'בוקר טוב',sent_at:hoursAgo(2)},
 {id:'msg_1',conversation_id:'c1',external_id:'WAMESSAGE1',recipient:'972501234567@s.whatsapp.net',subject:'',snippet:'שלום',sent_at:hoursAgo(3)}
];
const db={execute:async(sql,p)=>{
 if(sql.includes('FROM messages')){assert.match(sql,/direction='out'/);const c=p.length>1?{t:p[0],id:p[2]}:null;return [rows.filter(x=>!c||x.sent_at<c.t||x.sent_at===c.t&&x.id<c.id).slice(0,p.at(-1))];}
 if(sql.includes('FROM conversations'))return [[{id:'c1',title:'שרה',channel:'whatsapp',account_id:'a1',external_id:'972501234567@s.whatsapp.net'},{id:'c2',title:'הצעה',channel:'email',account_id:'a2'}].filter(x=>p.includes(x.id))];
 if(sql.includes('FROM accounts'))return [[{id:'a1',label:'WhatsApp',identifier:'whatsapp-main',integration_key:'whatsapp:whatsapp-main'},{id:'a2',label:'Gmail',identifier:'mail@example.com',integration_key:'google:gmail-main'}].filter(x=>p.includes(x.id))];
 if(sql.includes('FROM whatsapp_message_receipts')||sql.includes('FROM whatsapp_delete_requests'))return [[]];
 throw Error('SQL not expected');
}};
test('sent displays both channels from real outgoing rows and paginates without duplication',async()=>{
 const a=await listSentMessages({limit:2},db);assert.equal(a.done,false);
 assert.deepEqual(a.items.map(x=>x.channel),['whatsapp','email']);
 assert.deepEqual(a.items.map(x=>x.delivery_status),['unverified','unverified']);
 assert.equal(a.items[1].account_label,'Gmail');
 assert.equal(a.items[0].can_delete_for_everyone,false); // emergency revoke suspension stays fail-closed
 const b=await listSentMessages({limit:2,cursor:a.next_cursor},db);
 assert.deepEqual(b.items.map(x=>x.id),['msg_1']);assert.equal(b.done,true);
});
test('invalid cursors are rejected',()=>{
 assert.deepEqual(decodeSentCursor(encodeSentCursor(rows[0])),{sent_at:rows[0].sent_at,id:rows[0].id});
 for(const t of ['%',Buffer.from('{}').toString('base64url'),Buffer.from('{"v":1,"t":"wrong","id":"a"}').toString('base64url')])
 assert.throws(()=>decodeSentCursor(t),/invalid_sent_cursor/);
});
test('empty sent list has no joins',async()=>{
 let count=0;const r=await listSentMessages({}, {execute:async()=>{count++;return [[]]}});assert.equal(r.items.length,0);assert.equal(count,1);
});
