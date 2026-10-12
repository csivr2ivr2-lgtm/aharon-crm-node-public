import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {nonCustomerSignal} from '../src/ai/inbox-signals.js';
import {classifyMessage,applySenderFeedbackPage} from '../src/ai/intelligence.js';
import {decideInbox} from '../src/ai/inbox-decision.js';
import {historyPageJob,discoverHistoryAccounts} from '../src/historical-sync.js';

test('AliExpress rotation is spam regardless of exact sending mailbox, not a customer inquiry',()=>{
 for(const sender of ['AliExpress <deals47@updates.example>','orders@aliexpress.com','ALi ExPRESS <notice2@fresh-mail.example>']){
  const m={sender,subject:'Order update',body:'package dispatched'};
  assert.equal(nonCustomerSignal(m)?.classification,'spam');
  assert.equal(classifyMessage(m,{feedback:'normal'}).classification,'spam');
  assert.equal(decideInbox(m).message_type,'spam');
 }
 assert.equal(nonCustomerSignal({sender:'client@example.com',subject:'Re: AliExpress integration quote',body:'Need a quote'}),null);
});
test('WhatsApp numbers are human-readable without changing non-Israeli numbers or display names',async()=>{
 const src=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 const extract=src.match(/function phoneForDisplay\(value\)\{[\s\S]*?\n\}/)?.[0];
 assert.ok(extract);
 const format=runInNewContext(extract+';phoneForDisplay');
 assert.equal(format('972501234567@s.whatsapp.net'),'0501234567');
 assert.equal(format('050-1234567'),'0501234567');
 assert.equal(format('1234567890@s.whatsapp.net'),'+1234567890');
 assert.equal(format('Customer Support'),'Customer Support');
});
test('sender-wide feedback pages match canonical identities exactly; no full-table UPDATE',async()=>{
 const runId='feedback:'+ 'a'.repeat(40),updates=[],queue=[];
 const incoming=[{id:'001',sender:'0501234567',direction:'in'},{id:'002',sender:'972501234567@s.whatsapp.net',direction:'in'},{id:'003',sender:'0501234568',direction:'in'},{id:'004',sender:'0501234567',direction:'out'}];
 const database={execute:async(sql,args)=>{
  if(sql.startsWith('SELECT classification FROM sender_feedback'))return [[{classification:'spam'}]];
  if(sql.startsWith('SELECT id,sender,direction FROM messages'))return [incoming];
  if(sql.startsWith('UPDATE messages SET')){updates.push({sql,args});return [{affectedRows:2}];}
  throw Error('unexpected_sql');
 }};
 const r=await applySenderFeedbackPage({identityKey:'phone:972501234567',classification:'spam',runId},{db:database,enqueue:async(...a)=>queue.push(a)});
 assert.equal(r.updated,2);assert.equal(r.done,true);assert.equal(queue.length,0);
 assert.deepEqual(updates[0].args.slice(-2),['001','002']);
 assert.match(updates[0].sql,/WHERE id IN/);
});
test('historical per-account crawl commits cursor only after ingestion and schedules next page',async()=>{
 const writes=[],scheduled=[],seen=[];
 const database={execute:async(sql,p)=>{
  if(sql.startsWith('SELECT cursor,state FROM'))return [[{cursor:'',state:'running'}]];
  if(sql.startsWith('UPDATE historical_sync_progress')){writes.push(p);return [{affectedRows:1}];}
  throw Error('unexpected_sql');
 }};
 const google={historyPage:async()=>({account:{email:'me@example.com',name:'Owner'},messages:[{id:'m1',thread_id:'t1',from:'other@example.com',to:'me@example.com',cc:'',headers:{},message_id:'<m1>',references:[],subject:'Hello',body:'hello',unread:false,sent_at:'2026-01-01T00:00:00Z'}],next_cursor:'next-page',done:false})};
 const params={provider:'google',accountId:'g1',key:'google:g1'};
 const deps={database,google,enqueue:async(...args)=>scheduled.push(args),ingest:async event=>{seen.push(event);return {inserted:true};}};
 const r=await historyPageJob(params,deps);
 assert.equal(r.imported,1);assert.equal(writes[0][0],'next-page');assert.equal(seen[0].conversation_external_id,'gmail:g1:t1');assert.equal(scheduled.length,1);
 assert.equal(scheduled[0][0],'history.page');
 await assert.rejects(historyPageJob(params,{...deps,ingest:async()=>{throw Error('ingest_failed');}}),/ingest_failed/);
 assert.equal(writes.length,1,'failed ingestion must not advance checkpoint');
});
test('discovery schedules every connected mail account and preserves completed checkpoints',async()=>{
 const scheduled=[];
 const database={execute:async(sql,args)=>{
  if(sql.startsWith('INSERT IGNORE INTO historical_sync_progress'))return [{affectedRows:1}];
  if(sql.startsWith('SELECT cursor,state FROM'))return [[{cursor:args[0]==='google:finished'?'':'token',state:args[0]==='google:finished'?'done':'running'}]];
  throw Error('unexpected_sql');
 }};
 const r=await discoverHistoryAccounts({database,google:{accounts:async()=>[{id:'a'},{id:'finished'}]},hostinger:{configured:()=>true,settings:()=>({user:'owner@example.com'})},enqueue:async(...a)=>scheduled.push(a)});
 assert.equal(r.accounts,3);assert.equal(r.scheduled,2);assert.equal(scheduled.length,2);
 assert.deepEqual(scheduled.map(a=>a[1].key),['google:a','hostinger:owner@example.com']);
});

test('AliExpress historical sweep changes only branded inbound messages in batches',async()=>{
 const writes=[],db={execute:async(sql,p)=>{
  if(sql.startsWith('SELECT id,sender'))return [[{id:'a',sender:'AliExpress <notice@fresh.example>',subject:'Order update',direction:'in'},{id:'b',sender:'customer@example.com',subject:'Quote request',direction:'in'},{id:'c',sender:'AliExpress <out@example.org>',subject:'Order',direction:'out'}]];
  if(sql.startsWith('UPDATE messages')){writes.push({sql,p});return [{affectedRows:1}];}
  throw Error('unrecognized SQL');
 }};
 const {backfillAliExpressPage}=await import('../src/brand-cleanup.js');
 const r=await backfillAliExpressPage({}, {db,enqueue:async()=>{throw Error('should not enqueue');}});
 assert.equal(r.updated,1);assert.deepEqual(writes[0].p,['a']);assert.match(writes[0].sql,/WHERE id IN/);
});
