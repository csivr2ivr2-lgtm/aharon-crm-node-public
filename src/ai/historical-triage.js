import {db as defaultDb,now} from '../db.js';
import {classifyMessage} from './intelligence.js';
import {nonCustomerSignal} from './inbox-signals.js';
import {decideInbox,INBOX_ENGINE_VERSION} from './inbox-decision.js';

// Preview and apply share the exact same batch and deterministic engine. No AI/automation.
export async function backfillInboxHistory({cursor='',limit=200,dry_run=false}={},database=defaultDb){
 if(typeof cursor!=='string'||cursor.length>128||typeof dry_run!=='boolean')throw Error('invalid_history_cursor');
 const size=Math.max(1,Math.min(200,Math.trunc(Number(limit)||200)));
 const [messages]=await database.execute(
  "SELECT m.id,m.sender,m.subject,m.body,m.headers_json,m.classification,m.classification_reason,m.spam_disposition,c.client_id,c.channel,c.external_id AS conversation_external_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.direction='in' AND m.id>? ORDER BY m.id ASC LIMIT ?",[cursor,size]);
 let updated=0,unchanged=0,proposed=0;const preview=[];
 for(const msg of messages){
  if(String(msg.classification_reason||'').includes('סיווג ידני')||!['','unknown','normal'].includes(String(msg.classification||''))||!['','inbox'].includes(String(msg.spam_disposition||''))){unchanged++;continue;}
  const detected=nonCustomerSignal(msg)||classifyMessage(msg),decision=decideInbox(msg);
  const valid=detected?.confidence>=.9&&['marketing','system','automated','spam','suspicious'].includes(detected.classification);
  const folder=valid?(['marketing','system','automated'].includes(detected.classification)?'updates':detected.classification==='spam'?'spam':'review'):'inbox';
  if(valid){proposed++;if(preview.length<30)preview.push({id:msg.id,subject:String(msg.subject||'').slice(0,180),classification:detected.classification,folder,reason:detected.reason,confidence:detected.confidence});}
  if(dry_run)continue;
  if(detected.event_type==='reaction')await database.execute("UPDATE messages SET inbox_event_type='reaction' WHERE id=? AND COALESCE(classification_reason,'') NOT LIKE '%סיווג ידני%'",[msg.id]);
  if(valid){
   const [result]=await database.execute(
    "UPDATE messages SET classification=?,classification_score=?,classification_reason=?,spam_disposition=? WHERE id=? AND COALESCE(classification,'unknown') IN ('unknown','normal') AND COALESCE(spam_disposition,'inbox')='inbox' AND COALESCE(classification_reason,'') NOT LIKE '%סיווג ידני%'",
    [detected.classification,detected.confidence,'סינון היסטורי לפי כלל: '+detected.reason,folder,msg.id]);
   if(result.affectedRows)updated++;else unchanged++;
  }else unchanged++;
  await database.execute('INSERT INTO message_intelligence(message_id,engine_version,decision_json,updated_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE engine_version=VALUES(engine_version),decision_json=VALUES(decision_json),updated_at=VALUES(updated_at)',[msg.id,INBOX_ENGINE_VERSION,JSON.stringify(decision),now()]);
 }
 return {ok:true,dry_run,engine_version:INBOX_ENGINE_VERSION,scanned:messages.length,proposed,preview,updated,unchanged,next_cursor:messages.at(-1)?.id||cursor,done:messages.length<size};
}
