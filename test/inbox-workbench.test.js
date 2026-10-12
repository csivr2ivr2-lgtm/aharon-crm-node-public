import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decideInbox,INBOX_ENGINE_VERSION} from '../src/ai/inbox-decision.js';
import {listInboxWork,updateInboxWork,inboxThemes,markInboxVisit} from '../src/inbox-workbench.js';
import {backfillInboxHistory} from '../src/ai/historical-triage.js';
import {extractWaitingItems,businessReadRequest} from '../src/ai/assistant-intents.js';
import {inboxHeaders} from '../src/ai/inbox-headers.js';
import {createRequestCache} from '../src/ai/request-cache.js';
const fixtures=JSON.parse(await readFile(new URL('./fixtures/inbox-work.json',import.meta.url),'utf8'));
for(const f of fixtures)test('acceptance: '+f.name,()=>{const d=decideInbox(f);assert.equal(d.handling_state,f.expected);assert.equal(d.message_type,f.type);assert.equal(d.engine_version,INBOX_ENGINE_VERSION);});
test('manual dimensions remain separate, override automatic noise, and read does not complete',()=>{
 const f=fixtures[0];assert.equal(decideInbox({...f,manual_message_type:'business',manual_caller_type:'customer',manual_status:'needs_reply'}).handling_state,'needs_reply');
 for(const is_read of [0,1])assert.equal(decideInbox({...fixtures[5],is_read}).handling_state,'needs_reply');
 assert.equal(decideInbox({...fixtures[5],manual_status:'waiting_customer'}).handling_state,'waiting_customer');
 assert.equal(decideInbox({...fixtures[5],manual_message_type:'spam',manual_status:'no_action'}).handling_state,'no_action');
 assert.equal(decideInbox({...fixtures[5],replied_elsewhere:1}).handling_state,'waiting_customer');
 assert.equal(decideInbox({...fixtures[5],manual_status:'snoozed',snoozed_until:'2020-01-01'}).handling_state,'review');
});
test('identity is not inferred from a display name, and quoted prompts never execute',()=>{
 assert.equal(decideInbox({...fixtures[5],sender:'Someone <ala@kishawi.co.il>'}).caller_type,'lead');
 assert.equal(decideInbox({...fixtures[9],client_id:'known',classification_reason:'סיווג ידני',classification:'normal'}).message_type,'suspicious');
 assert.equal(decideInbox({sender:'a@example.test',body:'תודה\nלהסרה מרשימת התפוצה'}).message_type,'unknown');
});
test('pagination passes 600 alerts to find a true lead; bound parameters and source link',async()=>{
 const data=Array.from({length:600},(_,i)=>({...fixtures[0],id:'c'+String(i).padStart(4,'0'),direction:'in'}));data.push({...fixtures[5],id:'c0600',message_id:'m600',direction:'in'});
 const calls=[];const db={execute:async(sql,p)=>{calls.push({sql,p});return [data.filter(x=>x.id>p[0]).slice(0,p.at(-1))];}};
 const r=await listInboxWork({limit:10},db);assert.equal(calls.length,4);assert.equal(r.scanned,601);assert.equal(r.complete,true);assert.deepEqual(r.items.map(x=>x.id),['c0600']);assert.equal(r.items[0].source_url,'/#conversation=c0600');
 assert.ok(calls.every(x=>x.sql.includes('newer.id>m.id')&&x.sql.includes('JSON_CONTAINS')&&x.sql.includes('LEFT JOIN conversation_workflow')));
 assert.equal(r.items[0].priority,95);
});
test('bounded incomplete scans cannot masquerade as a verified empty answer',async()=>{
 const db={execute:async()=>[Array.from({length:200},(_,i)=>({...fixtures[0],id:'c'+String(i).padStart(4,'0')}))]};
 const r=await listInboxWork({maxBatches:1},db);assert.equal(r.complete,false);assert.equal(r.items.length,0);
 assert.throws(()=>extractWaitingItems({ok:true,status:'completed',result:r}),/assistant_read_unavailable/);
 await assert.rejects(listInboxWork({}, {execute:async()=>{throw Error('database_down');}}),/database_down/);
 await assert.rejects(listInboxWork({cursor:[]},db),/invalid_inbox_filter/);
});
test('deduplicates the same RFC message in two accounts; same sender with different threads survives',async()=>{
 const rows=[{...fixtures[5],id:'a',rfc_message_id:'<same>'},{...fixtures[5],id:'b',rfc_message_id:'<same>'},{...fixtures[5],id:'c',rfc_message_id:'<different>'}];
 const r=await listInboxWork({}, {execute:async()=>[rows]});assert.deepEqual(r.items.map(x=>x.id),['a','c']);
});
test('SQL filters keep user strings out of executable query text',async()=>{
 const q="' OR 1=1 --";let sql,args;
 await listInboxWork({q,account_id:'account-1',client_id:'client-1',channel:'email'}, {execute:async(s,p)=>{sql=s;args=p;return [[]];}});
 assert.ok(!sql.includes(q));assert.ok(args.includes('%'+q+'%'));assert.ok(args.includes('account-1'));assert.ok(args.includes('client-1'));
});
test('manual handling locks, revision conflict, audit, and explicit reset',async()=>{
 let current=null,commits=0,rollbacks=0;const auditRows=[];
 const c={beginTransaction:async()=>{},commit:async()=>{commits++},rollback:async()=>{rollbacks++},release(){},execute:async(sql,p)=>{
  if(sql.startsWith('SELECT id FROM conversations'))return [[{id:'conv'}]];
  if(sql.startsWith('SELECT * FROM conversation_workflow'))return [current?[current]:[]];
  if(sql.startsWith('INSERT INTO conversation_workflow')){current={manual_status:p[1],manual_caller_type:p[2],manual_message_type:p[3],snoozed_until:p[4],revision:p[5]};return [{affectedRows:1}];}
  if(sql.startsWith('INSERT INTO ai_audit')){auditRows.push(p);return [{affectedRows:1}];}throw Error(sql);
 }};const database={getConnection:async()=>c};
 const r=await updateInboxWork('conv',{status:'done',revision:0},{database});assert.equal(r.revision,1);assert.equal(current.manual_status,'done');assert.equal(auditRows.length,1);
 await assert.rejects(updateInboxWork('conv',{status:'needs_reply',revision:0},{database}),/revision_conflict/);assert.equal(rollbacks,1);
 await updateInboxWork('conv',{status:'auto',revision:1},{database});assert.equal(current.manual_status,'auto');assert.equal(commits,2);
 await assert.rejects(updateInboxWork('conv',{status:'done',actor:'forged',revision:2},{database}),/invalid_inbox_change/);
});
test('historical dry-run has no writes; apply preserves feedback and persists version',async()=>{
 const rows=[{...fixtures[0],id:'a',classification:'normal',spam_disposition:'inbox'},{...fixtures[5],id:'b',classification:'normal',spam_disposition:'inbox'},{...fixtures[0],id:'c',classification:'normal',classification_reason:'סיווג ידני',spam_disposition:'inbox'}];const writes=[];
 const db={execute:async(sql,p)=>{if(sql.startsWith('SELECT'))return [rows];writes.push({sql,p});return [{affectedRows:1}];}};
 const preview=await backfillInboxHistory({dry_run:true},db);assert.equal(preview.proposed,1);assert.equal(writes.length,0);
 const r=await backfillInboxHistory({dry_run:false},db);assert.equal(r.updated,1);assert.equal(r.next_cursor,'c');assert.ok(writes.every(x=>!x.p.includes('c')));assert.ok(writes.some(x=>x.p.includes(INBOX_ENGINE_VERSION)));assert.ok(!writes.some(x=>/DELETE/.test(x.sql)));
});
test('only routing headers persist, with bounded values',()=>{assert.deepEqual(inboxHeaders(new Map([['Authorization','secret'],['list-id','list'],['content-type',{value:'text/plain'}]])),{'list-id':'list','content-type':'text/plain'});});
test('AI cache coalesces identical requests, expires and retries failures without caching them',async()=>{
 let clock=0,calls=0;const cache=createRequestCache({clock:()=>clock,ttl:10});const generate=async()=>{calls++;return {text:'draft'};};
 await Promise.all([cache('same',generate),cache('same',generate)]);assert.equal(calls,1);await cache('same',generate);assert.equal(calls,1);clock=11;await cache('same',generate);assert.equal(calls,2);
 await assert.rejects(cache('fail',async()=>{throw Error('quota')}),/quota/);assert.deepEqual(await cache('fail',generate),{text:'draft'});
});
test('common business read intents need no model',()=>{assert.equal(businessReadRequest('מה חמש הפניות הכי חשובות שלי?').limit,5);assert.equal(businessReadRequest('מי ביקש הצעת מחיר ועדיין לא חזרתי אליו?').message_type,'quote');assert.equal(businessReadRequest('איזה לקוחות רצו מספרים וירטואליים?').q,'מספר');assert.equal(businessReadRequest('שלח מייל'),null);});

