import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAiProviders,callExternalAi} from '../src/ai/external-router.js';
const fake=(code,text='ok')=>({ok:code===200,status:code,json:async()=>({choices:[{message:{content:text}}]})});
const options={aiProvidersJson:JSON.stringify([
 {id:'test-one',base_url:'https://example-one.invalid/v1',api_key:'MOCK_ONE',model:'free-model-one'},
 {id:'test-two',base_url:'https://example-two.invalid/v1',api_key:'MOCK_TWO',model:'free-model-two'}
])};
test('accepts explicit, server-side AI provider configuration without disclosing secrets',()=>{
 const routes=parseAiProviders(options);assert.equal(routes.length,2);assert.equal(routes[0].id,'test-one');
 assert.equal(routes[1].model,'free-model-two');
 for(const bad of ['not-json','{}','[{"id":"a","base_url":"http://evil.test","api_key":"SECRET","model":"m"}]']){
  assert.throws(()=>parseAiProviders({aiProvidersJson:bad}),/ai_provider_configuration_invalid/);
 }
 assert.throws(()=>parseAiProviders({aiProvidersJson:JSON.stringify([JSON.parse(options.aiProvidersJson)[0],JSON.parse(options.aiProvidersJson)[0]])}),/ai_provider_configuration_invalid/);
});
test('switches to a different provider when a service is unavailable',async()=>{
 const routes=parseAiProviders(options),calls=[];
 const result=await callExternalAi([{role:'user',content:'hello'}],{routes,fetcher:async(url,init)=>{calls.push({url,auth:init.headers.Authorization});return calls.length===1?fake(503):fake(200,'שלום');}});
 assert.equal(result.text,'שלום');assert.equal(result.provider,'test-two');assert.equal(result.model,'free-model-two');assert.deepEqual(calls.map(x=>x.auth),['Bearer MOCK_ONE','Bearer MOCK_TWO']);
});
test('does not rotate API keys on same host to bypass provider 429 limits',async()=>{
 const routes=parseAiProviders(options).map((r,i)=>i?{...r,host:'shared.example',id:'same-host-two'}:{...r,host:'shared.example',id:'same-host-one'});
 let attempts=0;
 await assert.rejects(callExternalAi([{role:'user',content:'hello'}],{routes,fetcher:async()=>{attempts++;return fake(429);}}),/ai_rate_limited/);
 assert.equal(attempts,1);
});
test('a provider cannot redirect a request or send secrets in error text',async()=>{
 const routes=parseAiProviders(options).map(r=>({...r,id:r.id+'-errors'}));
 await assert.rejects(callExternalAi([{role:'user',content:'hello'}],{routes,fetcher:async()=>{throw Error('API key MOCK_ONE failed');}}),error=>!String(error).includes('MOCK_ONE'));
});
test('legacy single-provider environment still works without an explicit model',async()=>{
 const routes=parseAiProviders({aiBaseUrl:'https://legacy.example/v1',aiApiToken:'TEST_LEGACY'});
 assert.equal(routes[0].model,'');
 const result=await callExternalAi([{role:'user',content:'ping'}],{routes,fetcher:async(_url,init)=>{assert.equal(JSON.parse(init.body).model,undefined);return fake(200,'pong');}});
 assert.equal(result.text,'pong');
});
test('429 host cooldown also applies across subsequent calls',async()=>{
 const routes=parseAiProviders(options).map((r,i)=>({...r,id:r.id+'-host-cooldown',host:'cooldown.test'}));
 let attempts=0;
 await assert.rejects(callExternalAi([{role:'user',content:'one'}],{routes,fetcher:async()=>{attempts++;return fake(429);}}),/ai_rate_limited/);
 await assert.rejects(callExternalAi([{role:'user',content:'two'}],{routes,fetcher:async()=>{attempts++;return fake(200);}}),/ai_providers_unavailable/);
 assert.equal(attempts,1);
});
