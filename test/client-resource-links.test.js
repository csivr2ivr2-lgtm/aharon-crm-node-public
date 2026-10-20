import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveClientResource,linkClientResource,listClientResources,unlinkClientResource} from '../src/client-resource-links.js';
const ref={client_id:'client_a',provider:'google.drive',account_id:'account_a',external_id:'file_a'};
const record={generation:'current',available:1,state_json:JSON.stringify({generation:'current'}),payload_json:JSON.stringify({id:'file_a',name:'Private A'}),checked_at:'2026-10-20'};
test('resource lookup binds exact provider/account/source and rejects removed, old or mismatched records',async()=>{
 let current=record;const db={execute:async(sql,args)=>{assert.match(sql,/BINARY s.account_id=BINARY/);assert.deepEqual(args,['google.drive','account_a','file_a']);return [[current]];}};
 const authorize=async(p,a)=>{assert.equal(p,'google.drive');assert.equal(a,'account_a');};
 assert.equal((await resolveClientResource(ref,db,authorize)).item.name,'Private A');
 for(const update of [{available:0},{generation:'old'},{payload_json:'{"id":"other"}'}]){
  current={...record,...update};await assert.rejects(resolveClientResource(ref,db,authorize),/resource_unavailable/);
 }
 await assert.rejects(resolveClientResource(ref,{execute:()=>assert.fail('must not read')},async()=>{throw Error('permission');}),/permission/);
});
test('link requires confirmation, prevents reassignment and rolls back when audit fails',async()=>{
 let linked='client_a',auditFails=false,commits=0,rollbacks=0,releases=0;
 const c={beginTransaction:async()=>{},commit:async()=>commits++,rollback:async()=>rollbacks++,release:()=>releases++,
  execute:async(sql,args)=>{
   if(sql.includes('FROM clients'))return [[{id:ref.client_id}]];
   if(sql.includes('SELECT client_id'))return [[{client_id:linked}]];
   assert.match(sql,/INSERT IGNORE/);assert.equal(args[1],ref.client_id);return [{affectedRows:1}];
  }};
 const db={execute:async()=>[[record]],getConnection:async()=>c};
 const args={...ref,db,authorize:async()=>{},audit:async(e,options)=>{assert.equal(options.db,c);assert.equal(e.confirmation,'explicit');if(auditFails)throw Error('audit failed');}};
 await assert.rejects(linkClientResource(args),/confirmation/);
 assert.equal((await linkClientResource({...args,confirmed:true})).ok,true);
 linked='client_b';await assert.rejects(linkClientResource({...args,confirmed:true}),/another_client/);
 linked='client_a';auditFails=true;await assert.rejects(linkClientResource({...args,confirmed:true}),/audit failed/);
 assert.equal(commits,1);assert.equal(rollbacks,2);assert.equal(releases,3);
});
test('client resource list returns no cached payload after permission loss',async()=>{
 const db={execute:async(sql,args)=>{
  assert.match(sql,/BINARY client_id=BINARY/);assert.deepEqual(args,['client_a']);
  return [[{id:'link',...ref,linked_at:'2026-10-20'}]];
 }};
 const result=await listClientResources({client_id:'client_a',db,authorize:async()=>{throw Error('revoked');}});
 assert.deepEqual(result.items,[{id:'link',client_id:'client_a',provider:'google.drive',available:false}]);
});

test('unlink is scoped to an exact client, requires confirmation and audits transactionally',async()=>{
 const calls=[];let found=true;
 const c={beginTransaction:async()=>{},commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{},
  execute:async(sql,args)=>{assert.deepEqual(args,['a'.repeat(64),'client_a']);calls.push(sql.startsWith('SELECT')?'read':'delete');return [found?[{id:args[0]}]:[]];}};
 const args={client_id:'client_a',id:'a'.repeat(64),db:{getConnection:async()=>c},audit:async(e,o)=>{assert.equal(o.db,c);assert.equal(e.action,'client.resource.unlink');calls.push('audit');}};
 await assert.rejects(unlinkClientResource(args),/confirmation/);
 await unlinkClientResource({...args,confirmed:true});assert.deepEqual(calls,['read','audit','delete','commit']);
 calls.length=0;found=false;await assert.rejects(unlinkClientResource({...args,confirmed:true}),/not_found/);assert.deepEqual(calls,['read','rollback']);
});
