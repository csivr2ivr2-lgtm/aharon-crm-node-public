import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerMemory,updateOwnerMemory,deleteOwnerMemory,listOwnerMemories,retrieveOwnerMemories,migrateOwnerMemories} from '../src/owner-memory.js';

function fixture(){
 const rows=[],queries=[];
 const database={
  query:async sql=>{queries.push(sql);return [[]];},
  execute:async(sql,args=[])=>{
   queries.push(sql);
   if(sql.startsWith('INSERT INTO owner_memories')){rows.push({id:args[0],actor:args[1],kind:args[2],subject:args[3],body:args[4],revision:1,updated_at:args[6],created_at:args[5],source:'owner_manual'});return [{affectedRows:1}];}
   if(sql.startsWith('UPDATE owner_memories')){const row=rows.find(r=>r.id===args[4]&&r.actor===args[5]&&r.revision===args[6]);if(!row)return [{affectedRows:0}];Object.assign(row,{kind:args[0],subject:args[1],body:args[2],revision:row.revision+1,updated_at:args[3]});return [{affectedRows:1}];}
   if(sql.startsWith('DELETE FROM owner_memories')){const i=rows.findIndex(r=>r.id===args[0]&&r.actor===args[1]&&r.revision===args[2]);if(i<0)return [{affectedRows:0}];rows.splice(i,1);return [{affectedRows:1}];}
   if(sql.startsWith('SELECT '))return [rows.filter(r=>r.actor===args[0])];
   throw Error('Unexpected query: '+sql);
  }
 };return {database,rows,queries};
}
test('memory migration is additive and supports MariaDB/MySQL schema',async()=>{
 const f=fixture();await migrateOwnerMemories(f.database);
 assert.match(f.queries[0],/CREATE TABLE IF NOT EXISTS owner_memories/);
});
test('owner-controlled facts can be recalled in another session, edited and deleted',async()=>{
 const f=fixture();
 const a=await createOwnerMemory({kind:'decision',subject:'מחירון אהרן בענן',body:'המחיר שנבחר לתוכנית בסיסית הוא 9 ש״ח'},f.database);
 const b=await createOwnerMemory({kind:'preference',subject:'סגנון העבודה',body:'להיות תמציתי'},f.database);
 assert.equal((await listOwnerMemories({},f.database)).items.length,2);
 const related=await retrieveOwnerMemories({query:'מה החלטנו על המחירון?'},f.database);
 assert.equal(related[0].id,a.id);assert.ok(related.some(x=>x.id===b.id));
 await assert.rejects(updateOwnerMemory({id:a.id,revision:5,kind:'decision',subject:'מחירון',body:'עודכן'},f.database),/not_found_or_changed/);
 await updateOwnerMemory({id:a.id,revision:1,kind:'decision',subject:'מחירון אהרן בענן',body:'תוכנית בסיסית 10'},f.database);
 assert.match((await retrieveOwnerMemories({query:'מחירון'},f.database))[0].body,/10/);
 await assert.rejects(deleteOwnerMemory({id:a.id,revision:1},f.database),/not_found_or_changed/);
 await deleteOwnerMemory({id:a.id,revision:2},f.database);
 assert.ok(!(await retrieveOwnerMemories({query:'מחירון'},f.database)).some(x=>x.id===a.id));
});
test('reject unauthorized actors, empty/oversized facts, forged IDs and invalid kinds',async()=>{
 const f=fixture();
 await assert.rejects(createOwnerMemory({actor:'customer',kind:'fact',subject:'x',body:'y'},f.database),/access_denied/);
 await assert.rejects(createOwnerMemory({kind:'secret',subject:'x',body:'y'},f.database),/invalid_owner_memory_kind/);
 await assert.rejects(createOwnerMemory({kind:'fact',subject:'',body:'y'},f.database),/invalid_owner_memory_subject/);
 await assert.rejects(createOwnerMemory({kind:'fact',subject:'x',body:'z'.repeat(2501)},f.database),/invalid_owner_memory_body/);
 await assert.rejects(deleteOwnerMemory({id:'../other',revision:1},f.database),/invalid_owner_memory_id/);
 await assert.rejects(retrieveOwnerMemories({actor:'customer',query:'all'},f.database),/access_denied/);
});
test('retrieval is bounded and sends no SQL containing the untrusted query',async()=>{
 const f=fixture();await createOwnerMemory({kind:'project',subject:'בדיקת פרויקט',body:'x'.repeat(1500)},f.database);
 assert.deepEqual(await retrieveOwnerMemories({query:"' OR 1=1 --",maxChars:200},f.database),[]);
 assert.ok(!f.queries.some(q=>q.includes("' OR 1=1 --")));
});
