import test from 'node:test';
import assert from 'node:assert/strict';
import {WhatsAppConnector} from '../src/connectors/whatsapp.js';
import {isWhatsAppConversationJid,isWhatsAppChannelJid,whatsappChannelExclusion} from '../src/connectors/whatsapp-channel-filter.js';
import {migrateWhatsAppHistory,discoverWhatsAppChat,recordWhatsAppHistoryBatch,listWhatsAppHistory,whatsappHistoryCandidates} from '../src/whatsapp-history.js';

const inbound=(id,jid,text)=>({key:{id,remoteJid:jid,fromMe:false},message:{conversation:text},messageTimestamp:1791972000});
const outbound=(id,jid,text)=>({key:{id,remoteJid:jid,fromMe:true},message:{conversation:text},messageTimestamp:1791972010});

test('phone history enumerates direct chats then ingests every incoming and outgoing message exactly once',async()=>{
 const sock={signalRepository:{lidMapping:{getPNForLID:async lid=>lid==='123456789012345@lid'?'972501234567@s.whatsapp.net':null}}};
 const c=new WhatsAppConnector({sessionId:'whatsapp-main'}),seen=new Set(),events=[];
 c.sock=sock;c.statusValue='connected';
 c.onEvent=async event=>{
  events.push(event);
  if(event.type==='message'){
   const key=event.account_id+':'+event.external_id;
   const inserted=!seen.has(key);seen.add(key);return {inserted};
  }
  return {ok:true};
 };
 const jid='123456789012345@lid';
 const history={chats:[{id:jid,name:''},{id:'120363204708382556@g.us'}],
  contacts:[{id:jid,phoneNumber:'972501234567@s.whatsapp.net',name:'משתמש בדיקה'}],
  messages:[inbound('in1',jid,'פנייה'),outbound('out1',jid,'תשובה'),
   inbound('in1',jid,'פנייה'),inbound('group','120363204708382556@g.us','קבוצה')],
  syncType:1};
 await c.queueHistory(sock,history);
 const messages=events.filter(x=>x.type==='message');
 assert.equal(messages.length,3);
 assert.ok(messages.some(x=>x.direction==='out'&&x.body==='תשובה'));
 assert.ok(messages.every(x=>x.conversation_external_id===jid));
 assert.ok(messages.every(x=>x.conversation_title==='משתמש בדיקה'));
 const batches=events.filter(x=>x.type==='whatsapp.history.batch');
 assert.equal(batches.length,1);
 assert.equal(batches[0].imported,2);
 assert.equal(batches[0].duplicates,1);
 assert.equal(batches[0].failed,0);
 assert.equal(events.filter(x=>x.type==='whatsapp.history.chat').length>=1,true);
 assert.equal(c.historyStats.imported,2);
});
test('history can be chunked and retried without claiming all data is complete',async()=>{
 const jid='972501234567@s.whatsapp.net';
 const c=new WhatsAppConnector({sessionId:'whatsapp-main'}),sock={},seen=new Set(),batches=[];
 c.sock=sock;c.statusValue='connected';
 c.onEvent=async e=>{
  if(e.type==='whatsapp.history.batch')batches.push(e);
  if(e.type==='message'){const exists=seen.has(e.external_id);seen.add(e.external_id);return {inserted:!exists};}
  return {ok:true};
 };
 const msgs=Array.from({length:205},(_,i)=>inbound('key-'+i,jid,'Hello '+i));
 await c.queueHistory(sock,{chats:[{id:jid}],messages:msgs});
 assert.equal(batches.length,3);
 assert.equal(batches.reduce((n,x)=>n+x.imported,0),205);
 await c.queueHistory(sock,{chats:[{id:jid}],messages:msgs.slice(0,3)});
 assert.equal(batches.at(-1).duplicates,3);
 assert.equal(c.historyStats.imported,205);
});
test('on-demand request returns request status but never asserts old messages were delivered',async()=>{
 const requested=[],sock={fetchMessageHistory:async(...args)=>{requested.push(args);return 'request-session-id';}};
 const c=new WhatsAppConnector({sessionId:'whatsapp-main'});c.sock=sock;c.statusValue='connected';
 const result=await c.requestHistory([{jid:'972501234567@s.whatsapp.net',key:{id:'oldest',remoteJid:'972501234567@s.whatsapp.net',fromMe:true},timestamp:1791972000000}]);
 assert.equal(result.requested,1);assert.equal(requested[0][0],100);
 assert.match(result.note,/may not/);
});
test('non-person chat identifiers never enter the history queue',()=>{
 for(const id of ['972583268888-1584353032@g.us','status@broadcast','120363287988@newsletter']){
  assert.equal(isWhatsAppConversationJid(id),false);assert.equal(isWhatsAppChannelJid(id),true);
 }
 assert.match(whatsappChannelExclusion('c'),/%@g.us/);
});
test('database stores per-chat discovery and unique import statistics without a completed flag',async()=>{
 const queries=[],database={
  query:async s=>{queries.push(s);return [[]]},
  execute:async(s,args=[])=>{queries.push(s);if(s.startsWith('SELECT jid,first_seen'))return [[]];if(s.startsWith('SELECT COUNT'))return [[{chats:1,imported:2,duplicates:1,failed:0}]];return [{affectedRows:1}]}
 };
 await migrateWhatsAppHistory(database);
 await discoverWhatsAppChat({account_id:'whatsapp-main',jid:'123456789012345@lid'},database);
 await recordWhatsAppHistoryBatch({account_id:'whatsapp-main',jid:'123456789012345@lid',imported:2,duplicates:1},database);
 const status=await listWhatsAppHistory({account_id:'whatsapp-main'},database);
 assert.equal(status.coverage,'partial_unverified');
 assert.ok(queries.some(x=>x.includes('messages_imported=messages_imported+VALUES(messages_imported)')));
 await assert.rejects(discoverWhatsAppChat({account_id:'wrong',jid:'123456789012345@lid'},database),/invalid_whatsapp_session/);
 await assert.rejects(discoverWhatsAppChat({account_id:'whatsapp-main',jid:'120363204708382556@g.us'},database),/invalid_whatsapp_history_jid/);
});
test('on-demand candidate list never confuses groups with direct personal chats',async()=>{
 const database={execute:async(s)=>{
  if(s.includes('FROM accounts'))return [[{id:'a'}]];
  if(s.includes('FROM conversations'))return [[{external_id:'120363204708382556@g.us',id:'group'},{external_id:'123456789012345@lid',id:'direct'}]];
  if(s.includes('FROM whatsapp_history_chats'))return [[]];
  if(s.includes('FROM messages'))return [[{external_id:'wa-msg',sent_at:'2026-10-12T09:00:00Z',direction:'out'}]];
  throw Error(s);
 }};
 const candidates=await whatsappHistoryCandidates({},database);
 assert.equal(candidates.length,1);
 assert.equal(candidates[0].jid,'123456789012345@lid');
 assert.equal(candidates[0].key.fromMe,true);
});

test('transient storage error is retried and does not abort other historical messages',async()=>{
 const jid='972501234567@s.whatsapp.net',sock={},c=new WhatsAppConnector({sessionId:'whatsapp-main'});
 c.sock=sock;c.statusValue='connected';
 let attempts=0;const seen=[];
 c.onEvent=async event=>{
  if(event.type==='message'){
   if(event.external_id==='one'&&++attempts<3)throw Error('temporary database outage');
   seen.push(event.external_id);return {inserted:true};
  }
  return {ok:true};
 };
 await c.queueHistory(sock,{chats:[{id:jid}],messages:[
  inbound('one',jid,'first'),outbound('two',jid,'second')
 ]});
 assert.deepEqual(seen,['one','two']);
 assert.equal(attempts,3);
 assert.equal(c.historyStats.imported,2);
 assert.equal(c.historyStats.failed,0);
});
