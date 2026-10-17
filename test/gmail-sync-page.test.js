import test from 'node:test';
import assert from 'node:assert/strict';
import {gmailSyncPage} from '../src/gmail-sync-page.js';
import {mailProviderState,updateMailProviderState} from '../src/mail-provider-state.js';
import {SyncScheduler} from '../src/scheduler.js';

const raw=id=>({data:{id,raw:'aGVsbG8',labelIds:['INBOX'],internalDate:'1700000000000'}});
function api({list=async()=>({data:{messages:[]}}),history=async()=>({data:{historyId:'150',history:[]}}),get=async({id})=>raw(id)}={}){
 return {users:{getProfile:async()=>({data:{historyId:'100'}}),messages:{list,get},history:{list:history}}};
}
test('Gmail full sync pins initial history before pages and includes spam/trash',async()=>{
 const requests=[];
 const gmail=api({list:async p=>{requests.push(p);return {data:{messages:[{id:'a'},{id:'a'}],nextPageToken:p.pageToken?undefined:'p2'}};}});
 const first=await gmailSyncPage(gmail);
 assert.equal(requests[0].includeSpamTrash,true);assert.equal(first.items.length,1);
 assert.deepEqual(first.nextState,{version:1,mode:'full',anchor:'100',page:'p2'});
 const last=await gmailSyncPage(gmail,first.nextState);
 assert.deepEqual(last.nextState,{version:1,mode:'delta',anchor:'100',page:''});
});
test('Gmail history deduplicates message/label events and advances history only on last page',async()=>{
 const requests=[];
 const gmail=api({history:async p=>{requests.push(p);return {data:{historyId:'900719925474099312345',
  nextPageToken:p.pageToken?undefined:'more',history:[{messages:[{id:'a'}],labelsAdded:[{message:{id:'a'}}],messagesAdded:[{message:{id:'b'}}]}]}};}});
 const state={version:1,mode:'delta',anchor:'101',page:''};
 const first=await gmailSyncPage(gmail,state);
 assert.deepEqual(first.items.map(x=>x.id),['a','b']);
 assert.equal(first.nextState.anchor,'101');
 const last=await gmailSyncPage(gmail,first.nextState);
 assert.equal(requests[1].startHistoryId,'101');
 assert.equal(last.nextState.anchor,'900719925474099312345');
});
test('Gmail expired history restarts full read without deletion; transient failures do not return a checkpoint',async()=>{
 const gmail=api({history:async()=>{throw {code:404};}});
 const page=await gmailSyncPage(gmail,{version:1,mode:'delta',anchor:'1',page:''});
 assert.equal(page.recovered,true);assert.equal(page.nextState.anchor,'100');
 for(const code of [401,403,429,500]){
  await assert.rejects(gmailSyncPage(api({history:async()=>{throw Object.assign(Error('provider_failed'),{code});}}),
   {version:1,mode:'delta',anchor:'1',page:''}),/provider_failed/);
 }
});
test('Gmail missing remote message becomes metadata tombstone; malformed pages fail',async()=>{
 const page=await gmailSyncPage(api({list:async()=>({data:{messages:[{id:'gone'}]}}),get:async()=>{throw {code:404};}}));
 assert.deepEqual(page.items,[{id:'gone',unavailable:true}]);
 await assert.rejects(gmailSyncPage(api({list:async()=>({data:{nextPageToken:'same'}})}),
  {version:1,mode:'full',anchor:'100',page:'same'}),/gmail_cursor_not_advancing/);
 await assert.rejects(gmailSyncPage(api({list:async()=>({data:{messages:[{id:'bad'}]}}),get:async()=>({data:{id:'bad'}})})),/gmail_message_payload_missing/);
});
test('provider state is account scoped and never writes CRM read state or deletes messages',async()=>{
 const calls=[];
 await updateMailProviderState({source:'google.gmail',account_id:'account-a',external_id:'same-id',provider_state:{available:true,labels:['UNREAD','INBOX','UNREAD']}},
  {execute:async(...args)=>calls.push(args)});
 assert.deepEqual(calls[0][1].slice(1),['google:account-a','same-id']);
 assert.doesNotMatch(calls[0][0],/is_read|DELETE/i);
 assert.deepEqual(JSON.parse(calls[0][1][0]),{available:true,labels:['UNREAD','INBOX'],unread:true});
 assert.throws(()=>mailProviderState({available:true,labels:[{}]}),/invalid_mail_provider_state/);
});
test('scheduler commits only successfully persisted accounts, supports crash-safe page replay',async()=>{
 let a=0,b=0,fail=true;
 const events=[{type:'message',source:'google.gmail',account_id:'a'}, {type:'sync.checkpoint',source:'google.gmail',account_id:'a',commit:async()=>a++},
  {type:'message',source:'google.gmail',account_id:'b'}, {type:'sync.checkpoint',source:'google.gmail',account_id:'b',commit:async()=>b++}];
 const scheduler=new SyncScheduler({connectors:{sync:async()=>({events})},workspace:{call:async(op,e)=>{
  if(e.account_id==='a'&&fail)throw Error('storage_failed');return {inserted:false};
 }}});
 const first=await scheduler.runOnce();assert.equal(first.errors,1);assert.equal(a,0);assert.equal(b,1);
 fail=false;await scheduler.runOnce();assert.equal(a,1);assert.equal(b,2);
});
test('provider-state persistence failure also prevents a Gmail checkpoint',async()=>{
 let committed=false;
 const scheduler=new SyncScheduler({connectors:{sync:async()=>({events:[
  {type:'mail.provider_state',source:'google.gmail',account_id:'a'},
  {type:'sync.checkpoint',source:'google.gmail',account_id:'a',commit:async()=>committed=true}]})},
  workspace:{call:async()=>undefined}});
 assert.equal((await scheduler.runOnce()).errors,1);assert.equal(committed,false);
});
