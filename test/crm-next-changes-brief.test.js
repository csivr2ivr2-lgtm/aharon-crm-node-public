import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRecentChanges} from '../src/ai/changes-brief.js';
test('read-only daily brief has traceable source ids and no invented delivery/read claims',async()=>{
 const sql=[];
 const db={execute:async(query,params)=>{
  assert.equal(query.trim().startsWith('SELECT'),true);
  assert.deepEqual(params,['2026-10-15T12:00:00.000Z']);
  sql.push(query);
  if(query.includes('FROM messages m'))return [[
   {id:'msg1',conversation_id:'conv1',direction:'in',channel:'email',snippet:'הי',sent_at:'2026-10-16T11:00:00.000Z'},
   {id:'msg2',conversation_id:'conv2',direction:'out',channel:'whatsapp',snippet:'שלום',sent_at:'2026-10-16T10:00:00.000Z'}
  ]];
  if(query.includes('FROM tasks'))return [[{id:'task1',title:'Follow-up',status:'open'}]];
  if(query.includes('FROM clients'))return [[{id:'client1',name:'Customer'}]];
  throw Error('Unexpected SQL');
 }};
 const r=await loadRecentChanges({hours:24,clock:Date.parse('2026-10-16T12:00:00.000Z'),database:db});
 assert.equal(sql.length,3);assert.equal(r.counts.incoming,1);assert.equal(r.counts.outgoing,1);
 assert.equal(r.counts.tasks_updated,1);assert.equal(r.counts.clients_added,1);
 assert.deepEqual(r.messages[0].source,{type:'message',id:'msg1',conversation_id:'conv1'});
 assert.equal(r.generated_by,'crm_database_read_only');
 assert.equal('delivery_status' in r.messages[0],false);
});
test('invalid time windows are rejected before touching database',async()=>{
 let count=0;const db={execute:async()=>{count++;return [[]]}};
 await assert.rejects(loadRecentChanges({hours:10000,database:db}),/invalid_recent_hours/);
 await assert.rejects(loadRecentChanges({hours:'abc',database:db}),/invalid_recent_hours/);
 assert.equal(count,0);
});
