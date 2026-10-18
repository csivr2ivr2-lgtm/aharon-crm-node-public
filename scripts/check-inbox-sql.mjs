import {loadRecentChanges} from '../src/ai/changes-brief.js';
import {peopleSyncPage} from '../src/google-people-sync.js';
import {syncProviderMirror,listProviderMirror} from '../src/provider-mirror.js';
import {syncCalendarMirror,listCalendarMirror} from '../src/google-calendar-sync.js';
import {ingestMessage} from '../src/workspace-service.js';
import {updateMailProviderState} from '../src/mail-provider-state.js';
// Isolated integration test: only the CI database set through DB_* is modified.
import assert from 'node:assert/strict';
import {migrateActions} from '../src/ai/actions.js';
import {AssistantChatHistory,migrateAssistantChats} from '../src/assistant-chat-history.js';
import {db,migrate} from '../src/db.js';
import {migrateExtras} from '../src/extra-schema.js';
import {migratePlatform} from '../src/platform/schema.js';
import {migrateIntelligence} from '../src/ai/intelligence.js';
import {migrateInboxWorkbench,listInboxWork,markInboxVisit} from '../src/inbox-workbench.js';
import {migrateHistorySync} from '../src/historical-sync.js';
import {migrateThreading,mergeConversations,splitConversation} from '../src/conversation-threading.js';
import {migrateOwnerMemories,createOwnerMemory,updateOwnerMemory,deleteOwnerMemory,listOwnerMemories,retrieveOwnerMemories} from '../src/owner-memory.js';
import {migrateWhatsAppProfiles,saveWhatsAppProfile,lookupWhatsAppTitle} from '../src/whatsapp-profiles.js';
import {migrateWhatsAppHistory,discoverWhatsAppChat,recordWhatsAppHistoryBatch,listWhatsAppHistory} from '../src/whatsapp-history.js';

assert.equal(process.env.NODE_ENV,'test','Only run with NODE_ENV=test');
assert.equal(process.env.DB_NAME,'crm_ci','Only run against isolated crm_ci database');
assert.equal(process.env.SYNC_ENABLED,'false','Live synchronization must be off');
assert.equal(process.env.TASK_WORKER_ENABLED,'false','Background worker must be off');

