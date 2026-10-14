import {db as defaultDb,now} from './db.js';
import {isWhatsAppConversationJid} from './connectors/whatsapp-channel-filter.js';

const accountKey=id=>{
 if(typeof id!=='string'||!/^(?:whatsapp-main|wa_[a-f0-9]{16})$/.test(id))throw Error('invalid_whatsapp_session');
 return 'whatsapp:'+id;
};
const peer=jid=>{
 const id=String(jid||'').toLowerCase();
 if(!isWhatsAppConversationJid(id))throw Error('invalid_whatsapp_history_jid');
 return id;
};
// Persist discovery separately from message storage: a chat with no downloaded
// messages is NOT proof that its history is complete.
export async function migrateWhatsAppHistory(database=defaultDb){
 await database.query(`CREATE TABLE IF NOT EXISTS whatsapp_history_chats (
  account_key VARCHAR(100) NOT NULL,jid VARCHAR(128) NOT NULL,
  first_seen VARCHAR(40) NOT NULL,last_seen VARCHAR(40) NOT NULL,
  messages_imported BIGINT UNSIGNED NOT NULL DEFAULT 0,
  duplicates_seen BIGINT UNSIGNED NOT NULL DEFAULT 0,
  messages_failed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  history_batches INT UNSIGNED NOT NULL DEFAULT 0,
  requested_at VARCHAR(40) NULL,received_at VARCHAR(40) NULL,
  last_error VARCHAR(80) NOT NULL DEFAULT '',
  PRIMARY KEY(account_key,jid),INDEX idx_wa_hist_account(account_key,last_seen)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function discoverWhatsAppChat({account_id,jid}={},database=defaultDb){
 const key=accountKey(account_id),chat=peer(jid),ts=now();
 await database.execute(`INSERT INTO whatsapp_history_chats(account_key,jid,first_seen,last_seen)
 VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE last_seen=VALUES(last_seen)`,[key,chat,ts,ts]);
 return {ok:true};
}
export async function recordWhatsAppHistoryBatch({account_id,jid,imported=0,duplicates=0,failed=0}={},database=defaultDb){
 const key=accountKey(account_id),chat=peer(jid),ts=now();
 for(const n of [imported,duplicates,failed])if(!Number.isSafeInteger(n)||n<0||n>100000)throw Error('invalid_whatsapp_history_count');
 await database.execute(`INSERT INTO whatsapp_history_chats(account_key,jid,first_seen,last_seen,messages_imported,duplicates_seen,messages_failed,history_batches,received_at,last_error)
 VALUES(?,?,?,?,?,?,?,1,?,?) ON DUPLICATE KEY UPDATE
 last_seen=VALUES(last_seen),messages_imported=messages_imported+VALUES(messages_imported),
 duplicates_seen=duplicates_seen+VALUES(duplicates_seen),messages_failed=messages_failed+VALUES(messages_failed),
 history_batches=history_batches+1,received_at=VALUES(received_at),
 last_error=IF(VALUES(messages_failed)>0,'partial_import','')`,
 [key,chat,ts,ts,imported,duplicates,failed,ts,failed?'partial_import':'']);
 return {ok:true};
}
export async function listWhatsAppHistory({account_id='whatsapp-main',limit=100}={},database=defaultDb){
 const key=accountKey(account_id);
 const [rows]=await database.execute(`SELECT jid,first_seen,last_seen,messages_imported,duplicates_seen,
 messages_failed,history_batches,requested_at,received_at,last_error
 FROM whatsapp_history_chats WHERE account_key=? ORDER BY last_seen DESC LIMIT ?`,
 [key,Math.max(1,Math.min(200,Math.floor(Number(limit)||100)))]);
 const [totals]=await database.execute(`SELECT COUNT(*) AS chats,COALESCE(SUM(messages_imported),0) AS imported,
 COALESCE(SUM(duplicates_seen),0) AS duplicates,COALESCE(SUM(messages_failed),0) AS failed,
 SUM(CASE WHEN received_at IS NOT NULL THEN 1 ELSE 0 END) AS chats_with_history,
 SUM(CASE WHEN requested_at IS NOT NULL AND (received_at IS NULL OR received_at<requested_at) THEN 1 ELSE 0 END) AS awaiting_history
 FROM whatsapp_history_chats WHERE account_key=?`,[key]);
 return {ok:true,account_id,chats:rows,summary:totals[0]||{},coverage:'partial_unverified',
  note:'History availability depends on WhatsApp; requests may receive no response. No chat is marked complete without evidence.'};
}
export async function markWhatsAppHistoryRequested({account_id,jid,error=''}={},database=defaultDb){
 const key=accountKey(account_id),chat=peer(jid),ts=now();
 await discoverWhatsAppChat({account_id,jid:chat},database);
 await database.execute('UPDATE whatsapp_history_chats SET requested_at=?,last_error=? WHERE account_key=? AND jid=?',
  [ts,String(error||'').slice(0,80),key,chat]);
 return {ok:true};
}
// On-demand requests need a real, previously received key & timestamp.
// The oldest known message is an anchor, NOT a guarantee of older history.
export async function whatsappHistoryCandidates({account_id='whatsapp-main',limit=8}={},database=defaultDb){
 const key=accountKey(account_id),max=Math.max(1,Math.min(10,Math.floor(Number(limit)||8)));
 const [accounts]=await database.execute('SELECT id FROM accounts WHERE integration_key=? LIMIT 1',[key]);
 if(!accounts[0])return [];
 const [chats]=await database.execute(`SELECT external_id,id FROM conversations WHERE account_id=? AND channel='whatsapp'
 ORDER BY last_message_at DESC LIMIT 250`,[accounts[0].id]);
 const cutoff=new Date(Date.now()-24*3600*1000).toISOString(),result=[];
 for(const row of chats){
  if(!isWhatsAppConversationJid(row.external_id))continue;
  const [seen]=await database.execute('SELECT requested_at FROM whatsapp_history_chats WHERE account_key=? AND jid=?',[key,row.external_id]);
  if(seen[0]?.requested_at&&seen[0].requested_at>cutoff)continue;
  const [messages]=await database.execute(`SELECT external_id,sent_at,direction FROM messages WHERE conversation_id=?
  AND external_id<>'' ORDER BY sent_at ASC,id ASC LIMIT 1`,[row.id]);
  const m=messages[0],time=Date.parse(m?.sent_at||'');
  if(!m||!m.external_id||!Number.isFinite(time)||time<1)continue;
  result.push({jid:row.external_id,key:{remoteJid:row.external_id,id:m.external_id,fromMe:m.direction==='out'},timestamp:time});
  if(result.length>=max)break;
 }
 return result;
}
