export function imapObservedState(folder,uid,uidValidity,meta){
 return {protocol:'imap',folder:String(folder),uid:String(uid),uid_validity:String(uidValidity),
  flags:meta?.flags instanceof Set?[...meta.flags]:[],unread:meta?.flags instanceof Set?!meta.flags.has('\\Seen'):null,
  observed_at:new Date().toISOString()};
}
export function mailProviderState(value){
 if(value?.protocol==='imap'){
  if(typeof value.folder!=='string'||!value.folder||value.folder.length>1024||
   !/^[0-9]+$/.test(String(value.uid))||!/^[0-9]+$/.test(String(value.uid_validity))||
   !Array.isArray(value.flags)||value.flags.length>200||value.flags.some(f=>typeof f!=='string'||f.length>255)||
   ![true,false,null].includes(value.unread)||!Number.isFinite(Date.parse(value.observed_at)))throw Error('invalid_imap_provider_state');
  return JSON.stringify({protocol:'imap',folder:value.folder,uid:String(value.uid),uid_validity:String(value.uid_validity),
   flags:[...new Set(value.flags)],unread:value.unread,observed_at:value.observed_at});
 }
 if(!value||typeof value.available!=='boolean'||!Array.isArray(value.labels)||value.labels.length>200||
  value.labels.some(x=>typeof x!=='string'||x.length>255))throw Error('invalid_mail_provider_state');
 return JSON.stringify({available:value.available,labels:[...new Set(value.labels)],unread:value.available?value.labels.includes('UNREAD'):null});
}
export async function updateMailProviderState(event,db){
 if(event.source!=='google.gmail'||!event.account_id||!event.external_id)throw Error('invalid_mail_provider_source');
 const state=mailProviderState(event.provider_state);
 await db.execute('UPDATE messages m JOIN conversations c ON c.id=CAST(m.conversation_id AS BINARY) JOIN accounts a ON a.id=CAST(c.account_id AS BINARY) SET m.provider_state_json=? WHERE a.integration_key=? AND m.external_id=?',[state,'google:'+event.account_id,String(event.external_id)]);
 return {ok:true};
}
