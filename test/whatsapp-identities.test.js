import test from 'node:test';
import assert from 'node:assert/strict';
import {isPhoneJid,isLidJid,isGroupJid,safeWhatsAppPn,whatsappPeerTitle} from '../src/connectors/whatsapp-identity.js';
import {isWhatsAppConversationJid,isWhatsAppChannelJid,whatsappChannelExclusion} from '../src/connectors/whatsapp-channel-filter.js';
import {WhatsAppConnector} from '../src/connectors/whatsapp.js';
const msg=(id,jid,participant)=>({key:{id,remoteJid:jid,...(participant?{participant}:{} )},message:{conversation:'בדיקה'},messageTimestamp:1791972000});
test('LID and group IDs are not phone numbers and broadcast is blocked',()=>{
 assert.equal(isPhoneJid('972554409165@s.whatsapp.net'),true);
 for(const jid of ['126509016678653@lid','972583268888-1584353032@g.us'])assert.equal(isPhoneJid(jid),false);
 assert.equal(isLidJid('126509016678653@lid'),true);
 assert.equal(isGroupJid('972583268888-1584353032@g.us'),true);
 assert.equal(safeWhatsAppPn('972554409165:2@s.whatsapp.net'),'972554409165@s.whatsapp.net');
 assert.equal(safeWhatsAppPn('126509016678653@lid'),'');
 assert.match(whatsappPeerTitle({jid:'126509016678653@lid'}),/מזהה פרטי/);
 assert.match(whatsappPeerTitle({jid:'972583268888-1584353032@g.us'}),/קבוצת WhatsApp/);
 assert.equal(whatsappPeerTitle({jid:'126509016678653@lid',phoneJid:'972554409165@s.whatsapp.net'}),'972554409165');
 assert.equal(isWhatsAppConversationJid('126509016678653@lid'),true);
 assert.equal(isWhatsAppConversationJid('972583268888-1584353032@g.us'),false);
 for(const jid of ['status@broadcast','153452123@broadcast','12345@newsletter']){assert.equal(isWhatsAppChannelJid(jid),true);assert.equal(isWhatsAppConversationJid(jid),false);}
 assert.match(whatsappChannelExclusion('c'),/%@broadcast/);
});
test('contacts and LID mapping resolve displayed peer but preserve conversation key',async()=>{
 const c=new WhatsAppConnector({sessionId:'whatsapp-main'}),events=[],sock={};
 c.sock=sock;c.statusValue='connected';c.onEvent=async e=>events.push(e);
 await c.consumeContacts(sock,[{id:'126509016678653@lid',phoneNumber:'972537291432@s.whatsapp.net',name:'לקוח לדוגמה'}]);
 await c.receiveMessages(sock,{type:'notify',messages:[msg('1','126509016678653@lid')]});
 const m=events.find(x=>x.type==='message');
 assert.equal(m.conversation_external_id,'126509016678653@lid');
 assert.equal(m.conversation_title,'לקוח לדוגמה');
 assert.equal(m.sender,'972537291432@s.whatsapp.net');
});
test('group, channel, and broadcast message content is excluded from CRM',async()=>{
 const c=new WhatsAppConnector({sessionId:'whatsapp-main'}),events=[],sock={groupMetadata:async()=>({subject:'קבוצת תמיכה'})};
 c.sock=sock;c.statusValue='connected';c.onEvent=async e=>events.push(e);
 await c.receiveMessages(sock,{type:'notify',messages:[
  msg('g','120363204708382556@g.us','972501234567@s.whatsapp.net'),
  msg('b','status@broadcast'),
  msg('n','123456789@newsletter')
 ]});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(events.filter(x=>x.type==='message').length,0);
});
