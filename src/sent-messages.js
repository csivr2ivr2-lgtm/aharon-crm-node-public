// Read-only outgoing messages. An outgoing row does not prove delivery/read.
import {db as defaultDb} from './db.js';
import {outgoingControls} from './whatsapp-message-controls.js';
export function decodeSentCursor(value=''){
 if(!value)return null;
 if(typeof value!=='string'||value.length>600||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid_sent_cursor');
 let c;try{c=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}catch{throw Error('invalid_sent_cursor');}
 if(c?.v!==1||typeof c.t!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(c.t)||!Number.isFinite(Date.parse(c.t))||typeof c.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.id))throw Error('invalid_sent_cursor');
 return {sent_at:c.t,id:c.id};
}
export const encodeSentCursor=m=>Buffer.from(JSON.stringify({v:1,t:m.sent_at,id:m.id})).toString('base64url');
export async function listSentMessages({cursor='',limit=30}={},database=defaultDb){
 const c=decodeSentCursor(cursor),n=Math.max(1,Math.min(80,Math.trunc(Number(limit))||30));
 const params=c?[c.sent_at,c.sent_at,c.id,n+1]:[n+1];
 const [rows]=await database.execute(`SELECT id,conversation_id,external_id,recipient,subject,SUBSTRING(body,1,1200) AS snippet,sent_at
 FROM messages WHERE direction='out' AND sent_at IS NOT NULL
 ${c?'AND (sent_at<? OR (sent_at=? AND id<?))':''} ORDER BY sent_at DESC,id DESC LIMIT ?`,params);
 const hasMore=rows.length>n,page=rows.slice(0,n);
 const ids=[...new Set(page.map(m=>m.conversation_id).filter(Boolean))];
 const conversations=ids.length?(await database.execute('SELECT id,title,channel,account_id,external_id FROM conversations WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids))[0]:[];
 const byConv=new Map(conversations.map(c=>[c.id,c]));
 const accountIds=[...new Set(conversations.map(c=>c.account_id).filter(Boolean))];
 const accounts=accountIds.length?(await database.execute('SELECT id,label,identifier,integration_key FROM accounts WHERE id IN ('+accountIds.map(()=>'?').join(',')+')',accountIds))[0]:[];
 const byAccount=new Map(accounts.map(a=>[a.id,a]));
 const items=page.map(m=>{const c=byConv.get(m.conversation_id)||{},a=byAccount.get(c.account_id)||{};return {
  id:m.id,conversation_id:m.conversation_id,recipient:m.recipient||'',subject:m.subject||'',snippet:m.snippet||'',sent_at:m.sent_at,
  channel:c.channel||'',conversation_title:c.title||'',account_label:a.label||a.identifier||'',account_identifier:a.identifier||'',
  session_id:String(a.integration_key||'').startsWith('whatsapp:')?a.integration_key.slice(9):'',
  jid:c.external_id||'',provider_message_id:m.external_id||'',delivery_status:'unverified'
 };});
 const controlled=await outgoingControls(items,database);
 return {ok:true,items:controlled.map(({session_id,jid,provider_message_id,...safe})=>safe),
  next_cursor:hasMore&&page.length?encodeSentCursor(page.at(-1)):'',done:!hasMore};
}
