import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {waitingSummaryRequest,waitingNeedsSummary,waitingRequestLimit,extractWaitingItems,waitingExcerpt} from '../src/ai/assistant-intents.js';
import {selectWaitingCustomerRows} from '../src/ai/waiting-customer-rows.js';

test('Hebrew who-needs-my-reply variants route to CRM instead of a speculative AI answer',()=>{
 for(const m of [
  'מי מהלקוחות מחכה לתשובה ממני?',
  'מי מהלקוחות מחכה לתשובה ממני',
  'מי מהלקוחות ממתין למענה שלי?',
  'למי אני צריך לענות?',
  'מצא את חמש השיחות האחרונות שממתינות לתשובה שלי. סכם מה כל לקוח מבקש.',
  'אילו פניות מחכות למענה ממני?',
  'למי עוד לא עניתי?',
  'מי מחכה לתגובה ממני?'
 ])assert.equal(waitingSummaryRequest(m),true,m);
 for(const m of ['מי הלקוחות שלי?', 'מי הלקוח האחרון?', 'האם אני מחכה לתשובה מהם?', 'מה שלחתי ללקוחות?'])
  assert.equal(waitingSummaryRequest(m),false,m);
 assert.equal(waitingNeedsSummary('מי מהלקוחות מחכה לתשובה ממני?'),false);
 assert.equal(waitingNeedsSummary('סכם מה כל לקוח מבקש'),true);
 assert.equal(waitingRequestLimit('מי מהלקוחות מחכה לתשובה ממני?'),10);
 assert.equal(waitingRequestLimit('מצא את חמש השיחות הממתינות'),5);
});

test('unlinked customer conversation displays real sender instead of requiring client id',()=>{
 const item={sender:'request@example.test',channel:'email',title:'הצעת מחיר',latest_inbound_body:'אני צריך עשרה מספרים לקבלת SMS',waiting_since:'2026-10-11T12:00:00'};
 const rows=extractWaitingItems({ok:true,status:'completed',result:{ok:true,items:[item]}},10);
 assert.equal(rows[0].contact_name,'request@example.test');
 assert.match(waitingExcerpt(rows),/request@example\.test/);
 assert.match(waitingExcerpt(rows),/עשרה מספרים/);
 assert.doesNotMatch(waitingExcerpt(rows),/מזהי לקוחות/);
 assert.throws(()=>extractWaitingItems({ok:false,status:'failed',result:{items:[]}}),/assistant_read_unavailable/);
});

test('high-confidence historic automated notices do not take customer slots',()=>{
 const rows=[
  {sender:'notifications@example.com',subject:'Welcome to Supabase',classification:'normal',title:'Welcome to Supabase'},
  {sender:'linkedin@example.com',subject:'8 עדכונים: על Rishika ואחרים',title:'עדכונים'},
  {sender:'robot@example.com',subject:'Your temporary ChatGPT login code'},
  {sender:'no-reply@service.com',subject:'Weekly update'},
  {sender:'client1@example.com',subject:'בקשה למספר SMS',title:'בקשה 1'},
  {sender:'client2@example.com',subject:'שאלה לגבי שירות',title:'שאלה 2'},
  {sender:'no-reply@service.com',subject:'הצעת מחיר',classification_reason:'סיווג ידני של המשתמש'}
 ];
 const found=selectWaitingCustomerRows(rows,10);
 assert.deepEqual(found.map(x=>x.sender),['client1@example.com','client2@example.com','no-reply@service.com']);
 assert.equal(selectWaitingCustomerRows(rows,1).length,1);
});

test('server query fetches historical candidate window, sender and optional client name',async()=>{
 const actions=await readFile(new URL('../src/ai/actions.js',import.meta.url),'utf8');
 const assistant=await readFile(new URL('../src/ai/assistant.js',import.meta.url),'utf8');
 assert.ok(actions.includes('AS contact_name,m.sender,m.subject'));
 assert.ok(actions.includes('selectWaitingCustomerRows(candidates,requested)'));
 assert.ok(actions.includes("m.direction='in'"));
 assert.ok(actions.includes('ORDER BY m.sent_at DESC,m.id DESC'));
 assert.ok(assistant.includes("if(!rows.length||!waitingNeedsSummary(message))"));
 assert.ok(assistant.includes('const listing=await this.engine.execute('));
});


test('real assistant responds to "מי מהלקוחות מחכה לתשובה ממני?" from CRM, no AI provider used',async()=>{
 const vm=await import('node:vm');
 const {createHash,randomUUID}=await import('node:crypto');
 const intents=await import('../src/ai/assistant-intents.js');
 const source=await readFile(new URL('../src/ai/assistant.js',import.meta.url),'utf8');
 const isolated=source.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=(?:function|class|const))/g,'');
 const sandbox={createHash,randomUUID,actionEngine:{},toolDefinitions:()=>[],selectToolCatalog:()=>[],...intents};
 vm.runInNewContext(isolated+'\nthis.TestAssistant=Assistant;',sandbox);
 const calls=[];
 const assistant=new sandbox.TestAssistant({
  engine:{execute:async(name,args)=>{
   calls.push([name,args]);
   return {ok:true,status:'completed',result:{ok:true,items:[
    {sender:'prospect@example.com',contact_name:'prospect@example.com',channel:'email',latest_inbound_body:'מעוניין בעשרה מספרים לקבלת SMS'}
   ]}};
  }},
  settings:async()=>({ai:{contextSize:18000}}),
  generate:async()=>{throw Error('An LLM must not be called for a simple who-is-waiting query');}
 });
 const result=await assistant.chat({
  message:'מי מהלקוחות מחכה לתשובה ממני?',
  context:{actor:'dashboard',source:'chat',trustedInput:true,permissions:['read']}
 });
 assert.equal(calls.length,1);
 assert.equal(calls[0][0],'waiting_for_reply');
 assert.equal(calls[0][1].limit,10);
 assert.equal(result.model,'verified_crm');
 assert.match(result.reply,/prospect@example\.com/);
 assert.match(result.reply,/עשרה מספרים/);
 assert.deepEqual(result.actions,[]);
});
