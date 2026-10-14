import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('inbox WebSocket updates refresh safely without destroying edits or older pages',async()=>{
 const source=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 assert.match(source,/function scheduleRealtimeInboxRefresh\(event\)/);
 for(const event of ['message.new','message.sent','ai.inbox','external.event'])assert.ok(source.includes("'"+event+"'"));
 assert.ok(source.includes('!form.contains(document.activeElement)'));
 assert.ok(source.includes('workPending.size===0'));
 assert.ok(source.includes('inboxItems.length<=50'));
 assert.ok(source.includes('lastInboxAutoRefresh'));
 assert.match(source,/if\(scheduleRealtimeInboxRefresh\(event\)\)return/);
});
