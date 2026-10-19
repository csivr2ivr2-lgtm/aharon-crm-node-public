// MIME attachment metadata only. Never persist attachment bytes or claim downloads.
const MAX=40;
const text=(v,n)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const name=v=>text(v,500).replace(/^.*[\\/]/,'').trim()||'קובץ ללא שם';
const mime=v=>{const x=text(v,150).toLowerCase();return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(x)?x:'application/octet-stream'};
const size=v=>v!=null&&Number.isSafeInteger(Number(v))&&Number(v)>=0?Number(v):null;
export function describeMailAttachments(mail){
 if(!Array.isArray(mail?.attachments))return [];
 return mail.attachments.slice(0,MAX).map((a,i)=>({
  ordinal:i,filename:name(a.filename),mime_type:mime(a.contentType),size_bytes:size(a.size),
  content_id:text(a.cid,255)||null,disposition:String(a.contentDisposition||'').toLowerCase()==='inline'?'inline':'attachment'
 }));
}
export async function migrateMailAttachmentMetadata(db){
 await db.query("CREATE TABLE IF NOT EXISTS message_attachment_metadata ("+
 "message_id VARCHAR(128) NOT NULL,ordinal SMALLINT UNSIGNED NOT NULL,"+
 "filename VARCHAR(500) NOT NULL,mime_type VARCHAR(150) NOT NULL,size_bytes BIGINT UNSIGNED NULL,"+
 "content_id VARCHAR(255) NULL,disposition VARCHAR(16) NOT NULL DEFAULT 'attachment',created_at VARCHAR(40) NOT NULL,"+
 "PRIMARY KEY(message_id,ordinal)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
export async function persistMailAttachmentMetadata(connection,messageId,attachments){
 if(!attachments?.length)return 0;
 if(typeof messageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(messageId)||!Array.isArray(attachments)||attachments.length>MAX)
  throw Error('invalid_attachment_metadata');
 let count=0;
 for(let i=0;i<attachments.length;i++){
  const a=attachments[i];
  if(!a||typeof a!=='object'||Object.hasOwn(a,'content'))throw Error('invalid_attachment_metadata');
  const [r]=await connection.execute("INSERT IGNORE INTO message_attachment_metadata "+
    "(message_id,ordinal,filename,mime_type,size_bytes,content_id,disposition,created_at) "+
    "VALUES(?,?,?,?,?,?,?,?)",
    [messageId,i,name(a.filename),mime(a.mime_type),size(a.size_bytes),text(a.content_id,255)||null,
     a.disposition==='inline'?'inline':'attachment',new Date().toISOString()]);
  count+=Number(r.affectedRows||0);
 }
 return count;
}
export async function listConversationAttachmentMetadata(conversationId,db,{limit=100}={}){
 if(typeof conversationId!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(conversationId))throw Error('invalid_conversation_id');
 const n=Math.max(1,Math.min(100,Math.trunc(Number(limit))||100));
 const [rows]=await db.execute("SELECT a.message_id,a.ordinal,a.filename,a.mime_type,a.size_bytes,a.disposition,"+
 "m.source,m.sent_at FROM message_attachment_metadata a JOIN messages m ON m.id=a.message_id "+
 "WHERE m.conversation_id=? ORDER BY m.sent_at DESC,m.id DESC,a.ordinal ASC LIMIT ?",[conversationId,n+1]);
 return {ok:true,items:rows.slice(0,n).map(a=>({
  message_id:a.message_id,ordinal:a.ordinal,filename:a.filename,mime_type:a.mime_type,
  size_bytes:a.size_bytes==null?null:Number(a.size_bytes),disposition:a.disposition,
  source:a.source||'unknown',sent_at:a.sent_at,downloaded:false
 })),limited:rows.length>n,content_available:false,
 note:'Metadata only; attachment bytes are not stored and cannot be downloaded from this list.'};
}
