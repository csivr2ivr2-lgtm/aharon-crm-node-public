import {randomUUID} from 'node:crypto';
import {db as defaultDb,now} from './db.js';

const conversationId=value=>{const s=String(value||'');if(!/^[a-zA-Z0-9_-]{1,96}$/.test(s))throw Error('invalid_conversation_id');return s;};
export async function migrateThreading(database=defaultDb){
 await database.query("CREATE TABLE IF NOT EXISTS conversation_redirects (source_id VARCHAR(96) PRIMARY KEY,target_id VARCHAR(96) NOT NULL,created_at VARCHAR(40) NOT NULL,INDEX(target_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
async function recalc(c,id){
 const [[state]]=await c.execute("SELECT MAX(sent_at) AS last_at,SUM(CASE WHEN direction='in' AND is_read=0 THEN 1 ELSE 0 END) AS unread FROM messages WHERE conversation_id=?",[id]);
 await c.execute('UPDATE conversations SET last_message_at=?,unread_count=?,updated_at=? WHERE id=?',[state.last_at||'',Number(state.unread)||0,now(),id]);
}
export async function mergeConversations({source_id,target_id},database=defaultDb){
 const source=conversationId(source_id),target=conversationId(target_id);
 if(source===target)throw Error('conversation_self_merge');
 const c=await database.getConnection();
 try{
  await c.beginTransaction();
  const [rows]=await c.execute('SELECT id,account_id,channel FROM conversations WHERE id IN (?,?) ORDER BY id FOR UPDATE',[source,target]);
  if(rows.length!==2)throw Error('conversation_not_found');
  const a=rows.find(x=>x.id===source),b=rows.find(x=>x.id===target);
  if(!a||!b||a.account_id!==b.account_id||a.channel!==b.channel)throw Error('conversation_account_channel_mismatch');
  const [existing]=await c.execute('SELECT source_id FROM conversation_redirects WHERE source_id=? OR target_id=? LIMIT 1',[target,source]);
  if(existing.length)throw Error('conversation_has_existing_redirect');
  const [moved]=await c.execute('UPDATE messages SET conversation_id=? WHERE conversation_id=?',[target,source]);
  await c.execute('UPDATE conversation_redirects SET target_id=? WHERE target_id=?',[target,source]);
  await c.execute('INSERT INTO conversation_redirects(source_id,target_id,created_at) VALUES(?,?,?)',[source,target,now()]);
  // Retain the target thread's classification and workflow; only the empty source shell is removed.
  await c.execute('DELETE FROM conversation_workflow WHERE conversation_id=?',[source]);
  await c.execute('DELETE FROM conversations WHERE id=?',[source]);
  await recalc(c,target);
  await c.execute("INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES('conversation.merged','conversation',?,'שיחות אוחדו',?,?)",[target,JSON.stringify({source_id:source,target_id:target,count:moved.affectedRows}),now()]);
  await c.commit();return {ok:true,conversation_id:target,moved:Number(moved.affectedRows)||0};
 }catch(err){await c.rollback();throw err;}finally{c.release();}
}
export async function splitConversation({conversation_id,message_ids},database=defaultDb){
 const source=conversationId(conversation_id);
 if(!Array.isArray(message_ids)||!message_ids.length||message_ids.length>200||message_ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))||new Set(message_ids).size!==message_ids.length)throw Error('invalid_split_selection');
 const c=await database.getConnection(),target='conv_split_'+randomUUID().replaceAll('-','');
 try{
  await c.beginTransaction();
  const [conversations]=await c.execute('SELECT * FROM conversations WHERE id=? FOR UPDATE',[source]);
  if(!conversations.length)throw Error('conversation_not_found');
  const current=conversations[0];
  const [count]=await c.execute('SELECT COUNT(*) AS total FROM messages WHERE conversation_id=?',[source]);
  if(message_ids.length>=Number(count[0].total))throw Error('cannot_split_all_messages');
  const placeholders=message_ids.map(()=>'?').join(',');
  const [matches]=await c.execute('SELECT id,sent_at,subject FROM messages WHERE conversation_id=? AND id IN ('+placeholders+')',[source,...message_ids]);
  if(matches.length!==message_ids.length)throw Error('split_messages_not_in_conversation');
  const title=String(matches[0].subject||current.title||'שיחה שהופרדה').slice(0,500);
  await c.execute('INSERT INTO conversations(id,channel,account_id,external_id,title,client_id,project_id,unread_count,last_message_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[target,current.channel,current.account_id,'manual:'+target,title,current.client_id||'',current.project_id||'',0,'',now(),now()]);
  await c.execute('UPDATE messages SET conversation_id=? WHERE conversation_id=? AND id IN ('+placeholders+')',[target,source,...message_ids]);
  await recalc(c,source);await recalc(c,target);
  await c.execute("INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES('conversation.split','conversation',?,'שיחה הופרדה',?,?)",[target,JSON.stringify({source_id:source,target_id:target,count:matches.length}),now()]);
  await c.commit();return {ok:true,conversation_id:target,moved:matches.length};
 }catch(err){await c.rollback();throw err;}finally{c.release();}
}