const run=async()=>{
 const [[version]]=await db.query('SELECT VERSION() AS version');
 console.log('Connected to actual SQL server version:',version.version);
 await migrate();
 await migrateExtras();
 await migrateExtras(); // All additive mirror migrations are idempotent.
 await migratePlatform();
 await migrateIntelligence();
 await migrateInboxWorkbench();
 await migrateInboxWorkbench(); // Must remain safe if startup is repeated.
 await migrateHistorySync(db);
 await migrateHistorySync(db);
 await migrateThreading(db);
 await migrateThreading(db);
 await migrateOwnerMemories(db);
 await migrateOwnerMemories(db);
 await migrateWhatsAppProfiles(db);
 await migrateWhatsAppProfiles(db);
 await migrateWhatsAppHistory(db);
 await migrateWhatsAppHistory(db);
 await discoverWhatsAppChat({account_id:'whatsapp-main',jid:'126509016678653@lid'},db);
 await recordWhatsAppHistoryBatch({account_id:'whatsapp-main',jid:'126509016678653@lid',imported:2,duplicates:1},db);
 const waHistory=await listWhatsAppHistory({account_id:'whatsapp-main'},db);
 assert.equal(Number(waHistory.summary.imported),2);
 assert.equal(Number(waHistory.summary.duplicates),1);
 assert.equal(waHistory.coverage,'partial_unverified');
 console.log('PASS: idempotent WhatsApp history schema and reliable per-chat totals');

 const memory=await createOwnerMemory({kind:'decision',subject:'CI memory test',body:'Private manual decision'},db);
 assert.ok((await listOwnerMemories({},db)).items.some(row=>row.id===memory.id));
 await updateOwnerMemory({id:memory.id,revision:1,kind:'decision',subject:'CI memory test',body:'Updated private decision'},db);
 await deleteOwnerMemory({id:memory.id,revision:2},db);
 assert.ok(!(await listOwnerMemories({},db)).items.some(row=>row.id===memory.id));
 console.log('PASS: real SQL owner-memory migrations, revision edits, deletion');
 const recalled=await createOwnerMemory({kind:'decision',subject:'מחירון אוריון',body:'החלטה ישנה ורלוונטית'},db);
 await db.execute('UPDATE owner_memories SET updated_at=? WHERE id=?',['2020-01-01T00:00:00.000Z',recalled.id]);
 const memoryIds=[recalled.id];
 for(let i=0;i<205;i++)memoryIds.push((await createOwnerMemory({kind:'fact',subject:'נושא בלתי קשור '+i,body:'מידע אחר'},db)).id);
 const temporary=await createOwnerMemory({kind:'temporary',subject:'מחירון אוריון',body:'תזכורת שפגה'},db);memoryIds.push(temporary.id);
 await db.execute('UPDATE owner_memories SET updated_at=? WHERE id=?',['2020-01-01T00:00:00.000Z',temporary.id]);
 const inference=await createOwnerMemory({kind:'inference',subject:'מחירון אוריון',body:'השערה בלבד'},db);memoryIds.push(inference.id);
 const memories=await retrieveOwnerMemories({query:'מחירון אוריון'},db);
 assert.ok(memories.some(m=>m.id===recalled.id));assert.ok(!memories.some(m=>m.id===temporary.id));
 assert.equal(memories.find(m=>m.id===inference.id).evidence,'unverified_inference');
 for(const id of memoryIds)await deleteOwnerMemory({id,revision:1},db);
 console.log('PASS: real SQL relevance before limit, old Hebrew decisions and temporary/inference separation');
 await migrateActions(db);await migrateActions(db);
 await migrateAssistantChats(db);await migrateAssistantChats(db);
 let recalledChat;
 const sourceMemory=await createOwnerMemory({kind:'fact',subject:'מקור לתשובה',body:'תוכן פרטי'},db);
 const chat=new AssistantChatHistory({database:db,assistant:{chat:async input=>{recalledChat=input;return {reply:'נבדק',actions:[],memory_sources:[{id:sourceMemory.id,revision:1,evidence:'owner_assertion',updated_at:new Date().toISOString()}]};}}});
 const chatId=(await chat.create()).id,otherChatId=(await chat.create()).id;
 const turn=async(id,session,body,at)=>db.execute('INSERT INTO assistant_chat_turns(id,session_id,role,body,request_id,created_at) VALUES(?,?,?,?,?,?)',[id,session,'user',body,id,at]);
 await turn('sql_old_decision',chatId,'מחירון אוריון תשעה שקלים','2020-01-01T00:00:00.000Z');
 await turn('sql_private_decision',otherChatId,'מחירון אוריון מידע חסוי','2020-01-01T00:00:00.000Z');
 for(let i=0;i<405;i++)await turn('sql_history_'+i,chatId,'שיחה אחרת '+i,new Date(1700000000000+i*1000).toISOString());
 const loadedChat=await chat.load(chatId);assert.equal(loadedChat.messages.length,400);assert.equal(loadedChat.messages.at(-1).id,'sql_history_404');
 await chat.send({sessionId:chatId,message:'מה מחירון אוריון?',requestId:'sql_recall_request',context:{}});
 assert.ok(recalledChat.recalledHistory.some(t=>t.text.includes('תשעה')));
 assert.ok(!recalledChat.recalledHistory.some(t=>t.text.includes('חסוי')));
 let sourceView=(await chat.load(chatId)).messages.at(-1).memory_sources[0];assert.equal(sourceView.status,'current');
 await updateOwnerMemory({id:sourceMemory.id,revision:1,kind:'fact',subject:'מקור מעודכן',body:'עודכן'},db);
 sourceView=(await chat.load(chatId)).messages.at(-1).memory_sources[0];assert.equal(sourceView.status,'changed');
 await deleteOwnerMemory({id:sourceMemory.id,revision:2},db);
 sourceView=(await chat.load(chatId)).messages.at(-1).memory_sources[0];assert.equal(sourceView.status,'unavailable');assert.equal(sourceView.subject,'');
 console.log('PASS: persistent source revisions, changed/deleted source labels without copying memory content');
 for(const id of [chatId,otherChatId]){await db.execute('DELETE FROM assistant_chat_turns WHERE session_id=?',[id]);await db.execute('DELETE FROM assistant_chat_sessions WHERE id=?',[id]);}
 console.log('PASS: real SQL long-chat latest window and session-isolated relevant recall');

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
 const [labelSources]=await db.query("SHOW COLUMNS FROM accounts LIKE 'label_source'");
 assert.equal(labelSources.length,1,'account label protection migration missing');
 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key,label_source) VALUES('ci-owner-label','email','Owner chosen label','account-label@example.test','ci:owner-label','manual')");
 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key,label_source) VALUES('ci-owner-label','email','Synced provider name','account-label@example.test','ci:owner-label','connector') ON DUPLICATE KEY UPDATE label=IF(label_source='manual',label,VALUES(label))");
 const [[labelRow]]=await db.execute("SELECT label,label_source FROM accounts WHERE id='ci-owner-label'");
 assert.equal(labelRow.label,'Owner chosen label');
 assert.equal(labelRow.label_source,'manual');
 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key,label_source) VALUES('ci-auto-label','email','Old provider label','auto@example.test','ci:auto-label','connector')");
 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key,label_source) VALUES('ci-auto-label','email','New provider label','auto@example.test','ci:auto-label','connector') ON DUPLICATE KEY UPDATE label=IF(label_source='manual',label,VALUES(label))");
 const [[autoLabel]]=await db.execute("SELECT label FROM accounts WHERE id='ci-auto-label'");
 assert.equal(autoLabel.label,'New provider label');
 console.log('PASS: manual account labels cannot be overwritten by sync');
 await db.execute("INSERT INTO accounts(id,type,label,identifier,status,integration_key) VALUES('ci-whatsapp','whatsapp','Test account','whatsapp-main','active','whatsapp:whatsapp-main')");
 await db.execute("INSERT INTO conversations(id,channel,account_id,external_id,title,client_id) VALUES('ci-wa-chat','whatsapp','ci-whatsapp','126509016678653@lid','126509016678653@lid','')");
 await saveWhatsAppProfile({account_id:'whatsapp-main',jid:'126509016678653@lid',name:'Verified test contact',phone_jid:'972537291432@s.whatsapp.net'},db);
 const [[waChat]]=await db.execute("SELECT title FROM conversations WHERE id='ci-wa-chat'");
 assert.equal(waChat.title,'Verified test contact · 972537291432');
 assert.equal(await lookupWhatsAppTitle({account_id:'whatsapp-main',jid:'126509016678653@lid'},db),'Verified test contact · 972537291432');
 console.log('PASS: real SQL WhatsApp profile lookup and historical title backfill');

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

 // Moderate-size isolated fixture: exercise multi-page chronological ordering and
 // immutable pagination with 300 conversations and 600 messages on REAL databases.
 // This is a functional scale check, not a production latency benchmark.
 await db.execute("INSERT INTO accounts(id,type,label,identifier,integration_key) VALUES('ci-scale','email','Scale fixture','scale@example.test','ci:scale')");
 const total=300,block=100,base=Date.parse('2026-10-14T09:00:00.000Z');
 const conversations=Array.from({length:total},(_,i)=>'ci-scale-'+String(i).padStart(4,'0'));
 for(let offset=0;offset<total;offset+=block){
  const ids=conversations.slice(offset,offset+block);
  await db.execute("INSERT INTO conversations(id,channel,account_id,external_id,title,client_id) VALUES "+ids.map(()=>' (?,?,?,?,?,?)').join(','),ids.flatMap(id=>[id,'email','ci-scale',id,'CI load','']));
 }
 for(let offset=0;offset<total;offset+=block){
  const ids=conversations.slice(offset,offset+block);
  const records=ids.flatMap((cid,j)=>[0,1].map(part=>({
   id:cid+'-m'+part,cid,stamp:new Date(base+((offset+j)*2+part)*60000).toISOString()
  })));
  await db.execute("INSERT INTO messages(id,conversation_id,external_id,direction,sender,subject,body,sent_at,rfc_message_id,references_json,classification) VALUES "+records.map(()=>' (?,?,?,?,?,?,?,?,?,?,?)').join(','),records.flatMap(m=>[m.id,m.cid,m.id,'in','scale@example.test','CI fixture','test inquiry',m.stamp,'','[]','normal']));
 }
 const query={view:'all',account_id:'ci-scale',limit:50};
 const begun=Date.now(),firstLoad=await listInboxWork(query,db);
 const firstMs=Date.now()-begun;
 assert.equal(firstLoad.items.length,50,'initial large fixture page must fill all slots');
 assert.equal(firstLoad.items[0].id,conversations[total-1],'newest conversation should be globally first');
 await db.execute("INSERT INTO conversations(id,channel,account_id,external_id,title,client_id) VALUES('ci-scale-new','email','ci-scale','ci-scale-new','New during pagination','')");
 await insert('ci-scale-new-m','ci-scale-new','in','new message mid-page',new Date(base+(total*2+2)*60000).toISOString());
 let all=firstLoad.items.map(x=>x.id),cursor=firstLoad.next_cursor,done=firstLoad.done,pageCount=1;
 while(!done&&pageCount<12){
  const next=await listInboxWork({...query,cursor},db);
  all.push(...next.items.map(x=>x.id));cursor=next.next_cursor;done=next.done;pageCount++;
 }
 assert.equal(done,true,'all snapshot pages should finish');
 assert.equal(all.length,total,'snapshot must keep original membership without losing rows');
 assert.equal(new Set(all).size,total,'no duplicates across pages');
 assert.ok(!all.includes('ci-scale-new'),'new arrival must not shift existing snapshot');
 const after=await listInboxWork({...query,limit:10},db);
 assert.equal(after.items[0].id,'ci-scale-new','refreshed snapshot must show newly arrived conversation');
 console.log('PASS: 300 real SQL conversations, 600 messages, stable paging after concurrent arrivals; initial snapshot ms='+firstMs+'; pages='+pageCount);

 // Provider flags are independent of CRM reads, isolated even for equal provider IDs.
 const gmailFixture=account=>({source:'google.gmail',channel:'email',account_id:account,
  account:{provider:'google',type:'email',identifier:account+'@example.test',label:'SQL test'},
  conversation_external_id:'thread-same',external_id:'message-same',sender:'sender@example.test',
  recipient:account+'@example.test',body:'Synthetic sync record',sent_at:'2026-01-01T00:00:00Z',
  is_read:true,provider_state:{available:true,labels:['INBOX']}});
 const a=await ingestMessage(gmailFixture('sql-gmail-a'));
 const b=await ingestMessage(gmailFixture('sql-gmail-b'));
 assert.notEqual(a.message_id,b.message_id);
 const replay=await ingestMessage({...gmailFixture('sql-gmail-a'),is_read:false,provider_state:{available:true,labels:['UNREAD','SPAM']}});
 assert.equal(replay.inserted,false);
 let [providerRows]=await db.execute('SELECT id,is_read,provider_state_json FROM messages WHERE id IN (?,?) ORDER BY id',[a.message_id,b.message_id]);
 const providerA=providerRows.find(x=>x.id===a.message_id),providerB=providerRows.find(x=>x.id===b.message_id);
 assert.equal(Number(providerA.is_read),1,'provider UNREAD must not undo CRM read');
 assert.deepEqual(JSON.parse(providerA.provider_state_json).labels,['UNREAD','SPAM']);
 assert.deepEqual(JSON.parse(providerB.provider_state_json).labels,['INBOX']);
 await updateMailProviderState({source:'google.gmail',account_id:'sql-gmail-a',external_id:'message-same',provider_state:{available:false,labels:[]}},db);
 [providerRows]=await db.execute('SELECT id,body,provider_state_json FROM messages WHERE id IN (?,?)',[a.message_id,b.message_id]);
 assert.equal(providerRows.length,2);
 assert.equal(JSON.parse(providerRows.find(x=>x.id===a.message_id).provider_state_json).available,false);
 assert.equal(JSON.parse(providerRows.find(x=>x.id===b.message_id).provider_state_json).available,true);
 assert.ok(providerRows.every(x=>x.body==='Synthetic sync record'));
 console.log('PASS: Gmail provider flags/replay/tombstones preserve CRM reads, bodies and account isolation');
 const calendarFixture=summary=>({events:{list:async()=>({data:{items:[{id:'same-event',summary,start:{date:'2026-10-20'}}],nextSyncToken:'checkpoint'}})}});
 await syncCalendarMirror({account_id:'calendar-a',calendar:calendarFixture('Account A'),db});
 await syncCalendarMirror({account_id:'calendar-b',calendar:calendarFixture('Account B'),db});
 await syncCalendarMirror({account_id:'calendar-a',calendar:calendarFixture('Updated A'),db});
 assert.equal((await listCalendarMirror({account_id:'calendar-a',db})).events[0].summary,'Updated A');
 assert.equal((await listCalendarMirror({account_id:'calendar-b',db})).events[0].summary,'Account B');
 const expired={events:{list:async p=>{if(p.syncToken)throw {code:410};return {data:{items:[],nextSyncToken:'reset'}};}}};
 assert.equal((await syncCalendarMirror({account_id:'calendar-a',calendar:expired,db})).recovered,true);
 assert.equal((await listCalendarMirror({account_id:'calendar-a',db})).events.length,0);
 const [[retained]]=await db.execute("SELECT COUNT(*) n FROM google_calendar_events");
 assert.equal(Number(retained.n),2,'expired generations retain historical records');
 console.log('PASS: real SQL Calendar checkpoints, replay, account isolation and nondestructive 410 recovery');
 const drivePage=(name,available=true)=>async()=>({items:[{id:'same-file',name,available}],nextState:{mode:'delta',generation:'g',anchor:'100',page:''}});
 for(const account_id of ['drive-a','drive-b'])await syncProviderMirror({provider:'google.drive',account_id,db,fetchPage:drivePage(account_id)});
 await syncProviderMirror({provider:'google.drive',account_id:'drive-a',db,fetchPage:drivePage('removed',false)});
 assert.equal((await listProviderMirror({provider:'google.drive',account_id:'drive-a',db})).items.length,0);
 assert.equal((await listProviderMirror({provider:'google.drive',account_id:'drive-b',db})).items[0].name,'drive-b');
 const [[preserved]]=await db.execute("SELECT COUNT(*) n FROM provider_records WHERE available=0 AND payload_json LIKE ?",['%drive-a%']);
 assert.equal(Number(preserved.n),1,'loss of provider access hides but preserves historical metadata');
 let arrived=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const concurrent=async()=>{if(++arrived===2)release();await gate;return {items:[{id:'race-file',name:'race',available:true}],nextState:{mode:'delta',generation:'r',anchor:'200',page:''}};};
 const races=await Promise.allSettled([1,2].map(()=>syncProviderMirror({provider:'google.drive',account_id:'drive-race',db,fetchPage:concurrent})));
 assert.equal(races.filter(x=>x.status==='fulfilled').length,1);
 assert.match(races.find(x=>x.status==='rejected').reason.message,/provider_checkpoint_conflict/);
 assert.equal((await listProviderMirror({provider:'google.drive',account_id:'drive-race',db})).items.length,1);
 console.log('PASS: real SQL Drive access removal, retained metadata, account isolation and concurrent checkpoint conflict');

 const peopleClient=connections=>({people:{connections:{list:async()=>({data:{connections,nextSyncToken:'people-checkpoint'}})}}});
 for(const account_id of ['people-a','people-b'])await syncProviderMirror({provider:'google.people',account_id,db,
  fetchPage:state=>peopleSyncPage(peopleClient([{resourceName:'people/same',names:[{displayName:account_id}],emailAddresses:[{value:'same@example.test'}]}]),state)});
 await syncProviderMirror({provider:'google.people',account_id:'people-a',db,
  fetchPage:state=>peopleSyncPage(peopleClient([{resourceName:'people/same',metadata:{deleted:true}}]),state)});
 assert.equal((await listProviderMirror({provider:'google.people',account_id:'people-a',db})).items.length,0);
 assert.equal((await listProviderMirror({provider:'google.people',account_id:'people-b',db})).items[0].name,'people-b');
 const [[peopleHistory]]=await db.execute("SELECT COUNT(*) n FROM provider_records WHERE available=0 AND payload_json LIKE ?",['%people-a%']);
 assert.equal(Number(peopleHistory.n),1);
 console.log('PASS: real SQL People account isolation and deletion preserve historical contact records');
 const imapEvent={...gmailFixture('sql-imap'),source:'hostinger.imap',account:{provider:'hostinger',type:'email',identifier:'imap@example.test'},provider_state:{protocol:'imap',folder:'INBOX',uid:'5',uid_validity:'123',flags:[],unread:true,observed_at:new Date().toISOString()}};
 const imapMessage=await ingestMessage(imapEvent);
 const imapReplay=await ingestMessage({...imapEvent,provider_state:{...imapEvent.provider_state,folder:'Archive',uid:'2',uid_validity:'456',flags:['\\\\Seen'],unread:false}});
 assert.equal(imapReplay.inserted,false);
 const [[imapStored]]=await db.execute('SELECT provider_state_json,is_read FROM messages WHERE id=?',[imapMessage.message_id]);
 assert.equal(JSON.parse(imapStored.provider_state_json).folder,'Archive');
 assert.equal(JSON.parse(imapStored.provider_state_json).uid_validity,'456');
 assert.equal(Number(imapStored.is_read),1,'provider flags cannot undo the CRM read state');
 console.log('PASS: real SQL IMAP replay updates source observation without duplicating messages');
 const changes=await loadRecentChanges({hours:24,clock:Date.now(),database:db});
 assert.equal(changes.ok,true);
 assert.ok(changes.messages.every(m=>Date.parse(m.sent_at)<=Date.parse(changes.window.until)));
 assert.ok(changes.messages.every(m=>m.source.id===m.id));
 console.log('PASS: real SQL operational changes read across legacy mixed collations');
};
try{await run()}catch(e){
 // Public CI annotations must never contain SQL values, credentials or raw errors.
 const code=/^[A-Z_0-9]{1,80}$/.test(String(e.code||''))?e.code:'SQL_TEST_FAILED';
 const frames=String(e.stack||'').match(/(?:src|scripts)\/[a-zA-Z0-9_./-]+\.(?:js|mjs):[0-9]+:[0-9]+/g)||[];
 console.error('::error title=SQL integration failure::'+code+'; '+frames.slice(0,3).join(' > '));
 console.error('REAL SQL INTEGRATION FAILED:',e);process.exitCode=1;
}finally{await db.end()}


