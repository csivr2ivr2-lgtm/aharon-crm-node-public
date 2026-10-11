import {db as defaultDb} from '../db.js';
import {classifyMessage} from './intelligence.js';
import {nonCustomerSignal} from './inbox-signals.js';

// Explicit, repeatable historical triage. No content is deleted and no CRM automation runs.
// Manual feedback, reviewed classifications and existing spam folders are protected.
export async function backfillInboxHistory({cursor='',limit=200}={},database=defaultDb){
 if(typeof cursor!=='string'||cursor.length>128)throw Error('invalid_history_cursor');
 const size=Math.max(1,Math.min(200,Math.trunc(Number(limit)||200)));
 const [messages]=await database.execute(
  "SELECT m.id,m.sender,m.subject,m.body,m.classification,m.classification_reason,m.spam_disposition,c.channel,c.external_id AS conversation_external_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.direction='in' AND m.id>? ORDER BY m.id ASC LIMIT ?",[cursor,size]);
 let updated=0,unchanged=0;
 for(const msg of messages){
  if(String(msg.classification_reason||'').includes('סיווג ידני')||
     !['','unknown','normal'].includes(String(msg.classification||''))||
     !['','inbox'].includes(String(msg.spam_disposition||''))){unchanged++;continue;}
  const detected=nonCustomerSignal(msg)||classifyMessage(msg);
  const valid=detected?.confidence>=.9&&['marketing','system','automated','spam','suspicious'].includes(detected.classification);
  if(!valid){unchanged++;continue;}
  const folder=['marketing','system','automated'].includes(detected.classification)?'updates':detected.classification==='spam'?'spam':'review';
  const [result]=await database.execute(
   "UPDATE messages SET classification=?,classification_score=?,classification_reason=?,spam_disposition=? WHERE id=? AND COALESCE(classification,'unknown') IN ('unknown','normal') AND COALESCE(spam_disposition,'inbox')='inbox' AND COALESCE(classification_reason,'') NOT LIKE '%סיווג ידני%'",
   [detected.classification,detected.confidence,'סינון היסטורי לפי כלל: '+detected.reason,folder,msg.id]);
  if(result.affectedRows)updated++;else unchanged++;
 }
 return {ok:true,scanned:messages.length,updated,unchanged,next_cursor:messages.at(-1)?.id||cursor,done:messages.length<size};
}
