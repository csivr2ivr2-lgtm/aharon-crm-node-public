import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLead,saveLead,renameSalesStage,listSales} from '../src/sales-pipeline.js';
const good={title:'Inquiry',client_id:'client_a',source:'email',stage_id:'new',next_action:'Call',followup_date:'2026-10-23'};
test('lead validation rejects unknown identities and invalid dates',()=>{
 validateLead(good);
 for(const p of [{...good,title:''},{...good,client_id:'a/b'},{...good,followup_date:'2026-02-31'},{...good,stage_id:''}])assert.throws(()=>validateLead(p));
});
test('lead writes require explicit confirmation before database access',async()=>{
 await assert.rejects(saveLead({...good,db:null}),/confirmation_required/);
 await assert.rejects(saveLead({...good,id:'lead_a',confirmed:true,db:null}),/revision_required/);
 await assert.rejects(renameSalesStage({id:'new',label:'New',revision:0,db:null}),/invalid_stage/);
});
test('lead stale update rolls back without SQL write',async()=>{
 const calls=[];const c={beginTransaction:async()=>{},execute:async sql=>{calls.push(sql);if(sql.includes('FROM clients'))return [[{id:'client_a'}]];if(sql.includes('FROM sales_stages'))return [[{id:'new'}]];return [[{id:'lead_a',revision:3}]];},rollback:async()=>calls.push('rollback'),release:()=>{},commit:async()=>calls.push('commit')};
 await assert.rejects(saveLead({...good,id:'lead_a',revision:2,confirmed:true,db:{getConnection:async()=>c},audit:async()=>{throw Error('must not audit stale write');}}),/revision_conflict/);
 assert.ok(calls.includes('rollback'));assert.ok(!calls.some(s=>s.startsWith('UPDATE')));assert.ok(!calls.includes('commit'));
});
test('search is parameterized and bounded',async()=>{
 let sqlSeen='',valuesSeen;const db={query:async()=>[[]],execute:async(sql,values)=>{sqlSeen=sql;valuesSeen=values;return [[]];}};
 await listSales(db,{q:"' OR 1=1",stage:'new'});
 assert.ok(!sqlSeen.includes('OR 1=1'));assert.ok(sqlSeen.includes('LIMIT 201'));assert.equal(valuesSeen[0],"' OR 1=1");
});
