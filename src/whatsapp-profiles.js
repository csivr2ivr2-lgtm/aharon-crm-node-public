import {db as defaultDb,now} from './db.js';
import {isPhoneJid,isLidJid,isGroupJid,safeWhatsAppName,safeWhatsAppPn,whatsappPeerTitle} from './connectors/whatsapp-identity.js';
import {isWhatsAppChannelJid} from './connectors/whatsapp-channel-filter.js';

const sessionId=id=>{if(typeof id!=='string'||! /^(?:whatsapp-main|wa_[a-f0-9]{16})$/.test(id))throw Error('invalid_whatsapp_session');return id;};
export async function migrateWhatsAppProfiles(database=defaultDb){
 await database.query(`CREATE TABLE IF NOT EXISTS whatsapp_peer_profiles (
 account_key VARCHAR(100) NOT NULL,
 jid VARCHAR(128) NOT NULL,
 kind VARCHAR(12) NOT NULL,
 display_name VARCHAR(160) NOT NULL DEFAULT '',
 phone_jid VARCHAR(80) NOT NULL DEFAULT '',
 updated_at VARCHAR(40) NOT NULL,
 PRIMARY KEY(account_key,jid)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function saveWhatsAppProfile({account_id,jid,name='',phone_jid=''}={},database=defaultDb){
 const accountKey='whatsapp:'+sessionId(account_id);
 jid=String(jid||'').trim().toLowerCase();
 if(isWhatsAppChannelJid(jid)||![isPhoneJid(jid),isLidJid(jid),isGroupJid(jid)].some(Boolean))throw Error('invalid_whatsapp_profile_jid');
 const kind=isGroupJid(jid)?'group':'person',label=safeWhatsAppName(name),pn=isLidJid(jid)?safeWhatsAppPn(phone_jid):'';
 if(!label&&!pn)return {ok:true,updated:false};
 const ts=now();
 await database.execute(`INSERT INTO whatsapp_peer_profiles(account_key,jid,kind,display_name,phone_jid,updated_at)
 VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
 display_name=IF(phone_jid<>'' AND VALUES(phone_jid)<>'' AND phone_jid<>VALUES(phone_jid),display_name,IF(VALUES(display_name)<>'',VALUES(display_name),display_name)),
 phone_jid=IF(phone_jid='',VALUES(phone_jid),phone_jid),
 updated_at=VALUES(updated_at)`,[accountKey,jid,kind,label,pn,ts]);
 const [profiles]=await database.execute('SELECT display_name,phone_jid FROM whatsapp_peer_profiles WHERE account_key=? AND jid=?',[accountKey,jid]);
 const title=whatsappPeerTitle({jid,name:profiles[0]?.display_name||'',phoneJid:profiles[0]?.phone_jid||''});
 const [accounts]=await database.execute('SELECT id FROM accounts WHERE integration_key=? LIMIT 1',[accountKey]);
 if(accounts[0]){
  await database.execute(`UPDATE conversations SET title=? WHERE account_id=? AND channel='whatsapp' AND external_id=?
   AND (title=external_id OR title LIKE '%@lid' OR title LIKE '%@g.us' OR title LIKE '%@s.whatsapp.net'
   OR title LIKE 'קבוצת WhatsApp%' OR title LIKE 'איש קשר WhatsApp%' OR title='מספר WhatsApp לא זמין' OR title=?)`,
   [title,accounts[0].id,jid,String(profiles[0]?.display_name||'')]);
  const verifiedPhone=profiles[0]?.phone_jid||'';
  if(isLidJid(jid)&&safeWhatsAppPn(verifiedPhone)){
   const [conversations]=await database.execute("SELECT id FROM conversations WHERE account_id=? AND channel='whatsapp' AND external_id=?",[accounts[0].id,jid]);
   for(const conv of conversations)await database.execute("UPDATE messages SET sender=? WHERE conversation_id=? AND direction='in' AND sender=?",
    [verifiedPhone,conv.id,jid]);
  }
 }
 return {ok:true,updated:true};
}
export async function lookupWhatsAppTitle({account_id,jid}={},database=defaultDb){
 const accountKey='whatsapp:'+sessionId(account_id);
 jid=String(jid||'').toLowerCase();
 const [rows]=await database.execute('SELECT display_name,phone_jid FROM whatsapp_peer_profiles WHERE account_key=? AND jid=?',[accountKey,jid]);
 return whatsappPeerTitle({jid,name:rows[0]?.display_name||'',phoneJid:rows[0]?.phone_jid||''});
}

/** Resolve recorded phone aliases without changing original WhatsApp identity keys. */
export async function resolveWhatsAppDisplay({account_id,jid}={},database=defaultDb){
 const key='whatsapp:'+sessionId(account_id);
 jid=String(jid||'').toLowerCase();
 if(!isLidJid(jid)&&!isPhoneJid(jid))return null;
 const [rows]=await database.execute(
  'SELECT display_name,phone_jid FROM whatsapp_peer_profiles WHERE account_key=? AND jid=? LIMIT 1',
  [key,jid]);
 if(!rows[0])return null;
 const name=safeWhatsAppName(rows[0].display_name),phone=safeWhatsAppPn(rows[0].phone_jid)||safeWhatsAppPn(jid);
 return {name,phone_jid:phone,title:whatsappPeerTitle({jid,name,phoneJid:phone})};
}
/** Batched account-scoped lookup avoids N+1 queries in the inbox workbench. */
export async function enrichWhatsAppInboxItems(items=[],database=defaultDb){
 const groups=new Map(),found=new Map();
 for(const item of items){
  if(item.channel!=='whatsapp'||!isLidJid(item.conversation_external_id))continue;
  const key=String(item.integration_key||'');
  if(!/^whatsapp:(?:whatsapp-main|wa_[a-f0-9]{16})$/.test(key))continue;
  if(!groups.has(key))groups.set(key,new Set());
  groups.get(key).add(item.conversation_external_id);
 }
 for(const [key,values] of groups){
  const ids=[...values].slice(0,100);
  if(!ids.length)continue;
  const [rows]=await database.execute(
   'SELECT jid,display_name,phone_jid FROM whatsapp_peer_profiles WHERE account_key=? AND jid IN ('+ids.map(()=>'?').join(',')+')',
   [key,...ids]);
  for(const row of rows){
   const name=safeWhatsAppName(row.display_name),phone=safeWhatsAppPn(row.phone_jid);
   if(name||phone)found.set(key+'|'+row.jid,{phone,title:whatsappPeerTitle({jid:row.jid,name,phoneJid:phone})});
  }
 }
 for(const item of items){
  const match=found.get(String(item.integration_key||'')+'|'+String(item.conversation_external_id||''));
  if(!match)continue;
  const old=String(item.title||'');
  if(old==='מספר WhatsApp לא זמין'||isLidJid(old)||old.startsWith('איש קשר WhatsApp (מזהה פרטי')){
   item.title=match.title;
   if(!item.client_id)item.contact_name=match.title;
  }
  if(item.sender===item.conversation_external_id&&match.phone)item.sender=match.phone;
 }
 return items;
}
