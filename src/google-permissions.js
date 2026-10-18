const prefix='https://www.googleapis.com/auth/';
export const CONTACTS_READ=prefix+'contacts.readonly';
export const GMAIL_MODIFY=prefix+'gmail.modify';
export function googlePermissions(tokens={}){
 const scopes=new Set(typeof tokens.scope==='string'?tokens.scope.split(/\s+/).filter(Boolean):[]);
 const full=scopes.has('https://mail.google.com/'),modify=full||scopes.has(GMAIL_MODIFY);
 return {contacts_read:scopes.has(CONTACTS_READ)||scopes.has(prefix+'contacts'),known:scopes.size>0,gmail_read:modify||scopes.has(prefix+'gmail.readonly'),
  gmail_modify:modify,gmail_send:modify||scopes.has(prefix+'gmail.send')||scopes.has(prefix+'gmail.compose'),
  calendar_read:scopes.has(prefix+'calendar')||scopes.has(prefix+'calendar.readonly'),
  drive_metadata:scopes.has(prefix+'drive')||scopes.has(prefix+'drive.readonly')||scopes.has(prefix+'drive.metadata.readonly')};
}
export function gmailLabelRequest({confirmed,add=[],remove=[]}={}){
 if(confirmed!==true)throw Error('explicit_confirmation_required');
 for(const ids of [add,remove])if(!Array.isArray(ids)||ids.length>100||ids.some(x=>typeof x!=='string'||!x||x.length>255))throw Error('invalid_gmail_labels');
 if(!add.length&&!remove.length)throw Error('gmail_labels_required');
 if(add.some(x=>remove.includes(x)))throw Error('gmail_label_conflict');
 return {addLabelIds:[...new Set(add)],removeLabelIds:[...new Set(remove)]};
}
