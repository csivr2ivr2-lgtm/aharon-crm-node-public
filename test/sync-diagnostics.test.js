import test from 'node:test';
import assert from 'node:assert/strict';
import {syncFailure,syncIssue,issueSummary} from '../src/sync-diagnostics.js';
import {SyncScheduler} from '../src/scheduler.js';
test('safe failure categories, no secret leakage',()=>{
 const issue=syncIssue('google.gmail','fetch',{response:{status:401},message:'secret token ABC123'},'account@test.example');
 assert.equal(issue.error,'auth_expired');assert.equal(JSON.stringify(issue).includes('ABC123'),false);
 assert.equal(syncFailure({message:'invalid_grant'}),'auth_expired');
 assert.equal(syncFailure({response:{status:403}}),'permission_denied');
 assert.equal(syncFailure({code:'ER_BAD_FIELD_ERROR'}),'database_schema_error');
 assert.equal(syncFailure({message:'ETIMEDOUT'}),'connection_failed');
 assert.equal(issueSummary([issue]).length,1);
});
test('sync reports per account failures and duplicate-safe ingests',async()=>{
 const events=[{type:'sync.error',source:'google.gmail',stage:'fetch',account_id:'g1',error:'auth_expired'},
  {type:'message',source:'hostinger.imap',account_id:'h1',id:'m1'},
  {type:'message',source:'hostinger.imap',account_id:'h1',id:'m2'}];
 let count=0;
 const scheduler=new SyncScheduler({connectors:{sync:async()=>({events})},workspace:{call:async()=>({inserted:++count===1})},hub:{publish:()=>{}},logger:{warn:()=>{}}});
 const result=await scheduler.runOnce();
 assert.equal(result.imported,1);assert.equal(result.duplicates,1);assert.equal(result.errors,1);
 assert.equal(result.issues[0].account_id,'g1');assert.equal(scheduler.lastReport, result);
});

test('missing persistence acknowledgements are failures, never duplicates or realtime success',async()=>{
 for(const result of [undefined,null,{}, {inserted:'false'}, {inserted:false,skipped:'unavailable'}]){
  let published=0;
  const scheduler=new SyncScheduler({connectors:{sync:async()=>({events:[{type:'message',source:'google.gmail',account_id:'a'}]})},workspace:{call:async()=>result},hub:{publish:()=>published++}});
  const report=await scheduler.runOnce();
  assert.equal(report.errors,1);assert.equal(report.duplicates,0);assert.equal(report.imported,0);assert.equal(published,0);
 }
});
