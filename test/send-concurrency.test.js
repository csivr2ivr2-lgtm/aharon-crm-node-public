import test from 'node:test';
import assert from 'node:assert/strict';
import {sendConversationReply} from '../src/inbox.js';
import {validateTool} from '../src/ai/actions.js';

function fixture(){
 const sends=new Map();let status='draft',sendCount=0;
 const db={async execute(sql,p=[]){
  if(sql.startsWith('SELECT * FROM outgoing_sends'))return [[sends.get(p[0])].filter(Boolean)];
  if(sql.includes('FROM conversations'))return [[{id:'c',account_id:'a',external_id:'thread',channel:'email'}]];
  if(sql.includes('FROM accounts'))return [[{status:'active',integration_key:'google:g',identifier:'owner@example.org'}]];
  if(sql.includes('FROM messages'))return [[{sender:'client@example.org',subject:'Test'}]];
  if(sql.includes('FROM message_drafts'))return [status==='draft'?[{id:'draft'}]:[]];
  if(sql.startsWith('INSERT IGNORE INTO outgoing_sends')){
   if(sends.has(p[0]))return [{affectedRows:0}];
   sends.set(p[0],{conversation_id:p[1],request_hash:p[2],status:'sending'});return [{affectedRows:1}];
  }
  if(sql.startsWith("UPDATE message_drafts SET status='sending'")){
   if(status!=='draft')return [{affectedRows:0}];status='sending';return [{affectedRows:1}];
  }
  if(sql.startsWith("UPDATE message_drafts SET status='sent'")){status='sent';return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE message_drafts SET status='uncertain'")){status='uncertain';return [{affectedRows:1}];}
  if(sql.startsWith("UPDATE outgoing_sends SET status='sent'")){Object.assign(sends.get(p[2]),{status:'sent',result_json:p[0]});return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE outgoing_sends')){sends.get(p[1]).status=sql.includes("'uncertain'")?'uncertain':'rejected';return [{affectedRows:1}];}
  throw Error('Unexpected SQL: '+sql);
 }};
 const dependencies={db,ingest:async()=>({ok:true}),send:async()=>{sendCount++;await new Promise(r=>setImmediate(r));return {ok:true,message_id:'sent-1'};}};
 return {dependencies,count:()=>sendCount,status:()=>status};
}
const input={conversationId:'c',body:'hello',draftId:'draft',requestId:'request_00000000001'};
test('racing requests with different IDs reserve one draft and send once',async()=>{
 const f=fixture();const results=await Promise.allSettled([
  sendConversationReply(input,f.dependencies),
  sendConversationReply({...input,requestId:'request_00000000002'},f.dependencies)
 ]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(f.count(),1);assert.equal(f.status(),'sent');
 assert.match(results.find(r=>r.status==='rejected').reason.message,/draft_already_sending_or_used|invalid_draft/);
});
test('successful draft send replays after the draft becomes sent',async()=>{
 const f=fixture();const first=await sendConversationReply(input,f.dependencies);
 const replay=await sendConversationReply(input,f.dependencies);
 assert.deepEqual(replay,first);assert.equal(f.count(),1);
 await assert.rejects(sendConversationReply({...input,body:'different'},f.dependencies),/request_id_conflict/);
});
test('uncertain provider outcome prevents re-sending draft with a new ID',async()=>{
 const f=fixture();f.dependencies.send=async()=>{throw Error('provider_timeout');};
 await assert.rejects(sendConversationReply(input,f.dependencies),/provider_timeout/);
 assert.equal(f.status(),'uncertain');
 await assert.rejects(sendConversationReply({...input,requestId:'request_00000000003'},f.dependencies),/invalid_draft/);
});
test('AI schemas accept explicit client, system and source message relationships',()=>{
 const project=validateTool('create_project',{name:'אתר לדוד',client_id:'client_david'});
 assert.equal(project.args.client_id,'client_david');
 const task=validateTool('create_task',{title:'בדיקת מערכת',client_id:'client_david',system_id:'0771234567',source_message_id:'msg_1'});
 assert.equal(task.args.system_id,'0771234567');assert.equal(task.args.source_message_id,'msg_1');
 assert.throws(()=>validateTool('create_task',{title:'x',system_id:''}));
});


test('outbound-only WhatsApp conversation replies use its original account and no email subject',async()=>{
 const f=fixture(),base=f.dependencies.db.execute;let payload,ingested;
 f.dependencies.db.execute=async(sql,p)=>{
  if(sql.includes('FROM conversations'))return [[{id:'c',account_id:'a',external_id:'972501234567@s.whatsapp.net',channel:'whatsapp'}]];
  if(sql.includes('FROM accounts'))return [[{status:'active',integration_key:'whatsapp:wa_account_a',identifier:'owner'}]];
  if(sql.includes('FROM messages'))return [[]];
  return base(sql,p);
 };
 f.dependencies.send=async(channel,p)=>{payload=p;assert.equal(channel,'whatsapp');return {ok:true,message_id:'wa_sent'};};
 f.dependencies.ingest=async event=>{ingested=event;};
 assert.equal((await sendConversationReply({...input,draftId:''},f.dependencies)).ok,true);
 assert.equal(payload.account_id,'wa_account_a');assert.equal(payload.to,'972501234567@s.whatsapp.net');assert.equal('subject' in payload,false);
 assert.equal(ingested.account_id,'wa_account_a');assert.equal(ingested.external_id,'wa_sent');assert.equal(ingested.direction,'out');
});
test('email reply without an incoming message stays blocked before any provider call',async()=>{
 const f=fixture(),base=f.dependencies.db.execute;
 f.dependencies.db.execute=async(sql,p)=>sql.includes('FROM messages')?[[]]:base(sql,p);
 await assert.rejects(sendConversationReply(input,f.dependencies),/conversation_has_no_incoming_message/);assert.equal(f.count(),0);
});
test('provider confirmation without message id is uncertain and cannot replay',async()=>{
 const f=fixture();let calls=0;f.dependencies.send=async()=>{calls++;return {ok:true};};
 await assert.rejects(sendConversationReply(input,f.dependencies),/send_not_confirmed/);
 await assert.rejects(sendConversationReply(input,f.dependencies),/pending_or_uncertain/);
 assert.equal(calls,1);assert.equal(f.status(),'uncertain');
});

test('inactive or unidentified sender accounts cannot send a reply',async()=>{
 for(const account of [{status:'disabled',integration_key:'google:g'},{status:'active',integration_key:'google:'}]){
  const f=fixture(),base=f.dependencies.db.execute;
  f.dependencies.db.execute=async(sql,p)=>sql.includes('FROM accounts')?[[account]]:base(sql,p);
  await assert.rejects(sendConversationReply(input,f.dependencies),/account_not_active|account_identity_missing/);assert.equal(f.count(),0);
 }
});
