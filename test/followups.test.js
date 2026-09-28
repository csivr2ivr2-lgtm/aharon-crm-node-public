import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getFollowupCandidates,processFollowups,scheduleFollowup} from '../src/followups.js';
const clock=()=>new Date('2026-09-28T12:00:00Z');
const settings={automation:{followups:'automatic'},followups:{waitingHours:48,overdueHours:24,mode:'draft_follow_up'}};
const task={id:'t1',title:'Call customer',status:'open',due_date:'2026-09-25',client_id:'client1',project_id:'p1'};
const inbound={id:'in1',conversation_id:'c1',title:'Need help',direction:'in',sent_at:'2026-09-25T10:00:00Z',project_id:'',client_id:'client1'};
const outbound={id:'out1',conversation_id:'c2',title:'Quote sent',direction:'out',sent_at:'2026-09-24T10:00:00Z'};
function fixture({tasks=[task],messages=[inbound,outbound],handled=[]}={}){
 const calls=[],reminders=new Map(),created=[];
 const db={execute:async(sql,params)=>{calls.push({sql,params});if(sql.includes(' FROM tasks t'))return [tasks];if(sql.includes(' FROM messages m'))return [messages];if(sql.startsWith('SELECT source_key FROM reminders'))return [[...handled,...[...reminders.keys()].map(key=>createHash('sha256').update(key).digest('hex'))].map(source_key=>({source_key}))];throw Error(sql);}};
 const crm={createReminder:async(input,options)=>{created.push({input,options});if(reminders.has(input.source_key))return {ok:true,id:reminders.get(input.source_key),duplicate:true};const id='r'+reminders.size;reminders.set(input.source_key,id);return {ok:true,id};}};
 return {db,crm,calls,created,settings,clock};
}
test('detects all three followup kinds; queries exclude spam, superseded messages and inactive projects',async()=>{
 const f=fixture(),result=await getFollowupCandidates(f);assert.deepEqual(new Set(result.items.map(x=>x.kind)),new Set(['overdue_task','waiting_reply','waiting_customer']));
 const messageSQL=f.calls.find(x=>x.sql.includes(' FROM messages m')).sql;
 assert.match(messageSQL,/NULLIF\(c.project_id,''\) IS NULL/);assert.match(messageSQL,/newer.id>m.id/);assert.match(messageSQL,/classification.*spam/);assert.match(messageSQL,/archived_at IS NULL/);
 const taskItem=result.items.find(x=>x.kind==='overdue_task');assert.equal(taskItem.project_id,'p1');assert.equal(taskItem.task_id,'t1');
});
test('waiting threshold is precise and date-only tasks are not late during their due day',async()=>{
 const f=fixture({tasks:[{...task,due_date:'2026-09-28'}],messages:[{...inbound,sent_at:'2026-09-26T12:00:00.001Z'},outbound]});f.settings={...settings,followups:{...settings.followups,overdueHours:0}};
 const {items}=await getFollowupCandidates(f);assert.deepEqual(items.map(x=>x.kind),['waiting_customer']);
 assert.equal(f.calls[0].params[0],'2026-09-28T12:00:00.000Z');
});
test('suggest/off modes cause no SQL writes, no automatic reminders, but candidates remain visible',async()=>{
 for(const mode of ['suggest','off']){const f=fixture();f.settings={...settings,automation:{followups:mode}};const r=await processFollowups(f);assert.equal(r.created,0);assert.equal(f.calls.length,0);assert.equal((await getFollowupCandidates(f)).items.length,3);assert.equal(f.created.length,0);}
});
test('automatic schedules local reminders/drafts once with linked entities and stale-message metadata',async()=>{
 const f=fixture();assert.equal((await processFollowups(f)).created,3);assert.equal((await processFollowups(f)).created,0);
 const overdue=f.created.find(x=>x.input.task_id);assert.equal(overdue.input.mode,'remind');assert.equal(overdue.input.client_id,'client1');
 const outgoing=f.created.find(x=>x.input.conversation_id==='c2');assert.equal(outgoing.input.mode,'draft_follow_up');assert.equal(JSON.parse(outgoing.input.notes).followup.messageId,'out1');
 assert.ok(f.created.every(x=>x.options.source==='automation'));
 // Already-handled exclusion belongs before LIMIT to prevent starving later candidates.
 assert.ok(f.calls.filter(x=>x.sql.includes(' FROM messages m')).every(x=>x.sql.indexOf('handled.source_key')<x.sql.indexOf('LIMIT')));
});
test('manual followup rederives server data, rejects stale IDs, validates mode and deduplicates',async()=>{
 const f=fixture(),{items}=await getFollowupCandidates(f),item=items.find(x=>x.kind==='waiting_customer');
 await assert.rejects(scheduleFollowup('forged',{mode:'remind'},f),/followup_not_found_or_stale/);
 await assert.rejects(scheduleFollowup(item.id,{mode:'auto_send'},f),/invalid_followup_mode/);
 const first=await scheduleFollowup(item.id,{mode:'remind'},f),second=await scheduleFollowup(item.id,{mode:'remind'},f);assert.equal(first.id,second.id);assert.equal(second.duplicate,true);assert.equal(f.created[0].options.source,'manual');
 const changed=fixture({messages:[{...outbound,id:'new-reply',direction:'in',sent_at:'2026-09-28T11:00:00Z'}]});await assert.rejects(scheduleFollowup(item.id,{},changed),/followup_not_found_or_stale/);
});
test('source keys change with rescheduled task or new latest message, not wall clock',async()=>{
 const f=fixture(),first=(await getFollowupCandidates(f)).items;
 const later=(await getFollowupCandidates({...f,clock:()=>new Date('2026-09-29T12:00:00Z')})).items;assert.deepEqual(first.map(x=>x.id),later.map(x=>x.id));
 const changed=fixture({tasks:[{...task,due_date:'2026-09-24'}],messages:[{...inbound,id:'in2'}]});const second=(await getFollowupCandidates(changed)).items;
 assert.ok(second.every(x=>!first.some(old=>old.id===x.id)));
});
