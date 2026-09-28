import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraft} from '../src/inbox.js';

function fixture(){
 const state={latest:'message',active:true,inserts:0,audits:0,rollbacks:0,generated:0};
 const execute=async(sql)=>{
  if(sql.startsWith('SELECT * FROM message_drafts'))return [[]];
  if(sql.startsWith('SELECT id FROM conversations'))return [[{id:'conversation'}]];
  if(sql.startsWith('SELECT id FROM messages'))return [[{id:state.latest}]];
  if(sql.startsWith('SELECT id FROM reminders'))return [state.active?[{id:'reminder'}]:[]];
  if(sql.startsWith('INSERT IGNORE INTO message_drafts')){state.inserts++;return [{affectedRows:1}];}
  if(sql.startsWith('INSERT INTO ai_audit')){state.audits++;return [{affectedRows:1}];}
  throw Error('unexpected SQL '+sql);
 };
 const connection={execute,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{state.rollbacks++;},release(){}};
 const db={execute,getConnection:async()=>connection};
 const input={conversationId:'conversation',reminderId:'reminder',expectedLatestMessageId:'message',idempotencyKey:'followup'};
 const deps={db,draftReply:async()=>{state.generated++;return {draft:'draft',provider:'test',model:'test'};}};
 return {state,input,deps};
}
test('obsolete followup is skipped before generation',async()=>{
 const f=fixture();f.state.latest='reply';assert.equal((await createDraft(f.input,f.deps)).skipped,true);assert.equal(f.state.generated,0);assert.equal(f.state.inserts,0);
});
for(const change of ['reply','cancel','abort'])test('followup '+change+' during generation prevents draft persistence',async()=>{
 const f=fixture(),abort=new AbortController();f.input.signal=abort.signal;
 f.deps.draftReply=async()=>{if(change==='reply')f.state.latest='reply';if(change==='cancel')f.state.active=false;if(change==='abort')abort.abort();return {draft:'stale',provider:'test',model:'test'};};
 if(change==='abort')await assert.rejects(createDraft(f.input,f.deps),/background_claim_lost/);
 else assert.equal((await createDraft(f.input,f.deps)).skipped,true);
 assert.equal(f.state.inserts,0);assert.equal(f.state.audits,0);
});
test('current followup creates a draft and audit without sending',async()=>{
 const f=fixture(),result=await createDraft(f.input,f.deps);assert.equal(result.draft,'draft');assert.equal(f.state.inserts,1);assert.equal(f.state.audits,1);
});
