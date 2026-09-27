import test from 'node:test';
import assert from 'node:assert/strict';
const {db}=await import('../src/db.js');
const {WorkspaceService}=await import('../src/workspace-service.js');
test.after(()=>db.end());
test('parallel manual client creation serializes identity recheck and inserts one client',async t=>{
 const clients=[];let gate=Promise.resolve();let released=0;
 t.mock.method(db,'getConnection',async()=>{
  let unlock;
  return {beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){released++;},execute:async(sql,args)=>{
   if(sql.includes('GET_LOCK')){const previous=gate;gate=new Promise(resolve=>{unlock=resolve;});await previous;return [[{acquired:1}]];}
   if(sql.includes('RELEASE_LOCK')){unlock();return [[{released:1}]];}
   if(sql.startsWith('SELECT * FROM clients WHERE id='))return [clients.filter(c=>c.id===args[0])];
   if(sql.startsWith('SELECT id FROM clients WHERE LOWER(email)'))return [clients.filter(c=>c.email===args[0]&&c.id!==args[1])];
   if(sql.startsWith('SELECT client_id FROM client_identities'))return [[]];
   if(sql.startsWith('INSERT INTO clients'))clients.push({id:args[0],email:args[3]});
   return [{affectedRows:1}];
  }};
 });
 const workspace=new WorkspaceService();const results=await Promise.allSettled([workspace.call('client.create',{name:'דוד',email:'david@example.test'}),workspace.call('client.create',{name:'דוד אחר',email:'DAVID@example.test'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(clients.length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/client_already_exists/);assert.equal(released,2);
});
test('generic entity update cannot bypass lifecycle confirmations',async()=>{
 for(const field of ['deleted_at','archived_at'])await assert.rejects(new WorkspaceService().call('project.update',{id:'p',[field]:new Date().toISOString()}),/use_lifecycle_action/);
});
