import test from 'node:test';
import assert from 'node:assert/strict';
import {BackgroundActionRuntime} from '../src/ai/background-actions.js';
import {toolDefinitions,validateTool} from '../src/ai/actions.js';

function fixture(handler=async()=>({ok:true,id:'file',token:'private'})){
 const actions=new Map(),audits=[],job={id:'job-1',claim_token:'claim-1'},payload={fileId:'file-1'};
 let claim='claim-1',acquired=1,snapshot,failAudit=false;
 const connection={release(){},async beginTransaction(){snapshot={actions:structuredClone(actions),count:audits.length};},async commit(){snapshot=null;},async rollback(){if(snapshot){actions.clear();for(const [k,v] of snapshot.actions)actions.set(k,v);audits.length=snapshot.count;}snapshot=null;},async execute(sql,p=[]){
  if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired}]];
  if(sql.startsWith('SELECT RELEASE_LOCK'))return [[{released:1}]];
  if(sql.startsWith('SELECT type,payload_json'))return [p[1]===claim?[{type:'file.index',payload_json:JSON.stringify(payload)}]:[]];
  if(sql.startsWith('SELECT * FROM ai_actions'))return [[actions.get(p[0])].filter(Boolean)];
  if(sql.startsWith('INSERT INTO ai_actions')){actions.set(p[0],{id:p[0],actor:p[1],source:p[2],tool:p[3],args_json:p[4],state:'executing'});return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE ai_actions SET state='executing'")){actions.get(p[1]).state='executing';return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE ai_actions SET state='completed'")){Object.assign(actions.get(p[2]),{state:'completed',result_json:p[0]});return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE ai_actions SET state='retryable'")){const row=actions.get(p[1]);if(row?.state==='executing')row.state='retryable';return [{affectedRows:1}];}
  if(sql.startsWith('INSERT INTO ai_audit')){if(failAudit&&p[11]==='completed'){failAudit=false;throw Error('audit_unavailable');}audits.push(p);return [{affectedRows:1}];}
  if(sql.startsWith('INSERT INTO activities'))return [{affectedRows:1}];
  throw Error('unexpected_sql '+sql);
 }};
 const database={getConnection:async()=>connection},runtime=new BackgroundActionRuntime({database,handlers:{'file.index':handler}});
 return {runtime,actions,audits,payload,job,context:{source:'queue',job},loseClaim:()=>claim='other',restoreClaim:()=>claim=job.claim_token,denyLock:()=>acquired=0,failCompletionAudit:()=>failAudit=true};
}
test('internal action registry cannot be accessed by chat tools or arbitrary handlers',async()=>{
 assert.ok(!toolDefinitions().some(t=>t.function.name==='file.index'));
 assert.throws(()=>validateTool('file.index',{fileId:'file'}),/unknown_tool/);
 assert.throws(()=>new BackgroundActionRuntime({handlers:{send_email:async()=>{}}}),/unknown_background_handler/);
 const f=fixture();await assert.rejects(f.runtime.execute('file.index',f.payload,{source:'chat'}),/untrusted/);
 await assert.rejects(f.runtime.execute('shell',{},f.context),/unknown_background/);
 await assert.rejects(f.runtime.execute('file.index',{...f.payload,command:'shell'},f.context));assert.equal(f.actions.size,0);
});
test('durable completed replay returns redacted result and emits one completion audit',async()=>{
 let count=0;const f=fixture(async()=>{count++;return {ok:true,token:'private',id:'file'};});
 const first=await f.runtime.execute('file.index',f.payload,f.context);
 const restarted=new BackgroundActionRuntime({database:f.runtime.database,handlers:{'file.index':async()=>{throw Error('must_not_rerun');}}});
 assert.deepEqual(await restarted.execute('file.index',f.payload,f.context),first);
 assert.equal(count,1);assert.equal(first.token,'[redacted]');assert.equal(f.audits.filter(p=>p[11]==='completed').length,1);
});
test('failed idempotent handler can recover on redelivery with same durable action id',async()=>{
 let count=0;const f=fixture(async()=>{if(++count===1)throw Error('provider failed with secret');return {ok:true};});
 await assert.rejects(f.runtime.execute('file.index',f.payload,f.context));assert.equal([...f.actions.values()][0].state,'retryable');
 const id=[...f.actions.keys()][0];await f.runtime.execute('file.index',f.payload,f.context);
 assert.equal(f.actions.size,1);assert.equal(f.actions.get(id).state,'completed');assert.equal(count,2);assert.ok(!JSON.stringify(f.audits).includes('secret'));
});
test('claim and persisted queue payload are verified before calling handlers',async()=>{
 let count=0;const f=fixture(async()=>{count++;return {};});f.loseClaim();
 await assert.rejects(f.runtime.execute('file.index',f.payload,f.context),/claim_lost/);
 f.restoreClaim();await assert.rejects(f.runtime.execute('file.index',{fileId:'different'},f.context),/claim_lost/);
 f.denyLock();await assert.rejects(f.runtime.execute('file.index',f.payload,f.context),/busy/);assert.equal(count,0);
});
test('lease lost during operation cannot complete journal and retry can recover',async()=>{
 let first=true;const f=fixture(async()=>{if(first){first=false;f.loseClaim();}return {ok:true};});
 await assert.rejects(f.runtime.execute('file.index',f.payload,f.context),/claim_lost/);assert.equal([...f.actions.values()][0].state,'retryable');
 f.restoreClaim();await f.runtime.execute('file.index',f.payload,f.context);assert.equal([...f.actions.values()][0].state,'completed');
});
test('audit completion and action result persist atomically',async()=>{
 const f=fixture();f.failCompletionAudit();await assert.rejects(f.runtime.execute('file.index',f.payload,f.context),/audit_unavailable/);
 assert.equal([...f.actions.values()][0].state,'retryable');assert.equal(f.audits.filter(p=>p[11]==='completed').length,0);
 await f.runtime.execute('file.index',f.payload,f.context);assert.equal(f.audits.filter(p=>p[11]==='completed').length,1);
});
test('aborted job never starts the handler',async()=>{
 const f=fixture(),abort=new AbortController();abort.abort();f.job.signal=abort.signal;
 await assert.rejects(f.runtime.execute('file.index',f.payload,f.context),/claim_lost/);assert.equal(f.actions.size,0);
});
