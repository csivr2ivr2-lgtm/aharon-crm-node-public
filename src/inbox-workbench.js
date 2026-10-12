import {createHash} from 'node:crypto';
import {inboxSyncState} from './inbox-sync-state.js';
import {db as defaultDb,now,ensureColumn} from './db.js';
import {audit} from './platform/audit.js';
import {decideInbox,HANDLING_STATES,CALLER_TYPES,MESSAGE_TYPES} from './ai/inbox-decision.js';
export async function migrateInboxWorkbench(database=defaultDb){
 if(database===defaultDb){await ensureColumn('messages','headers_json','TEXT');await ensureColumn('messages','inbox_event_type',"VARCHAR(24) DEFAULT ''");}
 await database.query(`CREATE TABLE IF NOT EXISTS conversation_workflow (
 conversation_id VARCHAR(96) PRIMARY KEY,manual_status VARCHAR(32) DEFAULT 'auto',manual_caller_type VARCHAR(32) DEFAULT 'auto',manual_message_type VARCHAR(32) DEFAULT 'auto',snoozed_until VARCHAR(40),revision INT NOT NULL DEFAULT 0,updated_at VARCHAR(40),actor VARCHAR(100)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await database.query(`CREATE TABLE IF NOT EXISTS message_intelligence (
 message_id VARCHAR(128) PRIMARY KEY,engine_version VARCHAR(64),decision_json LONGTEXT,updated_at VARCHAR(40)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await database.query("CREATE TABLE IF NOT EXISTS inbox_visits(actor VARCHAR(100) PRIMARY KEY,session_key VARCHAR(64),last_seen VARCHAR(40),previous_seen VARCHAR(40)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 // Cover newest-message lookups; safe to retry after a partial migration.
 const [indexes]=await database.query("SHOW INDEX FROM messages WHERE Key_name='idx_inbox_latest'");
 if(!indexes.length)await database.query('ALTER TABLE messages ADD INDEX idx_inbox_latest(conversation_id,sent_at,id)');
}
const scalar=(x,n=128)=>{if(x===undefined||x===null)return '';if(typeof x!=='string'||x.length>n)throw Error('invalid_inbox_filter');return x;};
const folders=['all','needs_reply','waiting_customer','lead','in_progress','done','updates','spam','review','snoozed'];
export function matchesInbox(row,view){
 if(view==='all')return true;
 if(view==='lead')return row.caller_type==='lead'&&!['done','no_action'].includes(row.handling_state);
 if(view==='updates')return ['system','marketing','reaction'].includes(row.message_type);
 if(view==='spam')return row.message_type==='spam';
 return row.handling_state===view;
}
export async function listInboxWork({cursor='',limit=50,since_visit=false,priority='',message_type='',view='needs_reply',q='',account_id='',client_id='',conversation_id='',channel='',from='',to='',sort='priority',maxBatches=20}={},database=defaultDb){
 conversation_id=scalar(conversation_id,96);cursor=scalar(cursor);q=scalar(q,300);account_id=scalar(account_id);client_id=scalar(client_id);channel=scalar(channel,40);from=scalar(from,40);to=scalar(to,40);
 if(priority&&!['high','normal'].includes(priority))throw Error('invalid_inbox_filter');
 let visitKnown=true;
 if(since_visit){const [visits]=await database.execute('SELECT previous_seen FROM inbox_visits WHERE actor=?',['dashboard']);from=visits[0]?.previous_seen||'';visitKnown=Boolean(from);if(!visitKnown)from=new Date(Date.now()-86400000).toISOString();}
 if(message_type&&!MESSAGE_TYPES.includes(message_type))throw Error('invalid_inbox_filter');
 if(!folders.includes(view)||!['priority','time'].includes(sort))throw Error('invalid_inbox_filter');
 for(const date of [from,to])if(date&&!Number.isFinite(Date.parse(date)))throw Error('invalid_inbox_date');
 const count=Math.max(1,Math.min(100,Math.trunc(Number(limit)||50))),batchSize=200;
 const items=[],seen=new Set();let scanned=0,done=false,next=cursor;
 // Cursor is the stable conversation primary key, not an OFFSET into a changing inbox.
 for(let batch=0;batch<Math.max(1,Math.min(50,maxBatches));batch++){
  const where=['c.id>?'],params=[next];
  // Legacy deployments may have different utf8mb4 collations on tables created at different times.
 // Normalize only cross-table comparisons and mixed-source contact names; never rewrite production tables.
 const meaningful=" AND (COALESCE(m.inbox_event_type,'')<>'reaction' OR NOT EXISTS(SELECT 1 FROM messages substance WHERE substance.conversation_id COLLATE utf8mb4_unicode_ci=c.id COLLATE utf8mb4_unicode_ci AND COALESCE(substance.inbox_event_type,'')<>'reaction'))";
  const meaningfulNewer=" AND (COALESCE(newer.inbox_event_type,'')<>'reaction' OR COALESCE(m.inbox_event_type,'')='reaction')";
  for(const [field,value] of [['c.id',conversation_id],['c.account_id',account_id],['c.client_id',client_id],['c.channel',channel]])if(value){where.push(field+'=?');params.push(value);}
  if(from){where.push('m.sent_at>=?');params.push(new Date(from).toISOString());}if(to){where.push('m.sent_at<=?');params.push(new Date(to).toISOString());}
  if(q){where.push("(c.title LIKE ? OR m.sender LIKE ? OR cl.name LIKE ? OR EXISTS(SELECT 1 FROM messages searched WHERE searched.conversation_id=c.id AND searched.body LIKE ?))");params.push(...Array(4).fill('%'+q+'%'));}
  const [rows]=await database.execute(`SELECT c.id,c.title,c.client_id,c.channel,c.account_id,c.external_id AS conversation_external_id,c.unread_count,c.last_message_at,
   a.label AS account_label,a.integration_key,COALESCE(NULLIF(TRIM(cl.name) COLLATE utf8mb4_unicode_ci,''),NULLIF(TRIM(m.sender) COLLATE utf8mb4_unicode_ci,''),c.title COLLATE utf8mb4_unicode_ci) AS contact_name,m.sender,m.subject,
   m.id AS message_id,m.direction,m.sent_at AS waiting_since,m.rfc_message_id,m.classification,m.classification_score,m.headers_json,m.classification_reason,m.spam_disposition,LEFT(COALESCE(m.body,''),20000) AS body,
   w.manual_status,w.manual_caller_type,w.manual_message_type,w.snoozed_until,w.updated_at AS workflow_updated_at,COALESCE(w.revision,0) AS revision,
   EXISTS(SELECT 1 FROM messages reply JOIN conversations reply_conversation ON reply_conversation.id COLLATE utf8mb4_unicode_ci=reply.conversation_id COLLATE utf8mb4_unicode_ci JOIN accounts own_account ON own_account.id COLLATE utf8mb4_unicode_ci=COALESCE(NULLIF(reply.account_id COLLATE utf8mb4_unicode_ci,''),reply_conversation.account_id COLLATE utf8mb4_unicode_ci)
    WHERE m.direction='in' AND m.rfc_message_id<>'' AND reply.direction='out' AND reply.sent_at>=m.sent_at AND reply.id<>m.id
    AND (CASE WHEN JSON_VALID(reply.references_json)=1 THEN JSON_CONTAINS(reply.references_json,JSON_QUOTE(m.rfc_message_id)) ELSE 0 END)=1) AS replied_elsewhere
   FROM conversations c JOIN messages m ON m.conversation_id COLLATE utf8mb4_unicode_ci=c.id COLLATE utf8mb4_unicode_ci
   LEFT JOIN accounts a ON a.id COLLATE utf8mb4_unicode_ci=c.account_id COLLATE utf8mb4_unicode_ci LEFT JOIN clients cl ON cl.id COLLATE utf8mb4_unicode_ci=c.client_id COLLATE utf8mb4_unicode_ci LEFT JOIN conversation_workflow w ON w.conversation_id COLLATE utf8mb4_unicode_ci=c.id COLLATE utf8mb4_unicode_ci
   WHERE ${where.join(' AND ')} ${meaningful} AND NOT (c.channel='whatsapp' AND c.external_id LIKE '%@newsletter') AND NOT EXISTS(SELECT 1 FROM messages newer WHERE newer.conversation_id COLLATE utf8mb4_unicode_ci=c.id COLLATE utf8mb4_unicode_ci ${meaningfulNewer} AND (newer.sent_at>m.sent_at OR (newer.sent_at=m.sent_at AND newer.id>m.id)))
   ORDER BY c.id ASC LIMIT ?`,[...params,batchSize]);
  if(!Array.isArray(rows))throw Error('inbox_read_unavailable');
  scanned+=rows.length;
  for(const row of rows){
   const decision=decideInbox(row);const item={...row,...decision,latest_inbound_body:row.body?.slice(0,900)||'',source_url:'/#conversation='+encodeURIComponent(row.id)};delete item.body;
   if(!matchesInbox(item,view)||message_type&&item.message_type!==message_type||priority==='high'&&item.priority<75||priority==='normal'&&item.priority>=75)continue;
   const key=row.rfc_message_id?row.rfc_message_id+'|'+String(row.sender).toLowerCase():row.id;
   if(seen.has(key))continue;seen.add(key);items.push(item);
  }
  const last=rows.at(-1)?.id;if(last&&last<=next)throw Error('inbox_cursor_not_advancing');next=last||next;
  if(rows.length<batchSize){done=true;break;}
  // Return every match from the final batch; no matched rows are lost behind the cursor.
  if(items.length>=count)break;
 }
 items.sort(sort==='time'?(a,b)=>String(b.waiting_since).localeCompare(String(a.waiting_since)):(a,b)=>b.priority-a.priority||String(a.waiting_since).localeCompare(String(b.waiting_since)));
 return {ok:true,sync:inboxSyncState(),since:from||null,visit_known:visitKnown,themes:inboxThemes(items),items,scanned,next_cursor:next,done,complete:done,scope:'synced_data',ranking_scope:'scanned_conversations',checked_at:now()};
}
export async function updateInboxWork(conversationId,change,{database=defaultDb,actor='dashboard'}={}){
 scalar(conversationId,96);if(!conversationId||!change||typeof change!=='object')throw Error('invalid_inbox_change');
 for(const key of Object.keys(change))if(!['status','caller_type','message_type','snoozed_until','revision'].includes(key))throw Error('invalid_inbox_change');
 if(!Number.isInteger(change.revision)||change.revision<0)throw Error('inbox_revision_required');
 for(const [field,values] of [['status',HANDLING_STATES],['caller_type',CALLER_TYPES],['message_type',MESSAGE_TYPES]])if(change[field]!==undefined&&!values.includes(change[field]))throw Error('invalid_inbox_change');
 if(change.status==='snoozed'&&(!Number.isFinite(Date.parse(change.snoozed_until))||Date.parse(change.snoozed_until)<=Date.now()))throw Error('invalid_snooze_date');
 const c=await database.getConnection();
 try{
  await c.beginTransaction();const [conversations]=await c.execute('SELECT id FROM conversations WHERE id=? FOR UPDATE',[conversationId]);if(!conversations.length)throw Error('conversation_not_found');
  const [rows]=await c.execute('SELECT * FROM conversation_workflow WHERE conversation_id=? FOR UPDATE',[conversationId]);const before=rows[0]||{manual_status:'auto',manual_caller_type:'auto',manual_message_type:'auto',revision:0};
  if(Number(before.revision)!==change.revision)throw Error('inbox_revision_conflict');
  const after={manual_status:change.status??before.manual_status,manual_caller_type:change.caller_type??before.manual_caller_type,manual_message_type:change.message_type??before.manual_message_type,snoozed_until:change.status==='snoozed'?new Date(change.snoozed_until).toISOString():before.snoozed_until||null,revision:before.revision+1};
  await c.execute('INSERT INTO conversation_workflow(conversation_id,manual_status,manual_caller_type,manual_message_type,snoozed_until,revision,updated_at,actor) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE manual_status=VALUES(manual_status),manual_caller_type=VALUES(manual_caller_type),manual_message_type=VALUES(manual_message_type),snoozed_until=VALUES(snoozed_until),revision=VALUES(revision),updated_at=VALUES(updated_at),actor=VALUES(actor)',[conversationId,after.manual_status,after.manual_caller_type,after.manual_message_type,after.snoozed_until,after.revision,now(),actor]);
  await audit({action:'inbox.workflow',actor,source:'manual',entityType:'conversation',entityId:conversationId,before,after},{db:c});await c.commit();return {ok:true,...after};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}

export function inboxThemes(items){
 const themes=[['quote','הצעות מחיר',x=>x.message_type==='quote'],['support','תמיכה ושירות',x=>x.message_type==='support'],['numbers','מספרים וירטואליים ו־SMS',x=>/מספרים|\bSMS\b|virtual numbers/i.test(x.request_summary||'')]];
 return themes.map(([id,label,match])=>{const found=items.filter(x=>!['system','marketing','spam','reaction'].includes(x.message_type)&&match(x));return {id,label,count:found.length,conversation_ids:found.map(x=>x.id).slice(0,10)};}).filter(x=>x.count>1);
}
export async function markInboxVisit(sessionKey,database=defaultDb){
 if(typeof sessionKey!=='string'||!sessionKey)throw Error('login_required');
 const key=createHash('sha256').update(sessionKey).digest('hex');
 await database.execute("INSERT INTO inbox_visits(actor,session_key,last_seen,previous_seen) VALUES('dashboard',?,?,NULL) ON DUPLICATE KEY UPDATE previous_seen=IF(session_key<>VALUES(session_key),last_seen,previous_seen),last_seen=IF(session_key<>VALUES(session_key),VALUES(last_seen),last_seen),session_key=VALUES(session_key)",[key,now()]);
 return {ok:true};
}
