import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {config} from '../src/config.js';
import {generateStructured,generateText,providerOrder,generateLabel} from '../src/ai/providers.js';
import {tinyTestMessages,tinyTestSchema} from '../src/ai/tiny-contract.js';
import {validateSettings} from '../src/platform/settings.js';
import {classifyMessage,classifyWithAi} from '../src/ai/intelligence.js';
const output=JSON.stringify({intent:'support',needs_reply:true,has_task:true});
test('Tiny defaults are Supra q4 and bounded generation/context',()=>{
 assert.equal(config.localAiModel,'onnx-community/Supra-50M-Instruct-ONNX');assert.equal(config.localAiDtype,'q4');assert.equal(config.localAiMaxNewTokens,8);assert.equal(config.localAiMaxContextChars,4000);
});
test('legacy local settings migrate separately without selecting Tiny for generative work',()=>{
 const local=validateSettings({ai:{provider:'local',model:'onnx-community/Qwen2.5-0.5B-Instruct'}});assert.equal(local.ai.localModel,config.localAiModel);assert.equal(local.ai.externalModel,'');
 const external=validateSettings({ai:{provider:'external',model:'external-test'}});assert.equal(external.ai.externalModel,'external-test');assert.equal(external.ai.localModel,config.localAiModel);
 const edited=validateSettings({ai:{externalModel:'another',localModel:'org/tiny'}},external);assert.equal(edited.ai.externalModel,'another');assert.equal(edited.ai.localModel,'org/tiny');
});
test('text workloads cannot use local even when legacy provider says local',async()=>{
 for(const workload of ['assistant','draft','reasoning','tool_planning','summarization']){
  assert.ok(!providerOrder({provider:'local'},workload).includes('local'));
  await assert.rejects(generateText(tinyTestMessages,{settings:{provider:'local'},providers:{local:()=>{throw Error('should not run');}}}),/external_ai_required/);
 }
 const r=await generateText(tinyTestMessages,{providers:{local:()=>{throw Error('wrong');},external:()=> 'external text'}});assert.equal(r.provider,'external');
});
test('CRM composes JSON from three label calls and falls back per decision',async()=>{
 const calls=[];const r=await generateStructured(tinyTestMessages,{workload:'intent',schema:tinyTestSchema,providers:{local:messages=>{calls.push(messages);return calls.length===1?'bad':'yes';},external:()=> 'support'}});
 assert.equal(calls.length,3);assert.ok(calls.every(m=>!m[0].content.includes('JSON')));assert.deepEqual(r.data,{intent:'support',needs_reply:true,has_task:true});
});
test('free multi-field extraction is external-only; invalid output cannot become a suggestion',async()=>{
 await assert.rejects(generateStructured(tinyTestMessages,{workload:'extraction',schema:tinyTestSchema,providers:{local:()=>{throw Error('must_not_run');}}}),/external_ai_required/);
 for(const text of ['null','[]','{"intent":"support"}'])await assert.rejects(generateStructured(tinyTestMessages,{workload:'extraction',schema:tinyTestSchema,providers:{external:()=>text}}),/invalid_ai_(schema|json)/);
 await assert.rejects(generateLabel('hello',{workload:'intent',providers:{local:()=> 'support and sales'}}),/invalid_output/);
 await assert.rejects(generateLabel('hello',{workload:'intent',providers:{local:()=>{throw Error('local_ai_runtime');}}}),/local_ai_runtime/);
});
test('Tiny refuses tool planning, full history and oversized input without loading',async()=>{
 const options={workload:'intent',schema:tinyTestSchema,providers:{local:()=>{throw Error('should_not_run');}}};
 await assert.rejects(generateStructured(tinyTestMessages,{...options,workload:'tool_planning'}),/invalid_tiny_workload/);
 await assert.rejects(generateStructured([...tinyTestMessages,...tinyTestMessages],options),/tiny_context_too_large/);
 await assert.rejects(generateStructured([{role:'system',content:'short'},{role:'user',content:'x'.repeat(5000)}],options),/tiny_context_too_large/);
});
test('deterministic feedback, unsubscribe, no-reply and known spam skip AI',async()=>{
 for(const message of [{body:'unsubscribe'},{sender:'no-reply@example.test'},{body:'זכית בפרס'},{body:'mail delivery failed'}]){
  const initial=classifyMessage(message);let calls=0;assert.equal(await classifyWithAi(message,initial,()=>{calls++;throw Error('must_not_run');}),initial);assert.equal(calls,0);
 }
 const initial=classifyMessage({body:'hello'},{feedback:'normal'});let calls=0;await classifyWithAi({},initial,()=>{calls++;});assert.equal(calls,0);
});
test('no external provider yields a clear state without starting Local AI',async()=>{
 if(!config.aiBaseUrl||!config.aiApiToken)await assert.rejects(generateText([{role:'user',content:'draft a reply'}]),/external_ai_required/);
});
test('draft and assistant production entry points retain external-only generation',async()=>{
 const local=await readFile(new URL('../src/ai/local-ai.js',import.meta.url),'utf8');assert.match(local,/generateText as generate/);
 const {Assistant}=await import('../src/ai/assistant.js');const assistant=new Assistant({settings:async()=>({ai:{provider:'local',generativeProvider:'disabled'}})});
 await assert.rejects(assistant.chat({message:'שלום',context:{source:'chat',trustedInput:true,permissions:['read']}}),/external_ai_required/);
});

test('manual draft without external AI fails before context retrieval and does not load Tiny',async t=>{
 const {db}=await import('../src/db.js');const {draftReply,aiStatus}=await import('../src/ai/local-ai.js');let reads=0;
 t.mock.method(db,'execute',async sql=>{reads++;assert.match(sql,/FROM app_settings/);return [[{value_json:JSON.stringify({ai:{generativeProvider:'disabled'}})}]];});
 await assert.rejects(draftReply({conversationId:'c'}),/external_ai_required/);assert.equal(reads,1);assert.equal(aiStatus().attempted_model,null);assert.equal(aiStatus().loaded,false);
});
test('email, phone, DID and URL extraction is deterministic and needs no provider',async()=>{
 const {extractDeterministicEntities}=await import('../src/message-format.js');
 const data=extractDeterministicEntities('Write USER@example.test or call 050-1234567; DID 077-1234567; visit https://example.test/help.');
 assert.deepEqual(data.emails,['user@example.test']);assert.deepEqual(data.phones,['0501234567','0771234567']);assert.deepEqual(data.did_candidates,data.phones);assert.deepEqual(data.urls,['https://example.test/help']);
 assert.deepEqual(extractDeterministicEntities('nothing here'),{emails:[],phones:[],did_candidates:[],urls:[]});
});
