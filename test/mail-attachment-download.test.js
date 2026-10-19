import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {downloadMailAttachment,selectMimeAttachment,MAX_ATTACHMENT_BYTES,attachmentDownloadHeaders} from '../src/mail-attachment-download.js';
import {HostingerMailConnector} from '../src/connectors/hostinger-mail.js';
const raw=Buffer.from(['MIME-Version: 1.0','Message-ID: <mail@example.test>','Content-Type: multipart/mixed; boundary=B','','--B','Content-Type: text/plain','','Hello','--B','Content-Type: application/pdf','Content-Disposition: attachment; filename=report.pdf','Content-Transfer-Encoding: base64','','cGRm','--B--',''].join('\r\n'));
const row=()=>({ordinal:0,filename:'report.pdf',mime_type:'application/pdf',size_bytes:3,rfc_message_id:'<mail@example.test>',source:'google.gmail',external_id:'providerid',integration_key:'google:account-a'});
const input=db=>({conversationId:'conv_a',messageId:'msg_a',ordinal:'0',enabled:true,db});
test('attachment downloads require flag and valid references before database/provider access',async()=>{
 const db={execute:()=>assert.fail('no database access')};
 await assert.rejects(downloadMailAttachment({...input(db),enabled:false}),/mail_downloads_disabled/);
 for(const ordinal of ['-1','40','1e0','00','../0'])await assert.rejects(downloadMailAttachment({...input(db),ordinal}),/invalid_attachment_reference/);
});
test('attachment lookup binds conversation, message, ordinal and provider account server-side',async()=>{
 let called;
 const db={execute:async(sql,args)=>{assert.deepEqual(args,['conv_a','msg_a',0]);assert.match(sql,/m.conversation_id=\? AND m.id=\?/);return [[row()]];}};
 const result=await downloadMailAttachment({...input(db),google:{downloadMessageRaw:async args=>{called=args;return raw;}}});
 assert.equal(called.account_id,'account-a');assert.equal(called.message_id,'providerid');assert.equal(result.content.toString(),'pdf');
 await assert.rejects(downloadMailAttachment({...input({execute:async()=>[[]]}),google:{downloadMessageRaw:()=>assert.fail()}}),/mail_attachment_missing/);
});
test('MIME mismatch, changed message identity and oversized metadata fail closed',async()=>{
 for(const change of [{filename:'other.pdf'},{mime_type:'text/html'},{size_bytes:2},{rfc_message_id:'<different>'}])
  await assert.rejects(selectMimeAttachment(raw,{...row(),...change}),/mail_(attachment|message)_changed/);
 await assert.rejects(downloadMailAttachment({...input({execute:async()=>[[{...row(),size_bytes:MAX_ATTACHMENT_BYTES+1}]]}),google:{downloadMessageRaw:()=>assert.fail()}}),/mail_attachment_too_large/);
});
test('IMAP raw download validates account and UID generation, holds a read-only lock and releases it',async()=>{
 let released=0,closed=0,read=0;
 const client={connect:async()=>{},mailbox:{uidValidity:12n},getMailboxLock:async(folder,options)=>{assert.equal(folder,'INBOX');assert.equal(options.readOnly,true);return {release:()=>released++};},
 download:async(uid,part,options)=>{read++;assert.equal(uid,'3');assert.equal(options.uid,true);return {content:Readable.from([raw])};},logout:async()=>{closed++;}};
 const c=new HostingerMailConnector({vault:{get:async()=>null},imapFactory:()=>client});
 c.initialize=async()=>{};c.configured=()=>true;c.settings=()=>({user:'owner@example.test'});
 const args={account_id:'owner@example.test',state:{protocol:'imap',folder:'INBOX',uid:'3',uid_validity:'12'},maxBytes:10000};
 assert.deepEqual(await c.downloadMessageRaw(args),raw);
 await assert.rejects(c.downloadMessageRaw({...args,state:{...args.state,uid_validity:'13'}}),/imap_uid_validity_changed/);
 await assert.rejects(c.downloadMessageRaw({...args,account_id:'other@example.test'}),/mail_account_mismatch/);
 assert.equal(read,1);assert.equal(released,2);assert.equal(closed,2);
 await assert.rejects(c.downloadMessageRaw({...args,maxBytes:2}),/mail_message_too_large/);
 assert.equal(released,3);assert.equal(closed,3);
});
test('download headers force a file, block active content and prevent caching',()=>{
 const values={},reply={type:v=>{values.type=v;return reply;},header:(k,v)=>{values[k]=v;return reply;}};
 attachmentDownloadHeaders(reply,'report.html');
 assert.equal(values.type,'application/octet-stream');assert.match(values['Content-Disposition'],/^attachment;/);
 assert.equal(values['X-Content-Type-Options'],'nosniff');assert.match(values['Content-Security-Policy'],/sandbox/);
 assert.equal(values['Cache-Control'],'private, no-store');
});
test('global download concurrency is bounded and slots recover after failure',async()=>{
 let release;const gate=new Promise(r=>release=r);
 const db={execute:async()=>{await gate;return [[]];}};
 const a=downloadMailAttachment(input(db)),b=downloadMailAttachment(input(db));
 await assert.rejects(downloadMailAttachment(input(db)),/mail_download_busy/);
 release();await Promise.all([assert.rejects(a,/missing/),assert.rejects(b,/missing/)]);
 await assert.rejects(downloadMailAttachment(input(db)),/mail_attachment_missing/);
});
