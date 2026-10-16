// Read-only overview of existing conversation reply drafts; never sends.
import {db as defaultDb} from './db.js';
export async function listOpenDrafts({limit=60}={},database=defaultDb){
 const count=Math.max(1,Math.min(100,Math.trunc(Number(limit))||60));
 const [rows]=await database.execute("SELECT id,conversation_id,SUBSTRING(body,1,1600) AS snippet,status,provider,created_at,updated_at FROM message_drafts WHERE status IN ('draft','uncertain','sending') ORDER BY updated_at DESC,id DESC LIMIT ?",[count]);
 const ids=[...new Set(rows.map(x=>x.conversation_id).filter(Boolean))];
 const conversations=ids.length?(await database.execute('SELECT id,title,channel,account_id FROM conversations WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids))[0]:[];
 const convById=new Map(conversations.map(x=>[x.id,x]));
 const accountIds=[...new Set(conversations.map(x=>x.account_id).filter(Boolean))];
 const accounts=accountIds.length?(await database.execute('SELECT id,label,identifier FROM accounts WHERE id IN ('+accountIds.map(()=>'?').join(',')+')',accountIds))[0]:[];
 const accountById=new Map(accounts.map(x=>[x.id,x]));
 return {ok:true,items:rows.map(row=>{const c=convById.get(row.conversation_id)||{},a=accountById.get(c.account_id)||{};return {
  id:row.id,conversation_id:row.conversation_id,channel:c.channel||'',conversation_title:c.title||'שיחה',
  account_label:a.label||a.identifier||'',status:row.status,provider:row.provider||'',
  snippet:row.snippet||'',updated_at:row.updated_at||row.created_at||''
 };}),scope:'reply_drafts_only'};
}
