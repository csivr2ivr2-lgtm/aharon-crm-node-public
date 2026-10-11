import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appHtml} from '../src/ui.js';
test('responsive CRM shell retains keyboard accessible navigation and safe chat layout',async()=>{
 const html=appHtml(),browser=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 assert.ok(html.includes('safe-area-inset-bottom'));
 assert.ok(html.includes('aria-label="ניווט ראשי"'));
 assert.ok(html.includes('assistant-workspace'));
 assert.ok(html.includes('conversation-layout'));
 assert.ok(browser.includes('function showSyncReport'));
 assert.ok(browser.includes('assistantMessage'));
 assert.ok(browser.includes("assistant-prompt"));
 assert.ok(browser.includes("inboxFilter"));
 assert.ok(browser.includes("'back-inbox'"));
 assert.ok(browser.includes('confirmed:true'));
});
