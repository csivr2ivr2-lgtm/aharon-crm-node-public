import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {diagnoseAi,publicAiError} from '../src/ai/diagnostics.js';
import {parseAiProviders,callExternalAi} from '../src/ai/external-router.js';
test('diagnostic reports safe, successful provider check',async()=>{
 assert.deepEqual(await diagnoseAi({run:async()=>({ok:true,provider:'primary',model:'openai/gpt-oss-20b'})}),{connected:true,provider:'primary',model:'openai/gpt-oss-20b'});
});
test('diagnostic never exposes unexpected upstream errors and secrets',async()=>{
 assert.deepEqual(await diagnoseAi({run:async()=>{throw Error('SECRET_API_KEY_OR_CUSTOMER_EMAIL')}}),{connected:false,error:'ai_unexpected_error'});
 assert.equal(publicAiError(Error('ai_rate_limited')),'ai_rate_limited');
});
test('invalid model and other 400 errors are safely distinguished',async()=>{
 const routes=parseAiProviders({aiBaseUrl:'https://api.groq.com/openai/v1',aiApiToken:'SECRET_TEST_ONLY',aiModel:'invalid-model'});
 await assert.rejects(()=>callExternalAi([{role:'user',content:'test'}],{routes,fetcher:async()=>({ok:false,status:400,json:async()=>({error:{code:'model_not_found',message:'model not found SECRET_TEST_ONLY'}})})}),/ai_model_not_found/);
 await assert.rejects(()=>callExternalAi([{role:'user',content:'test'}],{routes,fetcher:async()=>({ok:false,status:400,json:async()=>({error:{message:'private customer information'}})})}),/ai_request_rejected/);
});
test('client shows diagnostic action with human-friendly error labels',async()=>{
 const browser=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 const routes=await readFile(new URL('../src/intelligence-routes.js',import.meta.url),'utf8');
 assert.ok(browser.includes("button('ai-external-test','בדוק חיבור AI חיצוני')"));
 assert.ok(routes.includes("route('POST','/api/ai/diagnose'"));
 assert.ok(browser.includes("ai_provider_unauthorized:'"));
 assert.ok(browser.includes('id="externalAiResult"'));
});
