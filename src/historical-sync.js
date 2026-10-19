import {ingestionOutcome} from './ingestion-result.js';
import {createHash} from 'node:crypto';
import {db as defaultDb,now} from './db.js';
import {enqueueJob} from './platform/jobs.js';
import {emailOf} from './message-format.js';
import {googleConnector,hostingerMail} from './clients/connectors.js';

const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,28);
const jobKey=(key,cursor)=>'historical:'+hash(key)+':'+hash(cursor||'start');
export async function migrateHistorySync(database=defaultDb){
 await database.query(`CREATE TABLE IF NOT EXISTS historical_sync_progress (
  account_key VARCHAR(320) PRIMARY KEY, provider VARCHAR(24) NOT NULL, page_cursor TEXT,
  state VARCHAR(16) NOT NULL DEFAULT 'running', examined INT NOT NULL DEFAULT 0,
  imported INT NOT NULL DEFAULT 0, duplicates INT NOT NULL DEFAULT 0,
  last_error VARCHAR(100), updated_at VARCHAR(40), completed_at VARCHAR(40)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function listHistoryProgress(database=defaultDb){
 const [items]=await database.execute('SELECT account_key,provider,state,examined,imported,duplicates,last_error,updated_at,completed_at FROM historical_sync_progress ORDER BY account_key');
 return {ok:true,items};
}
// Restarts and multiple instances are safe: cursor-based keys deduplicate jobs.
// A missed scheduling step is recovered by the next periodic discovery.
export async function discoverHistoryAccounts({database=defaultDb,google=googleConnector,hostinger=hostingerMail,enqueue=enqueueJob}={}){
 const accounts=(await google.accounts()).map(a=>({provider:'google',accountId:a.id,key:'google:'+a.id}));
 if(hostinger.configured()){
  const id=hostinger.settings().user;
  if(id)accounts.push({provider:'hostinger',accountId:id,key:'hostinger:'+id.toLowerCase()});
 }
 let scheduled=0;
 for(const account of accounts){
  await database.execute("INSERT IGNORE INTO historical_sync_progress(account_key,provider,page_cursor,state,updated_at) VALUES(?,?,'','running',?)",[account.key,account.provider,now()]);
  const [rows]=await database.execute('SELECT page_cursor,state FROM historical_sync_progress WHERE account_key=?',[account.key]);
  if(!rows.length||rows[0].state==='done')continue;
  await enqueue('history.page',{provider:account.provider,accountId:account.accountId,key:account.key},{idempotencyKey:jobKey(account.key,rows[0].page_cursor),db:database,maxAttempts:10});
  scheduled++;
 }
 return {ok:true,accounts:accounts.length,scheduled};
}
export async function historyPageJob(payload,{database=defaultDb,google=googleConnector,hostinger=hostingerMail,enqueue=enqueueJob,ingest}={}){
 if(!ingest)throw Error('history_ingest_required');
 const {provider,accountId,key}=payload||{};
 if(!['google','hostinger'].includes(provider)||typeof accountId!=='string'||!accountId||key!==provider+':'+(provider==='hostinger'?accountId.toLowerCase():accountId))throw Error('invalid_history_account');
 const [records]=await database.execute('SELECT page_cursor,state FROM historical_sync_progress WHERE account_key=?',[key]);
 if(!records.length||records[0].state==='done')return {ok:true,skipped:true};
 const cursor=String(records[0].page_cursor||'');
 let page,events;
 if(provider==='google'){
  page=await google.historyPage({account_id:accountId,page_token:cursor,limit:10});
  events=page.messages.map(m=>{
   const fromSelf=emailOf(m.from)===String(page.account.email).toLowerCase();
   return {id:'gmail:'+accountId+':'+m.id,type:'message',source:'google.gmail',channel:'email',
    account_id:accountId,account:{provider:'google',type:'email',identifier:page.account.email,label:page.account.name||page.account.email},
    conversation_external_id:'gmail:'+accountId+':'+(m.thread_id||m.id),external_id:m.id,thread_id:m.thread_id,
    direction:fromSelf?'out':'in',sender:m.from,recipient:m.to,cc:m.cc,headers:m.headers,
    rfc_message_id:m.message_id,references:m.references,subject:m.subject,attachments:m.attachments,body_html:m.body_html,body:m.body,is_read:!m.unread,sent_at:m.sent_at};
  });
 }else{
  if(!hostinger.configured()||hostinger.settings().user.toLowerCase()!==accountId.toLowerCase())throw Error('hostinger_history_account_unavailable');
  page=await hostinger.historyPage({cursor,limit:10});events=page.messages;
 }
 let imported=0,duplicates=0;
 for(const event of events){
  const result=await ingest(event);
  if(ingestionOutcome(result)==='imported')imported++;else duplicates++;
 }
 // Always commit progress after ALL events were ingested, never before.
 const done=page.done===true,nextCursor=done?'':String(page.next_cursor||'');
 if(!done&&(!nextCursor||nextCursor===cursor))throw Error('history_cursor_not_advancing');
 const [update]=await database.execute("UPDATE historical_sync_progress SET page_cursor=?,state=?,examined=examined+?,imported=imported+?,duplicates=duplicates+?,updated_at=?,completed_at=? WHERE account_key=? AND state='running' AND page_cursor=?",[nextCursor,done?'done':'running',events.length,imported,duplicates,now(),done?now():null,key,cursor]);
 if(update.affectedRows!==1)throw Error('history_checkpoint_conflict');
 if(!done)await enqueue('history.page',{provider,accountId,key},{idempotencyKey:jobKey(key,nextCursor),db:database,maxAttempts:10,runAfter:new Date(Date.now()+3000).toISOString()});
 return {ok:true,done,examined:events.length,imported,duplicates};
}
