import {randomUUID,createHash} from 'node:crypto';
import {whatsappChannelExclusion} from './connectors/whatsapp-channel-filter.js';

// Immutable membership (message IDs, not message bodies) keeps pages stable while
// new messages arrive. A refresh creates a fresh snapshot. No data is deleted.
const TTL_MS=15*60*1000;
export async function migrateInboxTimePages(db){
 await db.query(`CREATE TABLE IF NOT EXISTS inbox_page_sets (
 id VARCHAR(36) PRIMARY KEY,filter_hash CHAR(64) NOT NULL,expires_at VARCHAR(40) NOT NULL,
 INDEX idx_inbox_page_expiry(expires_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db.query(`CREATE TABLE IF NOT EXISTS inbox_page_members (
 snapshot_id VARCHAR(36) NOT NULL,position BIGINT UNSIGNED NOT NULL,
 conversation_id VARCHAR(96) NOT NULL,message_id VARCHAR(128) NOT NULL,
 PRIMARY KEY(snapshot_id,position)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export function decodeTimeCursor(cursor){
 if(!cursor)return null;
 const match=/^t1:([a-f0-9-]{36}):([0-9]{1,12})$/.exec(cursor);
 if(!match||!Number.isSafeInteger(Number(match[2])))throw Error('invalid_inbox_cursor');
 return {id:match[1],position:Number(match[2])};
}
export async function openTimePage({cursor,filters,col},db,clock=Date.now()){
 const identity={...filters};
 // The first page freezes the previous-visit boundary; a later login or a
 // moving first-login fallback must not invalidate a page already in progress.
 if(identity.since_visit)identity.from='previous_visit';
 const hash=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
 const previous=decodeTimeCursor(cursor);
 if(previous){
  const [sets]=await db.execute('SELECT filter_hash,expires_at FROM inbox_page_sets WHERE id=?',[previous.id]);
  if(!sets[0]||sets[0].expires_at<=new Date(clock).toISOString())throw Error('inbox_cursor_expired_refresh');
  if(sets[0].filter_hash!==hash)throw Error('inbox_cursor_filter_mismatch');
  return previous;
 }
 const id=randomUUID(),expires=new Date(clock+TTL_MS).toISOString();
 // Cleanup is bounded to one expired set per refresh; no CRM records are touched.
 const [expired]=await db.execute('SELECT id FROM inbox_page_sets WHERE expires_at<? ORDER BY expires_at LIMIT 1',[new Date(clock).toISOString()]);
 if(expired[0]){
  await db.execute('DELETE FROM inbox_page_members WHERE snapshot_id=?',[expired[0].id]);
  await db.execute('DELETE FROM inbox_page_sets WHERE id=?',[expired[0].id]);
 }
 const where=["COALESCE(m.inbox_event_type,'') NOT IN ('reaction','technical')",
  whatsappChannelExclusion('c'),
  `NOT EXISTS(SELECT 1 FROM messages newer WHERE newer.conversation_id=m.conversation_id
   AND COALESCE(newer.inbox_event_type,'') NOT IN ('reaction','technical')
   AND (newer.sent_at>m.sent_at OR (newer.sent_at=m.sent_at AND newer.id>m.id)))`];
 const params=[];
 for(const [field,value] of [['c.id',filters.conversation_id],['c.account_id',filters.account_id],['c.client_id',filters.client_id],['c.channel',filters.channel]])if(value){where.push(field+'=?');params.push(value);}
 if(filters.from){where.push('m.sent_at>=?');params.push(new Date(filters.from).toISOString());}
 if(filters.to){where.push('m.sent_at<=?');params.push(new Date(filters.to).toISOString());}
 if(filters.q){where.push('(c.title LIKE ? OR m.sender LIKE ? OR cl.name LIKE ? OR EXISTS(SELECT 1 FROM messages searched WHERE searched.conversation_id=m.conversation_id AND searched.body LIKE ?))');params.push(...Array(4).fill('%'+filters.q+'%'));}
 const connection=await db.getConnection();
 try{
  await connection.beginTransaction();
  await connection.execute('INSERT INTO inbox_page_sets(id,filter_hash,expires_at) VALUES(?,?,?)',[id,hash,expires]);
  await connection.execute(`INSERT INTO inbox_page_members(snapshot_id,position,conversation_id,message_id)
   SELECT ?,ROW_NUMBER() OVER (ORDER BY m.sent_at DESC,c.id DESC),c.id,m.id
   FROM conversations c JOIN messages m ON m.conversation_id=c.id COLLATE ${col.message}
   LEFT JOIN clients cl ON cl.id=c.client_id COLLATE ${col.client}
   WHERE ${where.join(' AND ')}`,[id,...params]);
  await connection.commit();
 }catch(error){await connection.rollback();throw error;}finally{connection.release();}
 return {id,position:0};
}
export const timeCursor=(id,position)=>`t1:${id}:${position}`;
