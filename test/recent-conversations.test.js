import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {listRecentConversations} from '../src/recent-conversations.js';

test('recent conversations query uses existing time index, not historical-priority scans',async()=>{
 const observed=[];
 const mock={execute:async(sql,params)=>{observed.push({sql,params});return [[{id:'wa-new',channel:'whatsapp',last_message_at:'2026-10-13T17:30:00Z'},{id:'mail-old',channel:'email',last_message_at:'2026-10-12T17:30:00Z'}]];}};
 const response=await listRecentConversations({limit:25},mock);
 assert.deepEqual(response.items.map(x=>x.id),['wa-new','mail-old']);
 assert.match(observed[0].sql,/ORDER BY last_message_at DESC,id DESC LIMIT \?/);
 assert.match(observed[0].sql,/@newsletter/);
 assert.doesNotMatch(observed[0].sql,/messages\s+m|JSON_CONTAINS|priority/i);
 assert.deepEqual(observed[0].params,[25]);
});
test('recent conversation request limit is capped and realtime WhatsApp arrivals refresh the list',async()=>{
 const observed=[];await listRecentConversations({limit:9999},{execute:async(_,params)=>{observed.push(params);return [[]];}});
 assert.deepEqual(observed[0],[50]);
 const ui=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 assert.match(ui,/recentConversationsPanel\(\)/);
 assert.match(ui,/\/api\/inbox\/recent/);
 assert.match(ui,/if\(event\.type==='message\.new'\)void refreshRecentConversations\(\)/);
});
