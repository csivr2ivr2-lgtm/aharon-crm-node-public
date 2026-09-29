import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const privateUrl=()=>{const url=new URL('https://example.test/private/model');url.username='fixture';url.password=randomUUID();return url.href;};
import {LocalRuntime,classifyLocalError} from '../src/ai/local-runtime.js';
function fixture(options={}){
 const children=[];let time=1000;
 const runtime=new LocalRuntime({model:'org/model',cacheDir:'/private/cache',clock:()=>time,timeoutMs:1000,cooldownMs:0,queueLimit:0,spawn:()=>{
  const child=new EventEmitter();child.kill=()=>{child.killed=true;};child.send=message=>{child.request=message;};children.push(child);return child;
 },...options});
 const emit=(type,extra={})=>children.at(-1).emit('message',{id:children.at(-1).request.id,type,...extra});
 return {runtime,children,emit,advance:()=>time+=250};
}
test('load status measures duration and memory, tracks actual model and hides cache',async()=>{
 const f=fixture(),p=f.runtime.generate([],8,'org/alternate');assert.equal(f.runtime.status().loading,true);assert.equal(f.runtime.status().attempted_model,'org/alternate');
 f.emit('loading',{memory:{rss:100}});f.advance();f.emit('loaded',{memory:{rss:200}});f.emit('result',{text:'שלום'});assert.equal(await p,'שלום');
 const s=f.runtime.status();assert.equal(s.state,'loaded');assert.equal(s.load_duration_ms,250);assert.equal(s.worker_memory_before.rss,100);assert.equal(s.worker_memory_after.rss,200);assert.ok(s.memory_before.rss>0);assert.ok(s.memory_after.rss>0);assert.ok(!JSON.stringify(s).includes('/private'));f.runtime.close();
});
test('safe failure rejects request, records failure, and supports retry',async()=>{
 const f=fixture(),p=f.runtime.generate([]);f.emit('failure',{code:'network',message:privateUrl(),memory:{rss:300}});await assert.rejects(p,/local_ai_network/);
 assert.equal(f.runtime.status().failed,true);assert.equal(f.runtime.status().worker_memory_after.rss,300);assert.ok(!JSON.stringify(f.runtime.status()).includes('password'));assert.equal(f.children[0].killed,true);
 const retry=f.runtime.generate([]);f.emit('loaded');f.emit('result',{text:'ok'});await retry;assert.equal(f.runtime.status().error,null);f.runtime.close();
});
test('hung loading times out, kills child and leaves next attempt available',async()=>{
 const f=fixture({timeoutMs:20});await assert.rejects(f.runtime.generate([]),/local_ai_timeout/);assert.equal(f.runtime.status().state,'failed');assert.equal(f.runtime.pending,null);assert.equal(f.children[0].killed,true);
});
test('hung inference times out after successful load',async()=>{
 const f=fixture({timeoutMs:20}),p=f.runtime.generate([]);f.emit('loaded');await assert.rejects(p,/timeout/);assert.equal(f.runtime.status().error.phase,'inference');
});

