import {simpleParser} from 'mailparser';
import {describeMailAttachments} from './mail-attachment-metadata.js';
export const MAX_MAIL_BYTES=20*1024*1024;
export const MAX_ATTACHMENT_BYTES=10*1024*1024;
const fail=code=>{throw Error(code);};
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
let active=0;
export async function selectMimeAttachment(raw,expected){
 if(!Buffer.isBuffer(raw)||raw.length>MAX_MAIL_BYTES)fail('mail_message_too_large');
 const mail=await simpleParser(raw,{skipTextToHtml:true,skipImageLinks:true,maxHtmlLengthToParse:1024*1024});
 const i=Number(expected.ordinal),metadata=describeMailAttachments(mail)[i],part=mail.attachments?.[i];
 if(!metadata||!part||!Buffer.isBuffer(part.content))fail('mail_attachment_missing');
 if(metadata.filename!==expected.filename||metadata.mime_type!==expected.mime_type||
  (expected.size_bytes!=null&&Number(expected.size_bytes)!==part.content.length))fail('mail_attachment_changed');
 if(expected.rfc_message_id&&mail.messageId!==expected.rfc_message_id)fail('mail_message_changed');
 if(part.content.length>MAX_ATTACHMENT_BYTES)fail('mail_attachment_too_large');
 return {content:part.content,filename:metadata.filename};
}
export async function downloadMailAttachment({conversationId,messageId,ordinal,enabled=false,db,google,hostinger}){
 if(!enabled)fail('mail_downloads_disabled');
 if(!identifier(conversationId)||!identifier(messageId)||!/^([0-9]|[1-3][0-9])$/.test(String(ordinal)))fail('invalid_attachment_reference');
 if(active>=2)fail('mail_download_busy');
 active++;
 try{
  const [rows]=await db.execute("SELECT a.*,m.source,m.external_id,m.rfc_message_id,m.provider_state_json,ac.integration_key "+
   "FROM message_attachment_metadata a JOIN messages m ON m.id=CAST(a.message_id AS BINARY) "+
   "JOIN conversations c ON c.id=CAST(m.conversation_id AS BINARY) JOIN accounts ac ON ac.id=CAST(c.account_id AS BINARY) "+
   "WHERE m.conversation_id=? AND m.id=? AND a.ordinal=? LIMIT 1",[conversationId,messageId,Number(ordinal)]);
  const row=rows[0];if(!row)fail('mail_attachment_missing');
  if(row.size_bytes!=null&&Number(row.size_bytes)>MAX_ATTACHMENT_BYTES)fail('mail_attachment_too_large');
  let raw;
  if(row.source==='google.gmail'&&row.integration_key?.startsWith('google:')){
   raw=await google.downloadMessageRaw({account_id:row.integration_key.slice(7),message_id:row.external_id,maxBytes:MAX_MAIL_BYTES});
  }else if(row.source==='hostinger.imap'&&row.integration_key?.startsWith('hostinger:')){
   let state;try{state=JSON.parse(row.provider_state_json);}catch{fail('imap_attachment_location_missing');}
   raw=await hostinger.downloadMessageRaw({account_id:row.integration_key.slice(10),state,maxBytes:MAX_MAIL_BYTES});
  }else fail('mail_attachment_provider_unsupported');
  return await selectMimeAttachment(raw,row);
 }finally{active--;}
}
export function attachmentDownloadHeaders(reply,filename){
 const encoded=encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return reply.type('application/octet-stream').header('Content-Disposition',"attachment; filename*=UTF-8''"+encoded)
  .header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"sandbox; default-src 'none'")
  .header('Cache-Control','private, no-store').header('Referrer-Policy','no-referrer');
}
