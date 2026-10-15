import test from 'node:test';
import assert from 'node:assert/strict';
import {safeWhatsAppName} from '../src/connectors/whatsapp-identity.js';
import {saveWhatsAppProfile,resolveWhatsAppDisplay,enrichWhatsAppInboxItems} from '../src/whatsapp-profiles.js';
import {WhatsAppConnector} from '../src/connectors/whatsapp.js';

test('unresolved LID status cannot be accidentally saved as a human contact name',()=>{
 assert.equal(safeWhatsAppName('מספר WhatsApp לא זמין'),'');
 assert.equal(safeWhatsAppName('איש קשר WhatsApp (מזהה פרטי · 1468)'),'');
 assert.equal(safeWhatsAppName('מספר 0501234567'),'מספר 0501234567');
});
test('persisted verified mapping resolves a historical LID without rewriting sender identity',async()=>{
 const db={execute:async(sql,params)=>{
  if(sql.startsWith('SELECT display_name,phone_jid FROM whatsapp_peer_profiles'))
   return [[{display_name:'לקוח',phone_jid:'972537291432@s.whatsapp.net'}]];
  throw Error('unexpected query: '+sql);
 }};
 const out=await resolveWhatsAppDisplay({account_id:'whatsapp-main',jid:'126509016678653@lid'},db);
 assert.equal(out.phone_jid,'972537291432@s.whatsapp.net');
 assert.equal(out.title,'לקוח · 972537291432');
 assert.equal(await resolveWhatsAppDisplay({account_id:'whatsapp-main',jid:'120363204708382556@g.us'},db),null);
});
test('batch inbox rendering enriches only correct account and old automatic titles',async()=>{
 let calls=0;
 const db={execute:async(sql,params)=>{
  if(!sql.startsWith('SELECT jid,display_name,phone_jid'))throw Error('unexpected query');
  calls++;
  assert.equal(params[0],'whatsapp:whatsapp-main');
  return [[{jid:'126509016678653@lid',display_name:'שרה',phone_jid:'972501234567@s.whatsapp.net'}]];
 }};
 const items=[
  {channel:'whatsapp',integration_key:'whatsapp:whatsapp-main',conversation_external_id:'126509016678653@lid',title:'מספר WhatsApp לא זמין',sender:'126509016678653@lid',client_id:''},
  {channel:'whatsapp',integration_key:'whatsapp:wa_0123456789abcdef',conversation_external_id:'126509016678653@lid',title:'מספר WhatsApp לא זמין',sender:'126509016678653@lid',client_id:''},
  {channel:'email',integration_key:'google:x',conversation_external_id:'126509016678653@lid',title:'Mail',sender:'mail@example.com'}
 ];
 // Extra account query returns no mapping to prove multi-account isolation.
 db.execute=async(sql,params)=>{calls++;return [params[0]==='whatsapp:whatsapp-main'?
   [{jid:'126509016678653@lid',display_name:'שרה',phone_jid:'972501234567@s.whatsapp.net'}]:[]]};
 await enrichWhatsAppInboxItems(items,db);
 assert.equal(items[0].title,'שרה · 972501234567');
 assert.equal(items[0].sender,'972501234567@s.whatsapp.net');
 assert.equal(items[1].title,'מספר WhatsApp לא זמין');
 assert.equal(items[2].title,'Mail');
 assert.equal(calls,2);
});
test('mapping event stores legitimate verified PN, not mismatched or group JIDs',async()=>{
 const events=[],c=new WhatsAppConnector({sessionId:'whatsapp-main'}),sock={};
 c.sock=sock;c.onEvent=async e=>events.push(e);
 await c.consumeLidMappings(sock,[
  {lid:'126509016678653@lid',pn:'972537291432@s.whatsapp.net'},
  {lid:'120363204708382556@g.us',pn:'972501111111@s.whatsapp.net'},
  {lid:'123456789012345@lid',pn:'191371495391468@lid'}
 ]);
 assert.equal(events.length,1);
 assert.equal(events[0].jid,'126509016678653@lid');
 assert.equal(events[0].phone_jid,'972537291432@s.whatsapp.net');
});
test('conflicting verified PN is never overwritten by a later contradicting mapping',async()=>{
 const calls=[],db={execute:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.startsWith('SELECT display_name,phone_jid'))return [[{display_name:'מקורי',phone_jid:'972537291432@s.whatsapp.net'}]];
  if(sql.startsWith('SELECT id FROM accounts'))return [[]];
  return [{affectedRows:1}];
 }};
 await saveWhatsAppProfile({account_id:'whatsapp-main',jid:'126509016678653@lid',
  name:'חדש',phone_jid:'972501111111@s.whatsapp.net'},db);
 const update=calls.find(x=>x.sql.startsWith('INSERT INTO whatsapp_peer_profiles'));
 assert.match(update.sql,/phone_jid=IF\(phone_jid=''/);
 assert.match(update.sql,/display_name=IF\(phone_jid<>''/);
 assert.equal(update.args[4],'972501111111@s.whatsapp.net');
});

test('on-demand identity refresh recovers only known LID mappings without messaging peers',async()=>{
 const calls=[],seen=[];
 const sock={signalRepository:{lidMapping:{getPNForLID:async lid=>{
  calls.push(lid);return lid==='126509016678653@lid'?'972501234567@s.whatsapp.net':null;
 }}}};
 const c=new WhatsAppConnector({sessionId:'whatsapp-main'});
 c.sock=sock;c.statusValue='connected';c.onEvent=async e=>{seen.push(e);return {ok:true}};
 const result=await c.refreshPhoneMappings(['126509016678653@lid','123456789012345@lid',
  '120363204708382556@g.us']);
 assert.equal(result.examined,2);
 assert.equal(result.resolved,1);
 assert.equal(result.unresolved,1);
 assert.equal(seen.length,1);
 assert.equal(seen[0].phone_jid,'972501234567@s.whatsapp.net');
 assert.equal(typeof sock.sendMessage,'undefined');
 assert.equal(c.peerPhones.get('126509016678653@lid'),'972501234567@s.whatsapp.net');
});
