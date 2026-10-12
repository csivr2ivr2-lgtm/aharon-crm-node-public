// Isolated integration test: only the CI database set through DB_* is modified.
import assert from 'node:assert/strict';
import {db,migrate} from '../src/db.js';
import {migrateExtras} from '../src/extra-schema.js';
import {migratePlatform} from '../src/platform/schema.js';
import {migrateIntelligence} from '../src/ai/intelligence.js';
import {migrateInboxWorkbench,listInboxWork,markInboxVisit} from '../src/inbox-workbench.js';

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
 console.log('PASS: additive inbox migration applied twice');

 const [columns]=await db.query('SHOW COLUMNS FROM messages');
 const names=new Set(columns.map(x=>x.Field));
 for(const name of ['headers_json','inbox_event_type','references_json','classification','classification_score','classification_reason','spam_disposition'])assert.ok(names.has(name),'missing column '+name);
 const [index]=await db.query("SHOW INDEX FROM messages WHERE Key_name='idx_inbox_latest'");
 assert.deepEqual(index.map(x=>x.Column_name).sort(),['conversation_id','id','sent_at'].sort());
 for(const name of ['conversation_workflow','message_intelligence','inbox_visits']){
  const [found]=await db.query('SHOW TABLES LIKE ?',[name]);
  assert.equal(found.length,1,'missing table '+name);
 }
 console.log('PASS: columns, tables, index');

 const [jsonRows]=await db.execute("SELECT JSON_VALID(?) AS valid,JSON_CONTAINS(IF(JSON_VALID(?),?,'[]'),JSON_QUOTE(?)) AS matched",['["<request>"]','["<request>"]','["<request>"]','<request>']);
 assert.equal(Number(jsonRows[0].valid),1);
 assert.equal(Number(jsonRows[0].matched),1);
 const [invalidRows]=await db.execute("SELECT JSON_CONTAINS(IF(JSON_VALID(?),?,'[]'),JSON_QUOTE(?)) AS matched",['invalid-json','invalid-json','<request>']);
 assert.equal(Number(invalidRows[0].matched),0);
 console.log('PASS: JSON_VALID/JSON_CONTAINS with valid and invalid JSON');

 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key) VALUES('ci-a','email','CI account','ci@example.test','ci:a'),('ci-b','email','CI other','ci2@example.test','ci:b')");
 const conv=async(id,account='ci-a')=>db.execute('INSERT INTO conversations(id,channel,account_id,external_id,title,client_id) VALUES(?,?,?,?,?,?)',[id,'email',account,id,'CI conversation','']);
 for(const id of ['ci-01','ci-02','ci-03','ci-04','ci-05'])await conv(id,id==='ci-04'?'ci-b':'ci-a');
 const insert=async(id,cid,direction,body,when,rfc='',refs='[]',classification='normal')=>{
  await db.execute('INSERT INTO messages(id,conversation_id,external_id,direction,sender,subject,body,sent_at,rfc_message_id,references_json,classification) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,cid,id,direction,'customer@example.test','CI inquiry',body,when,rfc,refs,classification]);
 };
 const old='2026-10-11T08:00:00.000Z',recent='2026-10-12T10:00:00.000Z';
 await insert('ci-m1','ci-01','in','אני רוצה הצעת מחיר ל-10 מספרים',recent,'<quote>');
 await insert('ci-m2','ci-02','out','שלחתי תשובה',recent,'<sent>');
 await insert('ci-m3','ci-03','in','אני צריך שירות',old,'<request>');
 await insert('ci-m4','ci-04','out','תשובה מחשבון אחר',recent,'<reply>','["<request>"]');
 await insert('ci-m5','ci-05','in','אני רוצה הצעת מחיר חדשה',recent,'<renewal>');
 await db.execute("INSERT INTO conversation_workflow(conversation_id,manual_status,revision,updated_at) VALUES('ci-05','done',1,?)",[old]);
 const captured=[];
 const recording={execute:async(sql,params)=>{if(sql.includes('FROM conversations c JOIN messages m'))captured.push([sql,params]);return db.execute(sql,params);}};
 const waiting=await listInboxWork({view:'needs_reply',maxBatches:1},recording);
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
 const [plan]=await db.execute('EXPLAIN '+captured[0][0],captured[0][1]);
 assert.ok(plan.length,'missing EXPLAIN rows for full work queue query');
 const [refPlan]=await db.execute("EXPLAIN SELECT id FROM messages WHERE JSON_CONTAINS(IF(JSON_VALID(references_json),references_json,'[]'),JSON_QUOTE(?))=1",['<request>']);
 assert.ok(refPlan.length,'missing JSON EXPLAIN');
 console.log('PASS: actual EXPLAIN for production-style inbox queue and JSON reference query');
 console.log('EXPLAIN operators:',JSON.stringify(plan.map(x=>({table:x.table,type:x.type,key:x.key,rows:x.rows}))));
 await markInboxVisit('ci-session',db);
 const [visit]=await db.query("SELECT COUNT(*) AS n FROM inbox_visits WHERE actor='dashboard'");
 assert.equal(Number(visit[0].n),1);
 console.log('PASS: session visit persisted');
};
try{await run()}catch(e){console.error('REAL SQL INTEGRATION FAILED:',e);process.exitCode=1}finally{await db.end()}
