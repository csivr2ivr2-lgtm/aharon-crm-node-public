export function mailProviderState(value){
 if(!value||typeof value.available!=='boolean'||!Array.isArray(value.labels)||value.labels.length>200||
  value.labels.some(x=>typeof x!=='string'||x.length>255))throw Error('invalid_mail_provider_state');
 return JSON.stringify({available:value.available,labels:[...new Set(value.labels)],unread:value.available?value.labels.includes('UNREAD'):null});
}
export async function updateMailProviderState(event,db){
 if(event.source!=='google.gmail'||!event.account_id||!event.external_id)throw Error('invalid_mail_provider_source');
 const state=mailProviderState(event.provider_state);
 await db.execute('UPDATE messages m JOIN conversations c ON c.id=m.conversation_id JOIN accounts a ON a.id=c.account_id SET m.provider_state_json=? WHERE a.integration_key=? AND m.external_id=?',[state,'google:'+event.account_id,String(event.external_id)]);
 return {ok:true};
}