test('crash and spawn failure are contained and sanitized',async()=>{
 const f=fixture(),p=f.runtime.generate([]);f.children[0].emit('exit',1);await assert.rejects(p,/local_ai_exit/);
 const broken=fixture({spawn:()=>{throw Error('/secret/path password=hidden');}});await assert.rejects(broken.runtime.generate([]),/local_ai_runtime/);assert.ok(!JSON.stringify(broken.runtime.status()).includes('hidden'));
});
test('disabled and path-like model settings cannot leak credentials or start a process',async()=>{
 const f=fixture({enabled:false});f.runtime.startTest();await f.runtime.testPromise;assert.equal(f.runtime.status().test_result.error.code,'disabled');assert.equal(f.children.length,0);
 for(const model of ['/home/private/model','C:\\private\\model',privateUrl(),'org/../secret']){
  const f=fixture({model});await assert.rejects(f.runtime.generate([]),/invalid_model/);assert.equal(f.runtime.status().attempted_model,'[invalid model identifier]');assert.equal(f.children.length,0);assert.ok(!JSON.stringify(f.runtime.status()).includes('secret'));
 }
});
test('error classifier only returns allowlisted categories',()=>{
 for(const [message,code] of [['ENOMEM /private','memory'],['401 token=secret','access'],['404 /private/model','hub_404'],['ENOSPC /private','storage'],['fetch failed secret','network'],['onnx /private/lib','runtime'],['unknown password=secret','failed']])assert.equal(classifyLocalError(Error(message)),code);
});
test('real isolated subprocess crash leaves parent responsive',async()=>{
 const runtime=new LocalRuntime({model:'org/model',timeoutMs:2000,spawn:()=>spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','ignore','ignore','ipc']})});
 await assert.rejects(runtime.generate([]),/local_ai_(exit|runtime)/);assert.equal(runtime.status().failed,true);assert.equal(await new Promise(resolve=>setImmediate(()=>resolve('alive'))),'alive');
});

test('bounded queue serializes inference through one child',async()=>{
 const f=fixture({queueLimit:1});const first=f.runtime.generate([]),second=f.runtime.generate([]);await assert.rejects(f.runtime.generate([]),/queue_full/);assert.equal(f.children.length,1);assert.equal(f.runtime.status().queued,1);
 f.emit('loaded');f.emit('result',{text:'first'});await first;await new Promise(setImmediate);assert.equal(f.children.length,1);f.emit('result',{text:'second'});assert.equal(await second,'second');f.runtime.close();
});
test('cooldown prevents repeated loads and rejects already queued work',async()=>{
 const f=fixture({cooldownMs:200,queueLimit:1});const first=f.runtime.generate([]),second=f.runtime.generate([]);const rejected=assert.rejects(second,/cooldown/);
 f.emit('failure',{code:'runtime'});await assert.rejects(first,/runtime/);await rejected;await assert.rejects(f.runtime.generate([]),/cooldown/);assert.equal(f.children.length,1);
 f.advance();const retry=f.runtime.generate([]);assert.equal(f.children.length,2);f.emit('loaded');f.emit('result',{text:'ok'});await retry;f.runtime.close();
});
test('idle shutdown releases process, preserves diagnostics and lazily reloads',async()=>{
 const f=fixture({idleMs:10});assert.equal(f.children.length,0);const p=f.runtime.generate([]);f.emit('loaded',{memory:{rss:100}});f.emit('result',{text:'ok',inference_ms:7,memory:{rss:150},peak_rss:180});await p;
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.children[0].killed,true);assert.equal(f.runtime.status().state,'idle');assert.equal(f.runtime.status().attempted_model,'org/model');assert.equal(f.runtime.status().inference_duration_ms,7);assert.equal(f.runtime.status().worker_memory_peak,180);
 const retry=f.runtime.generate([]);assert.equal(f.children.length,2);f.emit('loaded');f.emit('result',{text:'again'});await retry;f.runtime.close();
});



test('valid JSON cannot pass Test Local AI before a successful model load',async()=>{
 const f=fixture();f.runtime.startTest();const done=f.runtime.testPromise;f.emit('result',{text:JSON.stringify({intent:'support',has_task:true,needs_reply:true})});await done;assert.equal(f.runtime.status().test_result.ok,false);f.runtime.close();
});

for(const code of ['tokenizer_file_missing','model_file_missing','quantization_missing','hub_404'])test(code+' stays isolated, records both attempted repositories and enables cooldown',async()=>{
 const model='onnx-community/Supra-50M-Instruct-ONNX',f=fixture({model,cooldownMs:200}),p=f.runtime.generate([]);
 assert.equal(f.children[0].request.tokenizer,'SupraLabs/Supra-50M-Instruct');f.emit('failure',{code,phase:'model'});await assert.rejects(p,new RegExp(code));assert.equal(f.runtime.status().attempted_model,model);assert.equal(f.runtime.status().attempted_tokenizer,'SupraLabs/Supra-50M-Instruct');assert.equal(f.runtime.status().error.code,code);assert.equal(f.children[0].killed,true);await assert.rejects(f.runtime.generate([]),/cooldown/);assert.equal(await new Promise(resolve=>setImmediate(()=>resolve('alive'))),'alive');
});

test('schema failure keeps engine loaded, drains queue without cooldown, and never retains customer output',async()=>{
 const {labelSchema}=await import('../src/ai/tiny-contract.js');const tinyTestSchema=labelSchema('intent');
 const f=fixture({cooldownMs:60000,queueLimit:1,idleMs:10});
 const p=f.runtime.generate([],48,'org/model',tinyTestSchema),next=f.runtime.generate([],48,'org/model',tinyTestSchema);
 const rejected=assert.rejects(p,/invalid_output/);f.emit('loaded');f.emit('result',{text:'PRIVATE CUSTOMER OUTPUT'});await rejected;
 assert.equal(f.runtime.status().state,'loaded');assert.equal(f.runtime.status().inference_status,'succeeded');assert.equal(f.runtime.status().cooldown_remaining_ms,0);assert.equal(f.runtime.status().error,null);
 assert.ok(!JSON.stringify(f.runtime.status()).includes('PRIVATE CUSTOMER'));await new Promise(setImmediate);
 f.emit('result',{decision:{label:'support',score:-1,margin:1}});await next;assert.equal(f.children.length,1);
 await new Promise(r=>setTimeout(r,30));assert.equal(f.runtime.status().state,'idle');
});

test('empty completed inference is an output failure without load cooldown',async()=>{
 const f=fixture({cooldownMs:60000});const p=f.runtime.generate([]);f.emit('loaded');f.emit('result',{text:''});await assert.rejects(p,/invalid_output/);
 assert.equal(f.runtime.status().state,'loaded');assert.equal(f.runtime.status().cooldown_remaining_ms,0);f.runtime.close();
});



async function finishBenchmark(f,{partial=false}={}){
 const {benchmarkCases}=await import('../src/ai/tiny-benchmark.js');let i=0;
 for(const sample of benchmarkCases)for(const workload of ['intent','task','needs_reply','spam']){
  const request=f.children[0].request;assert.equal(request.maxNew,undefined);assert.equal(request.workload,workload);assert.ok(!request.messages[0].content.includes('JSON'));
  if(i===0)f.emit('loaded');
  f.emit('result',{decision:partial&&i===0?{label:'invented',score:-1,margin:1}:partial&&i===1?{label:'yes',score:-1,margin:0}:{label:sample.expected[workload],score:-1,margin:1},inference_ms:20,memory:{rss:256},peak_rss:512});await new Promise(setImmediate);i++;
 }
}
test('80 benchmark decisions reuse one loaded worker and release it after idle',async()=>{
 const f=fixture({idleMs:10});f.runtime.startTest();const done=f.runtime.testPromise;await finishBenchmark(f);await done;
 const s=f.runtime.status();assert.equal(s.test_result.ok,true);assert.equal(s.test_result.summary.overall.correct,80);assert.equal(s.test_result.summary.languages.he.total,40);assert.equal(f.children.length,1);
 assert.ok(!JSON.stringify(s).includes('raw_output'));await new Promise(r=>setTimeout(r,30));assert.equal(f.runtime.status().state,'idle');
});
test('partial scoring contract failures and uncertainty leave engine loaded without cooldown',async()=>{
 const f=fixture({cooldownMs:60000});f.runtime.startTest();const done=f.runtime.testPromise;await finishBenchmark(f,{partial:true});await done;
 const s=f.runtime.status();assert.equal(s.state,'loaded');assert.equal(s.cooldown_remaining_ms,0);assert.equal(s.test_result.summary.overall.uncertain,1);assert.equal(s.test_result.summary.overall.errors,1);assert.equal(s.test_result.summary.overall.correct,78);
 const p=f.runtime.generate([]);f.emit('result',{text:'PRIVATE_CUSTOMER_VALUE'});await p;assert.ok(!JSON.stringify(f.runtime.status()).includes('PRIVATE_CUSTOMER_VALUE'));f.runtime.close();
});
test('scoring runtime failure stays isolated and safe without a generation retry',async()=>{
 const {labelSchema}=await import('../src/ai/tiny-contract.js');const f=fixture({cooldownMs:60000});const promise=f.runtime.generate([],999,'org/model',labelSchema('intent'));
 f.emit('loaded');f.emit('failure',{code:'runtime',message:'/private/token=secret'});await assert.rejects(promise,/runtime/);assert.equal(f.children.length,1);assert.ok(!JSON.stringify(f.runtime.status()).includes('secret'));assert.equal(await new Promise(resolve=>setImmediate(()=>resolve('alive'))),'alive');
});
