import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function imapHistoryScope(account,folders){return digest([String(account).toLowerCase(),folders]);}
export function readImapHistoryCursor(cursor,scope){
 if(!cursor)return {folder:0,before_uid:0};
 if(typeof cursor!=='string'||cursor.length>4096)throw Error('invalid_mail_history_cursor');
 let p;try{p=JSON.parse(cursor);}catch{throw Error('invalid_mail_history_cursor');}
 if(!p||!Number.isSafeInteger(p.folder)||p.folder<0||!Number.isSafeInteger(p.before_uid)||p.before_uid<0)throw Error('invalid_mail_history_cursor');
 // Old cursors did not bind a mailbox generation. Replay safely instead of skipping.
 if(p.version!==1||p.scope!==scope)return {folder:0,before_uid:0};
 if(typeof p.uid_validity!=='string'||!/^\d*$/.test(p.uid_validity))throw Error('invalid_mail_history_cursor');
 return p;
}
export function imapHistoryBefore(position,folder,uidValidity){
 return position.folder===folder&&position.uid_validity===String(uidValidity)?position.before_uid:0;
}
export function imapHistoryCursor({scope,folder,before_uid,uid_validity}){
 return JSON.stringify({version:1,scope,folder,before_uid,uid_validity:String(uid_validity||'')});
}
