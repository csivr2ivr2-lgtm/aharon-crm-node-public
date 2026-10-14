// Isolated integration test: only the CI database set through DB_* is modified.
import assert from 'node:assert/strict';
import {db,migrate} from '../src/db.js';
import {migrateExtras} from '../src/extra-schema.js';
import {migratePlatform} from '../src/platform/schema.js';
import {migrateIntelligence} from '../src/ai/intelligence.js';
import {migrateInboxWorkbench,listInboxWork,markInboxVisit} from '../src/inbox-workbench.js';
import {migrateHistorySync} from '../src/historical-sync.js';
import {migrateThreading,mergeConversations,splitConversation} from '../src/conversation-threading.js';

assert.equal(process.env.NODE_ENV,'test','Only run with NODE_ENV=test');
assert.equal(process.env.DB_NAME,'crm_ci','Only run against isolated crm_ci database');
assert.equal(process.env.SYNC_ENABLED,'false','Live synchronization must be off');
assert.equal(process.env.TASK_WORKER_ENABLED,'false','Background worker must be off');

const run=async()=>{
 const [[version]]=await db.query('SELECT VERSION() AS version');
 console.log('Connected to actual SQL server version:',version.version);
 await migrate();
 await migrateExtras();
 await migratePlatform();
 await migrateIntelligence();
 await migrateInboxWorkbench();
 await migrateInboxWorkbench(); // Must remain safe if startup is repeated.
 await migrateHistorySync(db);
 await migrateHistorySync(db);
 await migrateThreading(db);
 await migrateThreading(db);
 const [historyTable]=await db.query("SHOW TABLES LIKE 'historical_sync_progress'");
 assert.equal(historyTable.length,1,'historical sync progress must be restart-safe');

 console.log('PASS: additive inbox migration applied twice');

 const [columns]=await db.query('SHOW COLUMNS FROM messages');
 const names=new Set(columns.map(x=>x.Field));
 for(const name of ['headers_json','inbox_event_type','references_json','classification','classification_score','classification_reason','spam_disposition'])assert.ok(names.has(name),'missing column '+name);
 const [index]=await db.query("SHOW INDEX FROM messages WHERE Key_name='idx_inbox_latest'");
 assert.deepEqual(index.map(x=>x.Column_name).sort(),['conversation_id','id','sent_at'].sort());
 for(const name of ['conversation_workflow','message_intelligence','inbox_visits','inbox_page_sets','inbox_page_members']){
  const [found]=await db.query('SHOW TABLES LIKE ?',[name]);
  assert.equal(found.length,1,'missing table '+name);
 }
 console.log('PASS: columns, tables, index');

 // Simulate an upgraded production database where legacy tables kept different utf8mb4 collations.
 // Both collations are supported on MySQL 8 and MariaDB 10.11. Run only against isolated crm_ci.
 for(const [table,collation] of [
  ['conversations','utf8mb4_general_ci'],
  ['messages','utf8mb4_unicode_ci'],
  ['accounts','utf8mb4_general_ci'],
  ['clients','utf8mb4_general_ci'],
  ['conversation_workflow','utf8mb4_unicode_ci']
 ])await db.query('ALTER TABLE '+table+' CONVERT TO CHARACTER SET utf8mb4 COLLATE '+collation);
 const [columnCollations]=await db.query("SELECT TABLE_NAME,COLUMN_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME='conversations' AND COLUMN_NAME='id' OR TABLE_NAME='messages' AND COLUMN_NAME='conversation_id' OR TABLE_NAME='conversation_workflow' AND COLUMN_NAME='conversation_id')");
 assert.equal(new Set(columnCollations.map(c=>c.COLLATION_NAME)).size,2,'test fixture needs genuinely mixed collations');
 console.log('PASS: mixed legacy table collations fixture is active');


 // Do not bind invalid JSON as an argument of JSON_CONTAINS in a prepared statement.
 // MySQL 8 can cast such a parameter before evaluating the CASE guard.
 const [jsonRows]=await db.execute("SELECT JSON_VALID(?) AS valid,JSON_CONTAINS('[\"<request>\"]',JSON_QUOTE(?)) AS matched",['["<request>"]','<request>']);
 assert.equal(Number(jsonRows[0].valid),1);
 assert.equal(Number(jsonRows[0].matched),1);
 console.log('PASS: valid JSON functions with MySQL prepared parameters');

 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key) VALUES('ci-a','email','CI account','ci@example.test','ci:a'),('ci-b','email','CI other','ci2@example.test','ci:b')");
 const conv=async(id,account='ci-a')=>db.execute('INSERT INTO conversations(id,channel,account_id,external_id,title,client_id) VALUES(?,?,?,?,?,?)',[id,'email',account,id,'CI conversation','']);
 for(const id of ['ci-01','ci-02','ci-03','ci-04','ci-05','ci-06'])await conv(id,id==='ci-04'?'ci-b':'ci-a');
 const insert=async(id,cid,direction,body,when,rfc='',refs='[]',classification='normal')=>{
  await db.execute('INSERT INTO messages(id,conversation_id,external_id,direction,sender,subject,body,sent_at,rfc_message_id,references_json,classification) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,cid,id,direction,'customer@example.test','CI inquiry',body,when,rfc,refs,classification]);
 };
 const old='2026-10-11T08:00:00.000Z',recent='2026-10-12T10:00:00.000Z';
 await insert('ci-m1','ci-01','in','אני רוצה הצעת מחיר ל-10 מספרים',recent,'<quote>');
 await insert('ci-m2','ci-02','out','שלחתי תשובה',recent,'<sent>');
 await insert('ci-m3','ci-03','in','אני צריך שירות',old,'<request>');
 await insert('ci-m4','ci-04','out','תשובה מחשבון אחר',recent,'<reply>','["<request>"]');
 await insert('ci-m5','ci-05','in','אני רוצה הצעת מחיר חדשה',recent,'<renewal>');
 await insert('ci-m6','ci-06','out','תשובה ישנה עם כותרות הפניה פגומות',recent,'<invalid-ref>','not-json');
 // This tests the exact safe production pattern against an actual LONGTEXT database field,
 // not against a raw invalid prepared parameter that MySQL 8 casts prematurely.
 const [invalidRows]=await db.execute("SELECT CASE WHEN JSON_VALID(references_json)=1 THEN JSON_CONTAINS(references_json,JSON_QUOTE(?)) ELSE 0 END AS matched FROM messages WHERE id=?",['<request>','ci-m6']);
 assert.equal(Number(invalidRows[0].matched),0,'malformed persisted RFC references must not crash inbox queries');
 console.log('PASS: invalid persisted JSON safely excluded by guarded JSON_CONTAINS');

 await db.execute("INSERT INTO conversation_workflow(conversation_id,manual_status,revision,updated_at) VALUES('ci-05','done',1,?)",[old]);
 const captured=[];
 const recording={execute:async(sql,params)=>{if(sql.includes('FROM conversations c JOIN messages m'))captured.push([sql,params]);return db.execute(sql,params);}};
 const waiting=await listInboxWork({view:'needs_reply',sort:'priority',maxBatches:1},recording);
 assert.ok(waiting.items.some(x=>x.id==='ci-01'),'new quote missing from work queue');
 assert.ok(waiting.items.some(x=>x.id==='ci-05'),'new message after done missing');
 assert.ok(!waiting.items.some(x=>x.id==='ci-03'),'answered elsewhere is incorrectly waiting');
 const waitingCustomer=await listInboxWork({view:'waiting_customer',maxBatches:1},db);
 assert.ok(waitingCustomer.items.some(x=>x.id==='ci-02'),'outbound reply missing');
 assert.ok(waitingCustomer.items.some(x=>x.id==='ci-03'),'RFC reference reply not detected');
 const [history]=await db.execute("SELECT manual_status,revision FROM conversation_workflow WHERE conversation_id='ci-05'");
 assert.equal(history[0].manual_status,'done');
 assert.equal(Number(history[0].revision),1);
 console.log('PASS: business lead, waiting customer, cross-account RFC reference, historical done preserved');

 assert.ok(captured.length,'queue query not captured');
 assert.match(captured[0][0],/m\.conversation_id=c\.id COLLATE/,'indexed message key must remain unmodified');
 assert.match(captured[0][0],/newer\.conversation_id=m\.conversation_id/,'same-table newest-message check must remain indexable');
 assert.doesNotMatch(captured[0][0],/m\.conversation_id COLLATE/,'do not collate indexed message key');
 const [plan]=await db.execute('EXPLAIN '+captured[0][0],captured[0][1]);
 assert.ok(plan.length,'missing EXPLAIN rows for full work queue query');
 const [refPlan]=await db.execute("EXPLAIN SELECT id FROM messages WHERE (CASE WHEN JSON_VALID(references_json)=1 THEN JSON_CONTAINS(references_json,JSON_QUOTE(?)) ELSE 0 END)=1",['<request>']);
 assert.ok(refPlan.length,'missing JSON EXPLAIN');
 console.log('PASS: actual EXPLAIN for production-style inbox queue and JSON reference query');
 console.log('EXPLAIN operators:',JSON.stringify(plan.map(x=>({table:x.table,type:x.type,key:x.key,rows:x.rows}))));
 await markInboxVisit('ci-session',db);
 const [visit]=await db.query("SELECT COUNT(*) AS n FROM inbox_visits WHERE actor='dashboard'");
 assert.equal(Number(visit[0].n),1);
 console.log('PASS: session visit persisted');
 // Real SQL snapshot tests: IDs are deliberately not chronological, and inserts
 // happen between requests to exercise immutable membership rather than a mock.
 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key) VALUES('ci-time','email','Time test','time@example.test','ci:time')");
 for(const id of ['time-z','time-b','time-a'])await conv(id,'ci-time');
 await insert('time-mz','time-z','in','hello','2026-10-14T10:01:00.000Z','<same-copy>');
 await insert('time-mb','time-b','in','hello','2026-10-14T10:02:00.000Z','<same-copy>');
 await insert('time-ma','time-a','in','hello','2026-10-14T10:03:00.000Z');
 const filter={view:'all',account_id:'ci-time',limit:1};
 const first=await listInboxWork(filter,db);
 assert.deepEqual(first.items.map(x=>x.id),['time-a']);
 assert.equal(first.ranking_scope,'snapshot_time');
 await insert('time-new-b','time-b','out','new outgoing','2026-10-14T10:05:00.000Z');
 await conv('time-new','ci-time');
 await insert('time-new-message','time-new','in','new inbound','2026-10-14T10:04:00.000Z');
 await insert('time-late-a','time-a','in','late archive','2026-10-14T10:00:00.000Z');
 await insert('time-reaction','time-z','in','reaction','2026-10-14T10:06:00.000Z');
 await db.execute("UPDATE messages SET inbox_event_type='reaction' WHERE id='time-reaction'");
 const second=await listInboxWork({...filter,cursor:first.next_cursor},db);
 assert.deepEqual(second.items.map(x=>x.id),['time-b']);
 assert.equal(second.items[0].message_id,'time-mb','snapshot must keep pre-insert message');
 const third=await listInboxWork({...filter,cursor:second.next_cursor},db);
 assert.deepEqual(third.items.map(x=>x.id),['time-z']);
 assert.equal((await listInboxWork({...filter,cursor:third.next_cursor},db)).done,true);
 const fresh=await listInboxWork({...filter,limit:20},db);
 assert.deepEqual(fresh.items.map(x=>x.id),['time-b','time-new','time-a','time-z']);
 assert.equal(fresh.items[0].direction,'out');
 await assert.rejects(listInboxWork({...filter,account_id:'ci-b',cursor:first.next_cursor},db),/filter_mismatch/);
 const snapshotId=first.next_cursor.split(':')[1];
 await db.execute("UPDATE inbox_page_sets SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",[snapshotId]);
 await assert.rejects(listInboxWork({...filter,cursor:first.next_cursor},db),/expired_refresh/);
 console.log('PASS: real time snapshot ordering, concurrent arrivals, outgoing activity, reaction exclusion, exact pagination, scope and expiry');

 const merged=await mergeConversations({source_id:'ci-05',target_id:'ci-01'},db);
 assert.equal(merged.moved,1);
 const [[mergedCount]]=await db.execute("SELECT COUNT(*) AS n FROM messages WHERE conversation_id='ci-01'");
 assert.equal(Number(mergedCount.n),2,'merged target retains both original messages');
 const [[redirect]]=await db.execute("SELECT target_id FROM conversation_redirects WHERE source_id='ci-05'");
 assert.equal(redirect.target_id,'ci-01');
 const split=await splitConversation({conversation_id:'ci-01',message_ids:['ci-m5']},db);
 assert.equal(split.moved,1);
 const [[left]]=await db.execute("SELECT COUNT(*) AS n FROM messages WHERE conversation_id='ci-01'");
 const [[separated]]=await db.execute("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?",[split.conversation_id]);
 assert.equal(Number(left.n),1);assert.equal(Number(separated.n),1);
 await assert.rejects(mergeConversations({source_id:'ci-04',target_id:'ci-01'},db),/conversation_account_channel_mismatch/);
 console.log('PASS: transactionally merge/split and cross-account isolation without deleting messages');
};
try{await run()}catch(e){console.error('REAL SQL INTEGRATION FAILED:',e);process.exitCode=1}finally{await db.end()}

