import test from 'node:test';
import assert from 'node:assert/strict';
import {imapHistoryScope,readImapHistoryCursor,imapHistoryBefore,imapHistoryCursor} from '../src/imap-history-cursor.js';
test('IMAP cursor is scoped to account, ordered folders and UIDVALIDITY',()=>{
 const scope=imapHistoryScope('a@example.test',['INBOX','Sent']);
 const raw=imapHistoryCursor({scope,folder:0,before_uid:35,uid_validity:123n});
 const p=readImapHistoryCursor(raw,scope);
 assert.equal(imapHistoryBefore(p,0,123n),35);
 assert.equal(imapHistoryBefore(p,0,456n),0,'new UID generation must replay');
 assert.equal(imapHistoryBefore(p,1,123n),0,'other folder must not inherit UID');
 for(const other of [imapHistoryScope('b@example.test',['INBOX','Sent']),imapHistoryScope('a@example.test',['INBOX','Archive','Sent'])]){
  assert.deepEqual(readImapHistoryCursor(raw,other),{folder:0,before_uid:0});
 }
});
test('legacy checkpoints replay and malformed checkpoints fail closed',()=>{
 assert.deepEqual(readImapHistoryCursor('{"folder":4,"before_uid":25}','scope'),{folder:0,before_uid:0});
 for(const raw of ['null','[]','{','{"folder":-1,"before_uid":1}','{"folder":0,"before_uid":1.5}'])
  assert.throws(()=>readImapHistoryCursor(raw,'scope'),/invalid_mail_history_cursor/);
});
