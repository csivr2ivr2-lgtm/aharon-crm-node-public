import {db as defaultDb} from './db.js';
// Time-first, independent from the expensive priority-scoring query.
export async function listRecentConversations({limit=25}={},database=defaultDb){
 const count=Number.isFinite(Number(limit))?Math.max(1,Math.min(50,Math.trunc(Number(limit)))):25;
 const [items]=await database.execute("SELECT id,channel,title,external_id,unread_count,last_message_at FROM conversations WHERE (channel<>'whatsapp' OR (COALESCE(external_id,'')<>'status@broadcast' AND COALESCE(external_id,'') NOT LIKE '%@newsletter')) ORDER BY last_message_at DESC,id DESC LIMIT ?",[count]);
 return {ok:true,items};
}
