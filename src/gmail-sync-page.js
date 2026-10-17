// Read-only provider adapter. The caller must persist nextState only AFTER all items.
const status=e=>Number(e?.response?.status||e?.code||0);
const historyId=value=>{
 const s=String(value||'');
 if(!/^[0-9]+$/.test(s))throw Error('gmail_history_id_missing');
 return s;
};
export async function gmailSyncPage(gmail,state=null,{limit=25}={}){
 const size=Math.max(1,Math.min(100,Math.trunc(Number(limit)||25)));
 let current=state;
 if(!current||current.version!==1){
  const profile=(await gmail.users.getProfile({userId:'me'})).data;
  current={version:1,mode:'full',anchor:historyId(profile.historyId),page:''};
 }
 if(!['full','delta'].includes(current.mode))throw Error('invalid_gmail_sync_state');
 historyId(current.anchor);
 const common={userId:'me',maxResults:size,...(current.page?{pageToken:current.page}:{})};
 let data,ids=new Set(),nextState;
 if(current.mode==='full'){
  data=(await gmail.users.messages.list({...common,includeSpamTrash:true})).data;
  for(const m of data.messages||[])if(m.id)ids.add(m.id);
  nextState={...current,mode:data.nextPageToken?'full':'delta',page:data.nextPageToken||''};
 }else{
  try{data=(await gmail.users.history.list({...common,startHistoryId:current.anchor})).data;}
  catch(error){
   if(status(error)!==404)throw error;
   const recovered=await gmailSyncPage(gmail,null,{limit:size});
   return {...recovered,recovered:true};
  }
  for(const h of data.history||[]){
   for(const m of h.messages||[])if(m.id)ids.add(m.id);
   for(const key of ['messagesAdded','messagesDeleted','labelsAdded','labelsRemoved'])
    for(const item of h[key]||[])if(item.message?.id)ids.add(item.message.id);
  }
  nextState={version:1,mode:'delta',anchor:data.nextPageToken?current.anchor:historyId(data.historyId),page:data.nextPageToken||''};
 }
 if(current.page&&data.nextPageToken===current.page)throw Error('gmail_cursor_not_advancing');
 const items=[];
 for(const id of ids){
  try{
   const item=(await gmail.users.messages.get({userId:'me',id,format:'raw'})).data;
   if(!item.id||!item.raw)throw Error('gmail_message_payload_missing');
   items.push({id:item.id,item});
  }catch(error){
   if(status(error)!==404)throw error;
   // Preserve stored body/history. Only mark unavailable at the provider.
   items.push({id,unavailable:true});
  }
 }
 return {items,nextState,recovered:false};
}
