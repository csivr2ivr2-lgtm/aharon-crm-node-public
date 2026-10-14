import test from 'node:test';
import assert from 'node:assert/strict';
import {listInboxWork} from '../src/inbox-workbench.js';
import {openTimePage,decodeTimeCursor} from '../src/inbox-time-pages.js';
const collations=[['messages','id'],['messages','conversation_id'],['conversations','id'],['accounts','id'],['clients','id'],['conversation_workflow','conversation_id']].map(([TABLE_NAME,COLUMN_NAME])=>({TABLE_NAME,COLUMN_NAME,COLLATION_NAME:'utf8mb4_unicode_ci'}));
const col={message:'utf8mb4_unicode_ci',client:'utf8mb4_unicode_ci'};
function fixture(messages){
 const sets=new Map(),members=new Map(),sqls=[];
 const db={query:async()=>[collations],getConnection:async()=>({execute:db.execute,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}}),execute:async(sql,p=[])=>{
  sqls.push({sql,p});
  if(sql.startsWith('SELECT id FROM inbox_page_sets'))return [[]];
  if(sql.startsWith('INSERT INTO inbox_page_sets')){sets.set(p[0],{filter_hash:p[1],expires_at:p[2]});return [{affectedRows:1}];}
  if(sql.startsWith('SELECT filter_hash'))return [[sets.get(p[0])].filter(Boolean)];
  if(sql.startsWith('INSERT INTO inbox_page_members')){
   assert.match(sql,/ROW_NUMBER\(\) OVER \(ORDER BY m.sent_at DESC,c.id DESC\)/);
   assert.match(sql,/NOT IN \('reaction','technical'\)/);
   const latest=new Map();
   for(const m of messages){if(['reaction','technical'].includes(m.inbox_event_type))continue;const old=latest.get(m.id);if(!old||old.waiting_since<m.waiting_since||old.waiting_since===m.waiting_since&&old.message_id<m.message_id)latest.set(m.id,m);}
   members.set(p[0],[...latest.values()].sort((a,b)=>b.waiting_since.localeCompare(a.waiting_since)||b.id.localeCompare(a.id)).map((m,i)=>({id:m.id,message_id:m.message_id,position:i+1})));return [{affectedRows:latest.size}];
  }
  if(sql.startsWith('SELECT conversation_id AS id,position'))return [(members.get(p[0])||[]).filter(m=>m.position>p[1]).slice(0,p[2])];
  if(sql.startsWith('SELECT pg.position')){
   assert.match(sql,/m.id=pg.message_id COLLATE utf8mb4_unicode_ci/);
   return [(members.get(p[0])||[]).filter(m=>m.position>p[1]&&m.position<=p[2]).map(m=>({...messages.find(x=>x.message_id===m.message_id),page_position:m.position})).slice(0,p.at(-1))];
  }
  throw Error('unexpected SQL '+sql);
 }};return {db,sets,members,sqls};
}
const row=(id,time,extra={})=>({id,message_id:'m-'+id,waiting_since:`2026-10-14T10:${time}:00.000Z`,direction:'in',body:'hello, can you help?',sender:'human@example.test',...extra});
test('default time pages rank globally regardless of conversation IDs and keep both accounts',async()=>{
 const rows=[row('z','01'),row('a','03',{rfc_message_id:'same',account_id:'a1'}),row('b','02',{rfc_message_id:'same',account_id:'a2'})],f=fixture(rows);
 const first=await listInboxWork({limit:1},f.db);assert.deepEqual(first.items.map(x=>x.id),['a']);assert.equal(first.ranking_scope,'snapshot_time');
 const second=await listInboxWork({limit:1,cursor:first.next_cursor},f.db);assert.deepEqual(second.items.map(x=>x.id),['b']);
 const third=await listInboxWork({limit:1,cursor:second.next_cursor},f.db);assert.deepEqual(third.items.map(x=>x.id),['z']);
 assert.equal((await listInboxWork({limit:1,cursor:third.next_cursor},f.db)).done,true);
});
test('new incoming and outgoing messages, reactions and late arrivals do not move existing pages',async()=>{
 const rows=[row('a','03'),row('b','02'),row('c','01')],f=fixture(rows);
 const first=await listInboxWork({limit:1},f.db);
 rows.push(row('b','05',{message_id:'new-b',direction:'out'}),row('d','04'),row('a','00',{message_id:'late-a'}),row('c','06',{message_id:'reaction-c',inbox_event_type:'reaction'}));
 const rest=await listInboxWork({limit:10,cursor:first.next_cursor},f.db);
 assert.deepEqual(rest.items.map(x=>x.id),['b','c']);assert.equal(rest.items[0].message_id,'m-b');assert.equal(rest.done,true);
 const refreshed=await listInboxWork({limit:10},f.db);assert.deepEqual(refreshed.items.map(x=>x.id),['b','d','a','c']);assert.equal(refreshed.items[0].direction,'out');
});
test('filtering across batches consumes only returned positions, never loses rows after page limit',async()=>{
 const rows=Array.from({length:450},(_,i)=>row('c'+String(i).padStart(4,'0'),'01',{classification:i<220?'system':'normal'})),f=fixture(rows);
 let cursor='',seen=[];
 for(let i=0;i<100;i++){const page=await listInboxWork({cursor,limit:7},f.db);seen.push(...page.items.map(x=>x.id));cursor=page.next_cursor;if(page.done)break;}
 assert.equal(seen.length,230);assert.equal(new Set(seen).size,230);
});
test('expired and altered-filter cursors fail explicitly, malformed tokens never reach SQL',async()=>{
 const f=fixture([row('a','01')]),page=await listInboxWork({},f.db);
 await assert.rejects(listInboxWork({cursor:page.next_cursor,account_id:'other'},f.db),/filter_mismatch/);
 f.sets.get(decodeTimeCursor(page.next_cursor).id).expires_at='2000-01-01T00:00:00.000Z';
 await assert.rejects(listInboxWork({cursor:page.next_cursor},f.db),/expired_refresh/);
 assert.throws(()=>decodeTimeCursor("t1:' OR 1=1:0"),/invalid_inbox_cursor/);
});
test('snapshot SQL applies account and date scope before ranking and binds search text',async()=>{
 const f=fixture([]),q="' OR 1=1 --";
 await openTimePage({cursor:'',filters:{account_id:'account',q,from:'2026-10-01'},col},f.db);
 const call=f.sqls.find(x=>x.sql.startsWith('INSERT INTO inbox_page_members'));
 assert.match(call.sql,/c.account_id=\?/);assert.match(call.sql,/m.sent_at>=\?/);assert.ok(call.p.includes('account'));assert.ok(call.p.includes('%'+q+'%'));assert.ok(!call.sql.includes(q));
});
test('previous-visit pagination keeps its original boundary when the fallback clock moves',async()=>{
 const f=fixture([]),filters={since_visit:true,from:'2026-10-13T10:00:00.000Z'};
 const page=await openTimePage({cursor:'',filters,col},f.db);
 const resumed=await openTimePage({cursor:`t1:${page.id}:0`,filters:{...filters,from:'2026-10-13T10:01:00.000Z'},col},f.db);
 assert.equal(resumed.id,page.id);
});
