import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Assistant} from '../src/ai/assistant.js';
import {explicitTaskRequest,explicitMutationRequest,waitingSummaryRequest,extractWaitingItems} from '../src/ai/assistant-intents.js';
import {needsConfirmation} from '../src/ai/actions.js';
import {parseAiProviders,callExternalAi} from '../src/ai/external-router.js';

const context={actor:'dashboard',source:'chat',trustedInput:true,permissions:['read','write','send']};
const settings=async()=>({ai:{contextSize:18000}});
test('explicit quoted task is persisted as a pending ActionEngine operation, never only text',async()=>{
 const calls=[];
 const assistant=new Assistant({
  engine:{execute:async(name,args,ctx,opts)=>{calls.push({name,args,ctx,opts});return {ok:true,id:'act_verified',status:'pending',tool:name,args,confirmation_token:'TEST_TOKEN'};}},
  generate:async()=>{throw Error('LLM must not be used for explicit action');},
  settings
 });
 const result=await assistant.chat({message:'צור משימת בדיקה בשם "בדיקת AI" בעדיפות נמוכה. הצג לי אותה לאישור לפני שמירה.',context});
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,'create_task');
 assert.deepEqual(calls[0].args,{title:'בדיקת AI',priority:'low'});
 assert.equal(result.actions[0].status,'pending');
 assert.ok(result.actions[0].confirmation_token);
 assert.match(result.reply,/עדיין לא נוצרה/);
});
test('task creations always need user confirmation regardless of confirm_sensitive',()=>{
 assert.equal(needsConfirmation({name:'create_task',permission:'write'},{source:'chat',trustedInput:true},{messaging:{policy:'confirm_sensitive'}}),true);
});
test('no model text may masquerade as a successful mutation without a server-side action',async()=>{
 const assistant=new Assistant({engine:{execute:async()=>{throw Error('should not execute')}},settings,
  generate:async()=>({text:JSON.stringify({reply:'יצרתי את הלקוח בהצלחה',tool_calls:[]}),provider:'test',model:'test'})});
 const result=await assistant.chat({message:'צור לקוח חדש בשם "דוגמה"',context});
 assert.deepEqual(result.actions,[]);
 assert.match(result.reply,/לא נוצרה/);
 assert.doesNotMatch(result.reply,/יצרתי את הלקוח/);
});
test('waiting-summary request reads latest CRM messages and only sends those records to AI',async()=>{
 const calls=[];let prompt='';
 const assistant=new Assistant({
  engine:{execute:async(name,args)=>{calls.push({name,args});return {ok:true,status:'completed',result:{ok:true,items:[
   {title:'הצעת מחיר',channel:'email',waiting_since:'2026-10-11',latest_inbound_body:'אני צריך עשרה מספרים לקבלת SMS'}
  ]}}}},
  settings,
  generate:async messages=>{prompt=JSON.stringify(messages);return {text:'הלקוח ביקש הצעת מחיר לעשרה מספרי SMS.',provider:'test',model:'test'};}
 });
 const result=await assistant.chat({message:'מצא את חמש השיחות האחרונות שממתינות לתשובה שלי. סכם מה כל לקוח מבקש.',context});
 assert.deepEqual(calls,[{name:'waiting_for_reply',args:{limit:5}}]);
 assert.match(prompt,/עשרה מספרים/);
 assert.match(result.reply,/עשרה מספרי SMS/);
 assert.deepEqual(result.actions,[]);
});
test('waiting-summary does not invent data when Groq returns no visible content',async()=>{
 const assistant=new Assistant({
  engine:{execute:async()=>({ok:true,status:'completed',result:{ok:true,items:[{title:'פנייה חדשה',latest_inbound_body:'אפשר לקבל פרטים?',channel:'email'}]}})},
  settings,generate:async()=>{throw Error('empty_ai_response');}
 });
 const result=await assistant.chat({message:'מצא את חמש השיחות האחרונות שממתינות לתשובה שלי. סכם מה כל לקוח מבקש.',context});
 assert.match(result.reply,/אפשר לקבל פרטים/);
 assert.match(result.reply,/ללא סיכום AI/);
});
test('no waiting rows are reported as no results, never invented customer names',async()=>{
 const assistant=new Assistant({
  engine:{execute:async()=>({ok:true,status:'completed',result:{ok:true,items:[]}})},
  settings,generate:async()=>{throw Error('not needed');}
 });
 const result=await assistant.chat({message:'מצא את חמש השיחות האחרונות שממתינות לתשובה שלי. סכם מה כל לקוח מבקש.',context});
 assert.match(result.reply,/לא נמצאו שיחות/);
});
test('unambiguous task intent parser requires quoted title',()=>{
 assert.deepEqual(explicitTaskRequest('צור משימה בשם "לבדוק API" בעדיפות גבוהה'),{title:'לבדוק API',priority:'high'});
 assert.equal(explicitTaskRequest('צור משימה אחת בלי כותרת'),null);
 assert.equal(explicitMutationRequest('מה המשימות שלי?'),false);
 assert.equal(waitingSummaryRequest('מצא את חמש השיחות האחרונות שממתינות לתשובה שלי. סכם מה כל לקוח מבקש.'),true);
 assert.throws(()=>extractWaitingItems({ok:false,result:{items:[]}}),/assistant_read_unavailable/);
});
test('Groq GPT-OSS reserves reasoning tokens and retries once after length-truncated empty answer',async()=>{
 const routes=parseAiProviders({aiBaseUrl:'https://api.groq.com/openai/v1',aiApiToken:'TEST_ONLY',aiModel:'openai/gpt-oss-20b'});
 const bodies=[];
 const result=await callExternalAi([{role:'user',content:'שלום'}],{routes,fetcher:async(url,opts)=>{
  assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
  bodies.push(JSON.parse(opts.body));
  return {ok:true,status:200,json:async()=>bodies.length===1?{choices:[{finish_reason:'length',message:{content:null,reasoning:'private'}}]}:{choices:[{finish_reason:'stop',message:{content:'שלום, אפשר לעזור?'}}]}};
 }});
 assert.equal(bodies.length,2);
 assert.deepEqual(bodies.map(x=>x.max_completion_tokens),[2048,4096]);
 assert.ok(bodies.every(x=>x.reasoning_effort==='low'));
 assert.equal(result.text,'שלום, אפשר לעזור?');
 assert.ok(!result.text.includes('private'));
});
test('non-Groq models never retry invisible outputs without evidence of truncation',async()=>{
 const routes=parseAiProviders({aiBaseUrl:'https://example.invalid/v1',aiApiToken:'TEST_ONLY',aiModel:'custom'});
 let calls=0;
 await assert.rejects(()=>callExternalAi([{role:'user',content:'hello'}],{routes,fetcher:async()=>{calls++;return {ok:true,status:200,json:async()=>({choices:[{finish_reason:'length',message:{content:null}}]})};}}),/empty_ai_response/);
 assert.equal(calls,1);
});
test('workbench query pages a stable cursor and excludes channel posts',async()=>{
 const source=await readFile(new URL('../src/inbox-workbench.js',import.meta.url),'utf8');
 assert.ok(source.includes("page?'pg.position ASC':'c.id ASC'"));
 assert.ok(source.includes('whatsappChannelExclusion'));
 const {whatsappChannelExclusion}=await import('../src/connectors/whatsapp-channel-filter.js');
 for(const suffix of ['%@newsletter','%@g.us','%@broadcast'])assert.ok(whatsappChannelExclusion('c').includes(suffix));
 assert.ok(source.includes('newer.id>m.id'));
});


