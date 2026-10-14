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
// Candidates may come from persisted CRM rows OR real Baileys message keys
// observed before database synchronization completed. Chat metadata alone
// does not contain the message key required by WhatsApp's on-demand API.
export async function whatsappHistoryCandidates({
 account_id='whatsapp-main',limit=8,live=[],diagnostics=null
}={},database=defaultDb){
 const key=accountKey(account_id),max=Math.max(1,Math.min(10,Math.floor(Number(limit)||8)));
 const stats={account_found:false,stored_chats:0,live_anchors:Array.isArray(live)?live.length:0,
  no_anchor:0,cooldown:0,invalid:0,eligible:0};
 const [accounts]=await database.execute('SELECT id FROM accounts WHERE integration_key=? LIMIT 1',[key]);
 stats.account_found=Boolean(accounts[0]);
 const candidates=[],selected=new Set();
 const cutoff=new Date(Date.now()-24*3600*1000).toISOString();
 const tryAdd=async anchor=>{
  const jid=String(anchor?.jid||'').toLowerCase();
  const id=String(anchor?.key?.id||'');
  const timestamp=Number(anchor?.timestamp);
  if(!isWhatsAppConversationJid(jid)||!id||id.length>128||
   !Number.isSafeInteger(timestamp)||timestamp<946684800000||
   timestamp>Date.now()+300000){stats.invalid++;return;}
  if(selected.has(jid))return;
  const [seen]=await database.execute(
   'SELECT requested_at FROM whatsapp_history_chats WHERE account_key=? AND jid=?',[key,jid]);
  if(seen[0]?.requested_at&&seen[0].requested_at>cutoff){stats.cooldown++;return;}
  selected.add(jid);
  candidates.push({jid,key:{remoteJid:jid,id,fromMe:anchor.key.fromMe===true},timestamp});
  stats.eligible++;
 };
 if(stats.account_found){
  const [chats]=await database.execute(`SELECT external_id,id FROM conversations
   WHERE account_id=? AND channel='whatsapp'
   ORDER BY last_message_at DESC LIMIT 5000`,[accounts[0].id]);
  stats.stored_chats=chats.length;
  for(const chat of chats){
   if(candidates.length>=max)break;
   if(!isWhatsAppConversationJid(chat.external_id))continue;
   const [rows]=await database.execute(`SELECT external_id,sent_at,direction
    FROM messages WHERE conversation_id=? AND external_id<>''
    ORDER BY sent_at ASC,id ASC LIMIT 1`,[chat.id]);
   const m=rows[0],timestamp=Date.parse(m?.sent_at||'');
   if(!m||!m.external_id||!Number.isSafeInteger(timestamp)||timestamp<946684800000){
    stats.no_anchor++;continue;
   }
   await tryAdd({jid:chat.external_id,
    key:{id:m.external_id,fromMe:m.direction==='out'},timestamp});
  }
 }
 // Fallback works even if no accounts/conversations have been inserted yet.
 for(const raw of Array.isArray(live)?live:[]){
  if(candidates.length>=max)break;
  await tryAdd(raw);
 }
 if(diagnostics&&typeof diagnostics==='object')Object.assign(diagnostics,stats);
 return candidates;
}
