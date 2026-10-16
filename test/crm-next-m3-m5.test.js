import test from 'node:test';
import assert from 'node:assert/strict';
import {loadClient360} from '../src/client-360.js';
import {gmailFolderOverview,imapFolderOverview} from '../src/mail-folder-overview.js';

test('client 360 only reads explicitly linked records and does not mix clients',async()=>{
 const calls=[];
 const database={execute:async(sql,args)=>{
  calls.push({sql,args});assert.deepEqual(args,['client_A']);
  if(sql.includes('FROM clients WHERE'))return [[{id:'client_A',name:'לקוחה א'}]];
  if(sql.includes('FROM conversations'))return [[{id:'conv_A',channel:'email'}]];
  if(sql.includes('FROM projects p'))return [[{id:'project_A',name:'Project A'}]];
  if(sql.includes('FROM tasks t'))return [[{id:'task_A',title:'Follow up'}]];
  if(sql.includes('FROM files'))return [[{id:'file_A',name:'A.txt'}]];
  return [[]];
 }};
 const r=await loadClient360('client_A',database);
 assert.equal(r.client.id,'client_A');assert.equal(r.displayed_counts.conversations,1);
 assert.equal(r.displayed_counts.tasks,1);assert.equal(r.limited,true);
 assert.equal(calls.length,8);
 assert.ok(calls.every(x=>/SELECT/i.test(x.sql)));
 assert.ok(calls.find(x=>x.sql.includes('FROM projects p')).sql.includes("r.from_type='client'"));
 assert.ok(calls.find(x=>x.sql.includes('FROM files')).sql.includes('client_id=?'));
});
test('client 360 rejects malformed IDs and unavailable customer',async()=>{
 const db={execute:async()=>[[]]};
 await assert.rejects(loadClient360('../client_B',db),/invalid_client_id/);
 await assert.rejects(loadClient360('client_B',db),/client_not_found/);
});
test('Gmail labels distinguish provider-confirmed zero from unknown',async()=>{
 const requests=[];
 const gmail={users:{labels:{
  list:async()=>({data:{labels:[{id:'INBOX',name:'Inbox',type:'system'},{id:'Label_1',name:'Project',type:'user'}]}}),
  get:async q=>{requests.push(q.id);return {data:{messagesTotal:9,messagesUnread:0,threadsTotal:7,threadsUnread:0}};}
 }}};
 const r=await gmailFolderOverview(gmail);
 assert.equal(r.provider,'gmail');assert.equal(r.read_only,true);
 assert.deepEqual(requests,['INBOX']);assert.equal(r.folders[0].messages_unread,0);
 assert.equal(r.folders[1].messages_unread,null);
 assert.equal(r.folders[1].kind,'custom');
});
test('IMAP native folders report only values confirmed by server, no flag mutations',async()=>{
 let listing;
 const client={list:async opts=>{listing=opts;return [
  {path:'INBOX',name:'Inbox',status:{messages:12,unseen:3,uidValidity:45n}},
  {path:'Sent',name:'Sent',specialUse:'\\Sent',status:{messages:5,unseen:0}},
  {path:'Archive',name:'Archive'},
  {path:'SpamHidden',flags:new Set(['\\Noselect'])}
 ];}};
 const result=await imapFolderOverview(client);
 assert.equal(result.folders.length,3);assert.equal(result.folders[0].messages_unread,3);
 assert.equal(result.folders.find(f=>f.id==='Sent').kind,'sent');assert.equal(result.folders.find(f=>f.id==='Archive').messages_unread,null);
 assert.equal(result.folders[0].uid_validity,'45');
 assert.equal(listing.statusQuery.unseen,true);
});
test('IMAP gracefully falls back to ordinary folder listing without inventing unread counts',async()=>{
 let calls=0;
 const result=await imapFolderOverview({list:async args=>{calls++;if(args)throw Error('unsupported LIST-STATUS');return [{path:'INBOX'}];}});
 assert.equal(calls,2);assert.equal(result.folders[0].messages_unread,null);
});
