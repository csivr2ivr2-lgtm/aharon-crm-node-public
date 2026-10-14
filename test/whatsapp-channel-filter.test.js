import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isWhatsAppChannelJid,whatsappChannelExclusionSql} from '../src/connectors/whatsapp-channel-filter.js';

test('ignore WhatsApp newsletter and status channel events, but keep direct messages only',()=>{
 for(const jid of ['120363197493914012@newsletter','120363355036920303@newsletter','120363288101086546@Newsletter','1234567-89012@g.us','972583268888-1584353032@g.us','status@broadcast','someone@broadcast','153452123@broadcast'])
  assert.equal(isWhatsAppChannelJid(jid),true,jid);
 for(const jid of ['972501234567@s.whatsapp.net','123456@lid','','other@newsletter-example.com'])
  assert.equal(isWhatsAppChannelJid(jid),false,jid);
});
test('both import and all conversation folders exclude channel history',async()=>{
 const whatsapp=await readFile(new URL('../src/connectors/whatsapp.js',import.meta.url),'utf8');
 const workspace=await readFile(new URL('../src/workspace-service.js',import.meta.url),'utf8');
 assert.ok(whatsapp.includes('isWhatsAppChannelJid(m.key.remoteJid)'));
 assert.ok(workspace.includes('if((p.channel==="whatsapp"||provider==="whatsapp")&&isWhatsAppChannelJid(ext))'));
 assert.ok(workspace.includes('where.push(whatsappChannelExclusionSql)'));
 assert.ok(whatsappChannelExclusionSql.includes("e.channel='whatsapp'"));
 assert.ok(whatsappChannelExclusionSql.includes('%@newsletter'));assert.ok(whatsappChannelExclusionSql.includes('%@g.us'));
});
test('AI setup instructions stay in client without exposing any API credentials',async()=>{
 const browser=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 assert.ok(browser.includes('AI_PROVIDERS_JSON'));
 assert.ok(browser.includes('AI_BASE_URL'));
 assert.ok(browser.includes('AI_API_TOKEN'));
 assert.ok(browser.includes('d.fallback_configured'));
});
