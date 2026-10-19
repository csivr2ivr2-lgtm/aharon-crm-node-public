import test from 'node:test';
import assert from 'node:assert/strict';
import {simpleParser} from 'mailparser';
import {mailReferences} from '../src/message-format.js';
import {inboxHeaders} from '../src/ai/inbox-headers.js';
import {mimeMessage} from '../src/connectors/google.js';
test('MIME reply parent survives missing References and remains usable in a reply',async()=>{
 const mail=await simpleParser('Message-ID: <child@example.test>\r\nIn-Reply-To: <parent@example.test>\r\nSubject: reply\r\n\r\nhello');
 assert.deepEqual(mailReferences(mail),['<parent@example.test>']);
 assert.equal(inboxHeaders(mail.headers)['in-reply-to'],'<parent@example.test>');
 const raw=mimeMessage({to:'a@example.test',subject:'reply',body:'body',in_reply_to:mail.messageId,references:[...mailReferences(mail),mail.messageId]});
 const reply=await simpleParser(Buffer.from(raw,'base64url'));
 assert.equal(reply.inReplyTo,'<child@example.test>');
 assert.deepEqual(reply.references,['<parent@example.test>','<child@example.test>']);
});
test('thread identifiers retain order, deduplicate the parent and reject header injection',()=>{
 assert.deepEqual(mailReferences({references:['<root>','<parent>','<root>'],inReplyTo:'<parent>'}),['<root>','<parent>']);
 assert.deepEqual(mailReferences({references:'<root>',inReplyTo:['<parent>','<other>']}),['<root>','<parent>','<other>']);
 assert.deepEqual(mailReferences(),[]);
 assert.throws(()=>mailReferences({inReplyTo:'parent\r\nBcc: another@example.test'}),/invalid_mail_header/);
 const headers=inboxHeaders({'in-reply-to':'<parent>',authorization:'private',cookie:'private','message-id':'<child>'});
 assert.deepEqual(headers,{'in-reply-to':'<parent>','message-id':'<child>'});
});
