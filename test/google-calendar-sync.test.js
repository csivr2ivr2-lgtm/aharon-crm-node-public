import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarSyncPage,persistCalendarPage} from '../src/google-calendar-sync.js';
test('Calendar pins token across pages and preserves source time zones and recurrence',async()=>{
 const requests=[];
 const api={events:{list:async p=>{requests.push(p);return {data:p.pageToken?{items:[],nextSyncToken:'next'}:{items:[{id:'e',start:{dateTime:'2026-10-20T10:00:00+03:00',timeZone:'Asia/Jerusalem'},recurrence:['RRULE:FREQ=WEEKLY']}],nextPageToken:'p2'}};}}};
 const a=await calendarSyncPage(api,{mode:'delta',sync:'original',page:'',generation:'g'});
 const b=await calendarSyncPage(api,a.nextState);
 assert.equal(requests[1].syncToken,'original');
 assert.equal(requests[0].singleEvents,false);
 assert.equal(a.items[0].start.timeZone,'Asia/Jerusalem');
 assert.deepEqual(a.items[0].recurrence,['RRULE:FREQ=WEEKLY']);
 assert.equal(b.nextState.sync,'next');assert.equal(b.nextState.generation,'g');
});
test('Calendar 410 starts a new generation; transient errors never supply checkpoints',async()=>{
 const a=await calendarSyncPage({events:{list:async p=>{if(p.syncToken)throw {code:410};return {data:{items:[],nextSyncToken:'fresh'}};}}},{mode:'delta',sync:'old',generation:'old-generation'});
 assert.equal(a.recovered,true);assert.notEqual(a.nextState.generation,'old-generation');
 await assert.rejects(calendarSyncPage({events:{list:async()=>{throw Error('rate_limited');}}}),/rate_limited/);
 await assert.rejects(calendarSyncPage({events:{list:async()=>({data:{items:[]}})}}),/calendar_sync_token_missing/);
});
test('Calendar page and checkpoint roll back together on persistence failure or race',async()=>{
 for(const conflict of [true,false]){
  const calls=[];
  const db={getConnection:async()=>({beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release'),execute:async(sql)=>{
   if(sql.startsWith('SELECT revision'))return [[{revision:conflict?1:0}]];
   if(sql.includes('INSERT INTO google_calendar_events'))throw Error('write_failed');
   calls.push(sql);return [];
  }})};
  await assert.rejects(persistCalendarPage({db,syncId:'s',account_id:'a',revision:0,page:{items:[{id:'e'}],nextState:{generation:'g'}}}),conflict?/calendar_checkpoint_conflict/:/write_failed/);
  assert.ok(calls.includes('rollback'));assert.ok(!calls.includes('commit'));
  assert.ok(!calls.some(x=>x.startsWith('UPDATE google_calendar_sync')));
 }
});
