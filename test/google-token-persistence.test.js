import test from 'node:test';
import {randomUUID} from 'node:crypto';
const testRefresh=randomUUID(),testAccess=randomUUID();
import assert from 'node:assert/strict';
import {GoogleConnector} from '../src/connectors/google.js';
const initial=()=>({id:'a',email:'a@example.test',auth_revision:'consent-1',tokens:{refresh_token:testRefresh,scope:'read',access_token:testAccess}});
function fixture(){
 let value=initial();
 const vault={get:async()=>structuredClone(value),set:async(k,v)=>{value=structuredClone(v);},delete:async()=>{value=null;}};
 const connector=new GoogleConnector(vault);
 connector.oauthClient=(tokens,refresh)=>({refresh});
 return {connector,vault,get:()=>value};
}
test('delayed refresh cannot overwrite a newer consent generation',async()=>{
 const f=fixture(),client=await f.connector.clientFor(f.get());
 await f.vault.set('google:a',{...f.get(),auth_revision:'consent-2',tokens:{...f.get().tokens,scope:'read write'}});
 await client.refresh({access_token:'stale',scope:'read'});
 assert.equal(f.get().tokens.scope,'read write');assert.equal(f.get().tokens.access_token,testAccess);
});
test('refresh merges into current account and preserves omitted credentials',async()=>{
 const f=fixture(),client=await f.connector.clientFor(f.get());
 await f.vault.set('google:a',{...f.get(),name:'updated profile'});
 await client.refresh({access_token:'new',refresh_token:undefined,scope:null});
 assert.equal(f.get().name,'updated profile');assert.equal(f.get().tokens.refresh_token,testRefresh);assert.equal(f.get().tokens.scope,'read');
});
test('refresh cannot resurrect missing or explicitly disconnected accounts',async()=>{
 const f=fixture(),client=await f.connector.clientFor(f.get());
 await f.connector.disconnect('a');await client.refresh({access_token:'late'});assert.equal(f.get(),null);
 const g=fixture(),other=await g.connector.clientFor(g.get());
 await g.vault.delete('google:a');await other.refresh({access_token:'late'});assert.equal(g.get(),null);
});
test('disconnect waits for an in-flight token write then deletes it',async()=>{
 const f=fixture(),client=await f.connector.clientFor(f.get()),original=f.vault.set;
 let release,entered;
 const started=new Promise(r=>{entered=r;});
 f.vault.set=async(...args)=>{entered();await new Promise(r=>{release=r;});return original(...args);};
 const refresh=client.refresh({access_token:'new'});await started;
 const disconnect=f.connector.disconnect('a');release();await Promise.all([refresh,disconnect]);
 assert.equal(f.get(),null);assert.equal(f.connector.accountWrites.size,0);
});
test('legacy refresh fails closed after a changed scope or refresh credential',async()=>{
 for(const tokens of [{scope:'read write'},{refresh_token:'replacement'}]){
  const f=fixture();await f.vault.set('google:a',{...f.get(),auth_revision:undefined});
  const client=await f.connector.clientFor(f.get());
  await f.vault.set('google:a',{...f.get(),tokens:{...f.get().tokens,...tokens}});
  await client.refresh({access_token:'stale'});assert.equal(f.get().tokens.access_token,testAccess);
 }
});
test('a failed write does not poison the account queue',async()=>{
 const f=fixture(),client=await f.connector.clientFor(f.get()),original=f.vault.set;
 f.vault.set=async()=>{throw Error('test storage failure');};
 await assert.rejects(client.refresh({access_token:'failed'}),/storage failure/);
 f.vault.set=original;await client.refresh({access_token:'recovered'});
 assert.equal(f.get().tokens.access_token,'recovered');assert.equal(f.connector.accountWrites.size,0);
});
