import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSettings,getSettings,updateSettings,DEFAULT_SETTINGS} from '../src/platform/settings.js';
import {redactAudit,audit} from '../src/platform/audit.js';
import {enqueueJob,claimJob,failJob,completeJob,renewJob,retryJob} from '../src/platform/jobs.js';
import {migratePlatform} from '../src/platform/schema.js';

test('settings preserve safe send defaults, merge categories and reject unsafe settings',()=>{
  const settings=validateSettings({automation:{drafts:'off'}});
  assert.equal(settings.messaging.policy,'always_confirm');assert.equal(settings.automation.clients,'suggest');
  assert.equal(settings.automation.drafts,'off');
  for(const patch of [{ai:{contextSize:10000000}},{ai:{provider:'made-up'}},{messaging:{policy:'send_everything'}},{automation:{clients:true}},{admin:true},{ai:null}])assert.throws(()=>validateSettings(patch));
  assert.equal(DEFAULT_SETTINGS.automation.drafts,'automatic');
});
test('settings mutations lock the singleton row and commit audit atomically',async()=>{
  const calls=[],connection={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql)=>{calls.push(sql);return sql.startsWith('SELECT')?[[{value_json:JSON.stringify(DEFAULT_SETTINGS)}]]:[{affectedRows:1}];}};
  const result=await updateSettings({messaging:{signature:'שלום'}},{db:{getConnection:async()=>connection}});
  assert.equal(result.messaging.signature,'שלום');assert.ok(calls.some(sql=>sql.includes('FOR UPDATE')));
  assert.ok(calls.findIndex(sql=>sql.startsWith('INSERT INTO ai_audit'))<calls.indexOf('commit'));
  assert.equal(calls.at(-1),'release');assert.ok(!calls.includes('rollback'));
});
test('settings audit failures roll back changes',async()=>{
  let rolledBack=false,committed=false;
  const connection={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},release(){},execute:async(sql)=>{if(sql.startsWith('INSERT INTO ai_audit'))throw Error('audit_failed');return sql.startsWith('SELECT')?[[{value_json:JSON.stringify(DEFAULT_SETTINGS)}]]:[{affectedRows:1}];}};
  await assert.rejects(updateSettings({automation:{tasks:'automatic'}},{db:{getConnection:async()=>connection}}),/audit_failed/);
  assert.equal(rolledBack,true);assert.equal(committed,false);
});
test('missing settings return detached defaults',async()=>{
  const result=await getSettings({execute:async()=>[[]]});result.messaging.trustedClientIds.push('test');
  assert.deepEqual(DEFAULT_SETTINGS.messaging.trustedClientIds,[]);
});
test('audit scrubs nested credentials and bearer authorization',async()=>{
  const input={password:'private',nested:{apiKey:'private',text:'Bearer abc123'},list:[{refresh_token:'private'}]};
  const clean=redactAudit(input);assert.equal(clean.password,'[redacted]');assert.equal(clean.nested.apiKey,'[redacted]');assert.equal(clean.nested.text,'Bearer [redacted]');assert.equal(clean.list[0].refresh_token,'[redacted]');
  let args;await audit({action:'test',after:input},{db:{execute:async(sql,values)=>{args=values;return [{affectedRows:1}];}}});assert.ok(!args[10].includes('private'));
});
test('enqueue uses a unique business key and returns the existing durable job',async()=>{
  let stored,insertions=0;
  const fake={execute:async(sql,args)=>{
    if(sql.startsWith('INSERT')){assert.ok(sql.includes('ON DUPLICATE KEY'));if(!stored){stored={id:args[0],type:args[1],payload_json:args[2],idempotency_key:args[4]};insertions++;}return [{affectedRows:stored?0:1}];}
    return [[stored]];
  }};
  const a=await enqueueJob('inbox.process',{messageId:'m1'},{idempotencyKey:'incoming:m1',db:fake});
  const b=await enqueueJob('inbox.process',{messageId:'m1'},{idempotencyKey:'incoming:m1',db:fake});
  assert.equal(a.id,b.id);assert.equal(insertions,1);
  await assert.rejects(enqueueJob('test',{}, {maxAttempts:0,db:fake}),/invalid_max_attempts/);
});
test('claim locks selection, increments attempts and commits an expiring ownership token',async()=>{
  const calls=[];let args;
  const connection={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>{},release:()=>calls.push('release'),execute:async(sql,values)=>{
    calls.push(sql);if(sql.startsWith('SELECT')){assert.ok(sql.includes('FOR UPDATE'));assert.ok(sql.includes('type IN'));return [[{id:'j',attempts:1,max_attempts:3}]];}
    if(sql.includes("SET status='running'"))args=values;return [{affectedRows:1}];
  }};
  const job=await claimJob({db:{getConnection:async()=>connection},types:['inbox.process'],leaseMs:6000});
  assert.equal(job.attempts,2);assert.equal(job.claim_token,args[0]);assert.ok(Date.parse(job.lease_until)>Date.now());assert.equal(calls.at(-2),'commit');assert.equal(calls.at(-1),'release');
});
test('retry exhaustion and stale lease fencing protect completion and rescheduling',async()=>{
  const calls=[],fake={execute:async(sql,args)=>{calls.push({sql,args});assert.ok(sql.includes('claim_token=?'));assert.ok(sql.includes('lease_until>?'));return [{affectedRows:0}];}};
  const job={id:'j',claim_token:'stale',attempts:2,max_attempts:3};
  assert.equal(await completeJob(job,{db:fake}),false);assert.equal(await renewJob(job,{db:fake}),false);
  assert.equal(await failJob(job,Error('secret password=abcdef'),{db:fake}),false);
  assert.equal(calls.at(-1).args[0],'queued');assert.equal(calls.at(-1).args[1],'job_execution_failed');
  await failJob({...job,attempts:3},Error('provider_unavailable'),{db:fake});assert.equal(calls.at(-1).args[0],'failed');assert.ok(calls.at(-1).args[3]);
});
test('manual retry only revives failed jobs and retains the idempotency key',async()=>{
  await retryJob('j',{db:{execute:async(sql)=>{assert.ok(sql.includes("status='failed'"));assert.ok(!sql.includes('idempotency_key'));return [{affectedRows:1}];}}});
});
test('platform migrations are additive and only create the missing unique index',async()=>{
  const sqls=[],columns=[];
  await migratePlatform({db:{query:async(sql)=>{sqls.push(sql);return sql.startsWith('SHOW')?[[{Key_name:'uq_job_idempotency'}]]:[{}];}},ensureColumn:async(...args)=>columns.push(args)});
  assert.ok(columns.some(([table,column])=>table==='outgoing_sends'&&column==='request_hash'));
  assert.ok(columns.some(([table,column])=>table==='jobs'&&column==='lease_until'));
  assert.ok(sqls.every(sql=>!/(DROP|DELETE|TRUNCATE)/.test(sql)));assert.ok(!sqls.some(sql=>sql.startsWith('CREATE UNIQUE INDEX')));
});
