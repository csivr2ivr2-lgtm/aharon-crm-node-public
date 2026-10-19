const actions=Object.freeze({
 read:{add:[],remove:['UNREAD']},unread:{add:['UNREAD'],remove:[]},
 archive:{add:[],remove:['INBOX']},inbox:{add:['INBOX'],remove:[]},
 star:{add:['STARRED'],remove:[]},unstar:{add:[],remove:['STARRED']}
});
export async function applyGmailMessageAction({conversationId,messageId,action,confirmed,enabled=false,db,google,audit}){
 if(confirmed!==true)throw Error('explicit_confirmation_required');
 if(!enabled)throw Error('gmail_writes_disabled');
 if(!Object.hasOwn(actions,action||''))throw Error('invalid_gmail_action');
 if(![conversationId,messageId].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v)))throw Error('invalid_message_reference');
 const [rows]=await db.execute("SELECT m.external_id,a.integration_key FROM messages m "+
  "JOIN conversations c ON c.id=CAST(m.conversation_id AS BINARY) JOIN accounts a ON a.id=CAST(c.account_id AS BINARY) "+
  "WHERE m.id=? AND m.conversation_id=? AND m.source='google.gmail' LIMIT 1",[messageId,conversationId]);
 const row=rows[0];if(!row?.integration_key?.startsWith('google:'))throw Error('gmail_message_unavailable');
 const account_id=row.integration_key.slice(7);
 await google.permittedAccount(account_id,'gmail_modify');
 const event={action:'gmail.message.'+action,entityType:'message',entityId:messageId,confirmation:'explicit'};
 await audit({...event,after:{state:'requested',conversation_id:conversationId}});
 const result=await google.gmailModifyLabels({account_id,message_id:row.external_id,confirmed:true,...actions[action]});
 await audit({...event,after:{state:'provider_accepted',conversation_id:conversationId}});
 return {...result,local_sync_pending:true};
}
