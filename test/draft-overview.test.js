import test from 'node:test';
import assert from 'node:assert/strict';
import {listOpenDrafts} from '../src/draft-overview.js';
test('draft overview separates active and uncertain replies, preserving account and channel',async()=>{
 const database={execute:async(sql,p)=>{
  if(sql.includes('FROM message_drafts')){assert.match(sql,/status IN \('draft','uncertain','sending'\)/);return [[{id:'d1',conversation_id:'c1',snippet:'טיוטה',status:'draft',provider:'local',updated_at:'2026-10-16T01:00:00.000Z'},{id:'d2',conversation_id:'c2',snippet:'ספק לא אישר',status:'uncertain',updated_at:'2026-10-15T01:00:00.000Z'}]];}
  if(sql.includes('FROM conversations'))return [[{id:'c1',title:'שרה',channel:'whatsapp',account_id:'a1'},{id:'c2',title:'מייל',channel:'email',account_id:'a2'}].filter(x=>p.includes(x.id))];
  if(sql.includes('FROM accounts'))return [[{id:'a1',label:'WhatsApp'},{id:'a2',label:'Gmail'}].filter(x=>p.includes(x.id))];
  throw Error('invalid SQL');
 }};
 const r=await listOpenDrafts({},database);assert.equal(r.scope,'reply_drafts_only');
 assert.deepEqual(r.items.map(x=>x.status),['draft','uncertain']);
 assert.deepEqual(r.items.map(x=>x.channel),['whatsapp','email']);
 assert.equal(r.items[0].conversation_title,'שרה');
 assert.equal(r.items[1].account_label,'Gmail');
});
