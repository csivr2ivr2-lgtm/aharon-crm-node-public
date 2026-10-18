import test from 'node:test';
import assert from 'node:assert/strict';
import {imapObservedState,mailProviderState} from '../src/mail-provider-state.js';
import {HostingerMailConnector} from '../src/connectors/hostinger-mail.js';
test('IMAP source observations preserve folder, UIDVALIDITY and unknown flags honestly',()=>{
 const unread=imapObservedState('INBOX',9,9007199254740993n,{flags:new Set(['\\Flagged'])});
 assert.equal(unread.unread,true);assert.equal(unread.uid_validity,'9007199254740993');
 assert.equal(imapObservedState('Sent',9,2,{flags:new Set(['\\Seen'])}).unread,false);
 assert.equal(imapObservedState('Archive',9,2,false).unread,null);
 assert.deepEqual(JSON.parse(mailProviderState(unread)),unread);
 assert.throws(()=>mailProviderState({...unread,uid_validity:'unknown'}),/invalid_imap_provider_state/);
});
test('IMAP history carries source flags and always releases mailbox lock',async()=>{
 let released=0,closed=0;
 const c=new HostingerMailConnector({vault:{},imapFactory:()=>({
  connect:async()=>{},logout:async()=>{closed++;},list:async()=>[{path:'Sent',flags:new Set()}],
  getMailboxLock:async()=>({release:()=>{released++;}}),mailbox:{uidValidity:123n},
  search:async()=>[4],download:async()=>({content:Buffer.from('From: me@example.test\r\nTo: other@example.test\r\nMessage-ID: <fixture@example.test>\r\nDate: Tue, 20 Oct 2026 10:00:00 +0000\r\nSubject: Test\r\n\r\nTest')}),
  fetchOne:async()=>({flags:new Set(['\\Seen'])})
 })});
 c.account={email:'me@example.test',password:'synthetic'};
 const result=await c.historyPage();
 assert.equal(result.messages[0].provider_state.folder,'Sent');
 assert.equal(result.messages[0].provider_state.uid,'4');
 assert.equal(result.messages[0].provider_state.unread,false);
 assert.equal(released,1);assert.equal(closed,1);assert.equal(result.done,true);
});
test('SMTP acceptance does not claim delivery and rejected recipients remain visible',async()=>{
 let closed=0;
 const c=new HostingerMailConnector({vault:{},smtpFactory:()=>({
  sendMail:async()=>({messageId:'synthetic',accepted:['ok@example.test'],rejected:['bad@example.test']}),
  close:()=>{closed++;}
 })});
 c.account={email:'me@example.test',password:'synthetic'};
 const result=await c.send({to:'ok@example.test',body:'synthetic'});
 assert.equal(result.status,'smtp_accepted');assert.equal(result.delivery_confirmed,false);
 assert.deepEqual(result.rejected,['bad@example.test']);assert.equal(closed,1);
});