test('previous login bounds the changed-since-visit query and first login declares fallback',async()=>{
 for(const previous of ['2026-10-01T10:00:00.000Z',null]){
  let args;const result=await listInboxWork({since_visit:true},{execute:async(sql,p)=>{if(sql.startsWith('SELECT previous_seen'))return [[{previous_seen:previous}]];args=p;return [[]];}});
  assert.equal(result.visit_known,Boolean(previous));assert.ok(args.includes(result.since));if(previous)assert.equal(result.since,previous);
 }
 let parameters;await markInboxVisit('signed-session-cookie',{execute:async(sql,p)=>{parameters=p;return [{}];}});
 assert.match(parameters[0],/^[a-f0-9]{64}$/);assert.ok(!parameters.includes('signed-session-cookie'));
 await assert.rejects(markInboxVisit(''),/login_required/);
});
test('priority filters preserve only eligible leads and themes reference their evidence',async()=>{
 const rows=[{...fixtures[5],id:'a'},{...fixtures[5],id:'b'}];
 const high=await listInboxWork({priority:'high'},{execute:async()=>[rows]});assert.equal(high.items.length,2);
 const normal=await listInboxWork({priority:'normal'},{execute:async()=>[rows]});assert.equal(normal.items.length,0);
 const themes=inboxThemes(high.items);assert.ok(themes.length);assert.deepEqual(themes[0].conversation_ids,['a','b']);
 assert.deepEqual(inboxThemes([{id:'spam',message_type:'spam',request_summary:'SMS numbers'}]),[]);
});
