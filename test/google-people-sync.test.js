import test from 'node:test';
import assert from 'node:assert/strict';
import {peopleSyncPage} from '../src/google-people-sync.js';
import {googlePermissions,CONTACTS_READ,GMAIL_MODIFY} from '../src/google-permissions.js';
import {GoogleConnector} from '../src/connectors/google.js';
import {verifyOauthState} from '../src/connectors/security.js';
const client=fn=>({people:{connections:{list:fn}}});
test('People full and incremental pages preserve parameters and commit tokens only at the end',async()=>{
 const calls=[],responses=[{connections:[{resourceName:'people/1',names:[{displayName:'אדם'}],emailAddresses:[{value:'a@example.test'}]}],nextPageToken:'p2'},{nextSyncToken:'s1'},{connections:[{resourceName:'people/1',metadata:{deleted:true}}],nextPageToken:'p3'},{nextSyncToken:'s2'}];
 const api=client(async p=>{calls.push(p);return {data:responses.shift()};});
 const first=await peopleSyncPage(api),second=await peopleSyncPage(api,first.nextState),third=await peopleSyncPage(api,second.nextState),last=await peopleSyncPage(api,third.nextState);
 assert.equal(first.nextState.anchor,'');assert.equal(first.items[0].emails[0].verified,false);
 assert.equal(second.nextState.anchor,'s1');assert.equal(third.nextState.anchor,'s1');assert.equal(last.nextState.anchor,'s2');
 assert.deepEqual(third.items,[{id:'people/1',available:false}]);
 assert.equal(calls[1].pageToken,'p2');assert.equal(calls[1].syncToken,undefined);
 assert.equal(calls[3].syncToken,'s1');assert.equal(calls[3].pageToken,'p3');
 for(const p of calls){assert.equal(p.personFields,calls[0].personFields);assert.deepEqual(p.sources,['READ_SOURCE_TYPE_CONTACT']);assert.equal(p.requestSyncToken,true);}
});
test('People expired token starts a fresh generation; rate limits and permission errors do not reset state',async()=>{
 const old={version:1,mode:'delta',anchor:'old',page:'',generation:'old-generation'};
 let n=0;
 const fresh=await peopleSyncPage(client(async()=>{if(!n++)throw {response:{data:{error:{details:[{reason:'EXPIRED_SYNC_TOKEN'}]}}}};return {data:{nextSyncToken:'fresh'}};}),old);
 assert.equal(fresh.recovered,true);assert.notEqual(fresh.nextState.generation,old.generation);
 for(const code of [403,429,503])await assert.rejects(peopleSyncPage(client(async()=>{throw Object.assign(Error('provider failed'),{code});}),old),/provider failed/);
 assert.equal(old.anchor,'old');
});
test('People rejects incomplete responses and repeated page cursors',async()=>{
 await assert.rejects(peopleSyncPage(client(async()=>({data:{}}))),/people_cursor_missing/);
 await assert.rejects(peopleSyncPage(client(async()=>({data:{connections:[{}],nextSyncToken:'s'}}))),/people_id_missing/);
 await assert.rejects(peopleSyncPage(client(async()=>({data:{nextPageToken:'p'}})),{version:1,mode:'full',anchor:'',page:'p',generation:'g'}),/people_cursor_not_advancing/);
});
test('Contacts consent is explicit, account-bound and requests no Gmail write expansion',async()=>{
 const c=new GoogleConnector({get:async()=>({id:'a',email:'a@example.test',tokens:{}})});
 c.configured=()=>true;c.oauthClient=()=>({generateAuthUrl:p=>p});
 await assert.rejects(c.permissionUrl({account_id:'a',purpose:'contacts_read'}),/explicit_confirmation_required/);
 const p=await c.permissionUrl({account_id:'a',purpose:'contacts_read',confirmed:true});
 assert.ok(p.scope.includes(CONTACTS_READ));assert.ok(!p.scope.includes(GMAIL_MODIFY));
 assert.equal(verifyOauthState(p.state).account_id,'a');assert.equal(verifyOauthState(p.state).purpose,'contacts_read');
 await assert.rejects(c.permissionUrl({account_id:'a',purpose:'anything',confirmed:true}),/invalid_google_permission_purpose/);
 assert.equal(googlePermissions().contacts_read,false);assert.equal(googlePermissions({scope:CONTACTS_READ}).contacts_read,true);
 await assert.rejects(c.peopleApi('a'),/people_sync_disabled/);
});

test('Contacts consent does not add unrelated baseline scopes previously declined',async()=>{
 const granted='https://www.googleapis.com/auth/drive.metadata.readonly';
 const c=new GoogleConnector({get:async()=>({id:'a',email:'a@example.test',tokens:{scope:granted}})});
 c.configured=()=>true;c.oauthClient=()=>({generateAuthUrl:p=>p});
 const request=await c.permissionUrl({account_id:'a',purpose:'contacts_read',confirmed:true});
 assert.ok(request.scope.includes(granted));assert.ok(request.scope.includes(CONTACTS_READ));
 assert.ok(!request.scope.some(s=>s.includes('gmail')||s.includes('calendar')));
});
