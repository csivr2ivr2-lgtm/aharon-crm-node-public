import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleParser} from 'mailparser';
import {describeMailAttachments,migrateMailAttachmentMetadata,persistMailAttachmentMetadata,listConversationAttachmentMetadata} from '../src/mail-attachment-metadata.js';
test('parse MIME attachment name and size without persisting bytes',async()=>{
 const source=['MIME-Version: 1.0','From: sender@example.com','To: recipient@example.com',
 'Content-Type: multipart/mixed; boundary="B"','','--B','Content-Type: text/plain','','Hello',
 '--B','Content-Type: application/pdf; name="report.pdf"','Content-Disposition: attachment; filename="report.pdf"',
 'Content-Transfer-Encoding: base64','','cGRm','--B--',''].join('\r\n');
 const mail=await simpleParser(source,{skipTextToHtml:true});
 const [a]=describeMailAttachments(mail);
 assert.equal(a.filename,'report.pdf');assert.equal(a.size_bytes,3);
 assert.equal(a.mime_type,'application/pdf');assert.equal(Object.hasOwn(a,'content'),false);
});
test('names and sizes are normalized and raw payloads cannot reach database',async()=>{
 const a=describeMailAttachments({attachments:[{filename:'../invoice.txt',contentType:'bad mime',size:-4,content:Buffer.alloc(10)}]});
 assert.equal(a[0].filename,'invoice.txt');assert.equal(a[0].mime_type,'application/octet-stream');assert.equal(a[0].size_bytes,null);
 let called=false;
 await assert.rejects(persistMailAttachmentMetadata({execute:async()=>{called=true;}},'msg_abc',
 [{filename:'file',content:Buffer.from('private')}]),/invalid_attachment_metadata/);
 assert.equal(called,false);
});
test('store is transaction-compatible and duplicate replay uses INSERT IGNORE',async()=>{
 const calls=[];const db={execute:async(sql,params)=>{calls.push({sql,params});return [{affectedRows:calls.length===1?1:0}]}};
 const entries=[{filename:'A.pdf',mime_type:'application/pdf',size_bytes:12}];
 assert.equal(await persistMailAttachmentMetadata(db,'msg_abc',entries),1);
 assert.equal(await persistMailAttachmentMetadata(db,'msg_abc',entries),0);
 assert.match(calls[0].sql,/INSERT IGNORE/);assert.equal(calls[0].params[0],'msg_abc');
});
test('listing stays scoped to conversation, read only, no false download claims',async()=>{
 const calls=[];const db={execute:async(sql,params)=>{calls.push({sql,params});return [[{message_id:'msg_abc',filename:'A.pdf',size_bytes:'12'}]]}};
 const r=await listConversationAttachmentMetadata('conv_abc',db);
 assert.equal(r.content_available,false);assert.equal(r.items[0].downloaded,false);
 assert.deepEqual(calls[0].params,['conv_abc',101]);
 assert.match(calls[0].sql,/WHERE m.conversation_id=\?/);
 await assert.rejects(listConversationAttachmentMetadata('../bad',db),/invalid_conversation_id/);
});
test('additive migration can run repeatedly',async()=>{
 let calls=0;const db={query:async sql=>{assert.match(sql,/CREATE TABLE IF NOT EXISTS/);calls++}};
 await migrateMailAttachmentMetadata(db);await migrateMailAttachmentMetadata(db);assert.equal(calls,2);
});
