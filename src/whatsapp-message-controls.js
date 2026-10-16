// Verified WhatsApp receipts and safe, explicitly confirmed revoke requests.
// No message is erased locally merely because the revoke request was accepted.
import {db as defaultDb} from './db.js';
const validSession=x=>/^(?:whatsapp-main|wa_[a-f0-9]{16})$/.test(String(x||''));
const validJid=x=>/^[1-9]\d{6,19}@(s\.whatsapp\.net|lid)$/.test(String(x||''));
const validProviderId=x=>typeof x==='string'&&x.length>=1&&x.length<=128&&/^[a-zA-Z0-9._:-]+$/.test(x);
const receiptLevels={server:2,delivered:3,read:4,played:5};
export const receiptLabel=level=>({2:'server',3:'delivered',4:'read',5:'played'})[Number(level)]||'unverified';
export async function migrateWhatsAppMessageControls(database=defaultDb){
 await database.query(`CREATE TABLE IF NOT EXISTS whatsapp_message_receipts (
  account_key VARCHAR(80) NOT NULL,jid VARCHAR(128) NOT NULL,provider_message_id VARCHAR(128) NOT NULL,
  status_level TINYINT UNSIGNED NOT NULL DEFAULT 0,updated_at VARCHAR(40) NOT NULL,
  PRIMARY KEY(account_key,jid,provider_message_id),INDEX idx_wa_receipt_provider(provider_message_id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await database.query(`CREATE TABLE IF NOT EXISTS whatsapp_delete_requests (
  message_id VARCHAR(128) PRIMARY KEY,status VARCHAR(24) NOT NULL,
  requested_at VARCHAR(40) NOT NULL,updated_at VARCHAR(40) NOT NULL,
  INDEX idx_wa_delete_updated(updated_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function recordWhatsAppReceipt({account_id,jid,provider_message_id,status}={},database=defaultDb){
 if(!validSession(account_id)||!validJid(jid)||!validProviderId(provider_message_id)||!(status in receiptLevels))
  return {ok:true,skipped:'invalid_receipt'};
 const level=receiptLevels[status],timestamp=new Date().toISOString();
 await database.execute(`INSERT INTO whatsapp_message_receipts(account_key,jid,provider_message_id,status_level,updated_at)
 VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE status_level=GREATEST(status_level,VALUES(status_level)),
 updated_at=IF(VALUES(status_level)>status_level,VALUES(updated_at),updated_at)`,
 ['whatsapp:'+account_id,jid,provider_message_id,level,timestamp]);
 return {ok:true,status};
}
export function resolveWaStatus(update={}){
 const code=Number(update?.status);
 if(code===5)return 'played';
 if(code===4)return 'read';
 if(code===3)return 'delivered';
 if(code===2)return 'server';
 return null;
}
export function resolveWaReceipt(receipt={}){
 const present=x=>x!==undefined&&x!==null&&String(x)!=='0'&&String(x)!=='';
 if(present(receipt.playedTimestamp))return 'played';
 if(present(receipt.readTimestamp))return 'read';
 if(present(receipt.receiptTimestamp))return 'delivered';
 return null;
}
export async function outgoingControls(items,database=defaultDb,clock=Date.now()){
 const wa=items.filter(x=>x.channel==='whatsapp'&&validSession(x.session_id)&&validJid(x.jid)&&validProviderId(x.provider_message_id));
 const providerIds=[...new Set(wa.map(x=>x.provider_message_id))];
 const receipts=providerIds.length?(await database.execute(
  'SELECT account_key,jid,provider_message_id,status_level FROM whatsapp_message_receipts WHERE provider_message_id IN ('+providerIds.map(()=>'?').join(',')+')',providerIds))[0]:[];
 const byReceipt=new Map(receipts.map(r=>[r.account_key+'|'+r.jid+'|'+r.provider_message_id,Number(r.status_level)]));
 const ids=items.map(x=>x.id).filter(Boolean);
 const deletions=ids.length?(await database.execute(
  'SELECT message_id,status FROM whatsapp_delete_requests WHERE message_id IN ('+ids.map(()=>'?').join(',')+')',ids))[0]:[];
 const byDelete=new Map(deletions.map(x=>[x.message_id,x.status]));
 return items.map(x=>{
  const deletion_status=byDelete.get(x.id)||'';
  const level=byReceipt.get('whatsapp:'+x.session_id+'|'+x.jid+'|'+x.provider_message_id);
  const age=clock-Date.parse(x.sent_at||'');
  return {...x,delivery_status:x.channel==='whatsapp'?receiptLabel(level):'unverified',deletion_status,
   can_delete_for_everyone:x.channel==='whatsapp'&&validSession(x.session_id)&&validJid(x.jid)&&validProviderId(x.provider_message_id)
     &&Number.isFinite(age)&&age>=0&&age<47*3600*1000&&!deletion_status};
 });
}
export async function requestWhatsAppDelete(messageId,{database=defaultDb,send,clock=Date.now}={}){
 if(typeof messageId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(messageId))throw Error('invalid_message_id');
 if(typeof send!=='function')throw Error('whatsapp_delete_provider_missing');
 const [rows]=await database.execute(`SELECT m.id,m.external_id AS provider_message_id,m.sent_at,m.direction,
  c.channel,c.external_id AS jid,a.integration_key
  FROM messages m JOIN conversations c ON c.id=m.conversation_id
  JOIN accounts a ON a.id=c.account_id WHERE m.id=? LIMIT 1`,[messageId]);
 const m=rows[0];
 if(!m||m.direction!=='out'||m.channel!=='whatsapp'||!m.integration_key?.startsWith('whatsapp:'))throw Error('whatsapp_delete_not_allowed');
 const session_id=m.integration_key.slice('whatsapp:'.length);
 if(!validSession(session_id)||!validJid(m.jid)||!validProviderId(m.provider_message_id))throw Error('whatsapp_delete_identity_unverified');
 const age=clock()-Date.parse(m.sent_at||'');
 if(!Number.isFinite(age)||age<0||age>=47*3600*1000)throw Error('whatsapp_delete_window_expired');
 const timestamp=new Date().toISOString();
 const [claim]=await database.execute("INSERT IGNORE INTO whatsapp_delete_requests(message_id,status,requested_at,updated_at) VALUES(?,'sending',?,?)",[messageId,timestamp,timestamp]);
 if(Number(claim.affectedRows)!==1)throw Error('whatsapp_delete_already_requested');
 try{
  const response=await send({account_id:session_id,to:m.jid,message_id:m.provider_message_id});
  if(!response?.ok||response.message_id!==m.provider_message_id)throw Error('whatsapp_delete_not_confirmed');
  await database.execute("UPDATE whatsapp_delete_requests SET status='requested',updated_at=? WHERE message_id=? AND status='sending'",[new Date().toISOString(),messageId]);
  return {ok:true,status:'requested',note:'Deletion was requested; removal at recipient is not verified'};
 }catch{
  await database.execute("UPDATE whatsapp_delete_requests SET status='uncertain',updated_at=? WHERE message_id=? AND status='sending'",[new Date().toISOString(),messageId]).catch(()=>{});
  throw Error('whatsapp_delete_outcome_uncertain');
 }
}
