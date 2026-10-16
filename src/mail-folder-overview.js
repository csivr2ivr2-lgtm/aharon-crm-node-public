// AHARON NEXT M3/M4: provider-native read-only folders, never CRM-read flags.
// Null counts mean the provider did not confirm a value (not zero).
const asCount=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&value!==null&&value!==undefined?Number(value):null;
const kind=(id,special='')=>{
 const key=String(special||id||'').replace(/^\\/,'').toUpperCase();
 if(key==='INBOX')return 'inbox';
 if(['SENT','SENT MAIL'].includes(key))return 'sent';
 if(['DRAFTS','DRAFT'].includes(key))return 'drafts';
 if(['TRASH','BIN','DELETED'].includes(key))return 'trash';
 if(['JUNK','SPAM'].includes(key))return 'spam';
 if(key==='UNREAD')return 'unread';
 return 'custom';
};
export async function gmailFolderOverview(gmail,{limit=40}={}){
 const response=await gmail.users.labels.list({userId:'me'});
 const labels=(response.data?.labels||[]).filter(x=>x?.id&&x?.name)
  .sort((a,b)=>Number(b.type==='system')-Number(a.type==='system')||a.name.localeCompare(b.name))
  .slice(0,Math.max(1,Math.min(80,limit)));
 const main=new Set(['INBOX','SENT','DRAFT','TRASH','SPAM','UNREAD','IMPORTANT','STARRED']);
 // Bounded label detail requests; do not claim counts for labels not queried.
 const detailIds=labels.filter(x=>main.has(x.id)).slice(0,8);
 const details=new Map();
 for(let i=0;i<detailIds.length;i+=4){
  const batch=await Promise.allSettled(detailIds.slice(i,i+4).map(x=>gmail.users.labels.get({userId:'me',id:x.id})));
  batch.forEach((r,j)=>{if(r.status==='fulfilled')details.set(detailIds[i+j].id,r.value.data||{});});
 }
 return {ok:true,provider:'gmail',folders:labels.map(x=>{
  const d=details.get(x.id);
  return {id:x.id,name:x.name,kind:kind(x.id),system:x.type==='system',
   messages_total:asCount(d?.messagesTotal),messages_unread:asCount(d?.messagesUnread),
   threads_total:asCount(d?.threadsTotal),threads_unread:asCount(d?.threadsUnread)};
 }),read_only:true,limited:labels.length>=Math.max(1,Math.min(80,limit))};
}
export async function imapFolderOverview(client,{limit=40}={}){
 let folders;
 try{folders=await client.list({statusQuery:{messages:true,unseen:true,uidValidity:true}});}
 catch{folders=await client.list();}
 const selected=(folders||[]).filter(f=>f?.path&&!f.flags?.has?.('\\Noselect')&&!f.flags?.has?.('\\NonExistent'))
  .sort((a,b)=>Number(b.path.toUpperCase()==='INBOX')-Number(a.path.toUpperCase()==='INBOX')||a.path.localeCompare(b.path))
  .slice(0,Math.max(1,Math.min(80,limit)));
 return {ok:true,provider:'hostinger.imap',folders:selected.map(f=>({
  id:f.path,name:f.name||f.path,kind:kind(f.path,f.specialUse),system:Boolean(f.specialUse),
  messages_total:asCount(f.status?.messages),messages_unread:asCount(f.status?.unseen),
  uid_validity:f.status?.uidValidity==null?null:String(f.status.uidValidity)
 })),read_only:true,limited:(folders||[]).length>selected.length};
}
