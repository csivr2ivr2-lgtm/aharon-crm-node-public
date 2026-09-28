import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const privateUrl=()=>{const url=new URL('https://example.test/private/model');url.username='fixture';url.password=randomUUID();return url.href;};
import {LocalRuntime,classifyLocalError} from '../src/ai/local-runtime.js';
function fixture(options={}){
 const children=[];let time=1000;
 const runtime=new LocalRuntime({model:'org/model',cacheDir:'/private/cache',clock:()=>time,timeoutMs:1000,spawn:()=>{
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
test('concurrent requests fail promptly without spawning extra models; test coalesces',async()=>{
 const f=fixture();assert.equal(f.runtime.startTest().accepted,true);assert.equal(f.runtime.startTest().accepted,false);await assert.rejects(f.runtime.generate([]),/busy/);assert.equal(f.children.length,1);
 const finished=f.runtime.testPromise;f.emit('loaded');f.emit('result',{text:'שלום'});await finished;assert.deepEqual(f.runtime.status().test_result,{ok:true});assert.equal(f.runtime.status().test_running,false);f.runtime.close();
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
 for(const [message,code] of [['ENOMEM /private','memory'],['401 token=secret','access'],['404 /private/model','missing'],['ENOSPC /private','storage'],['fetch failed secret','network'],['onnx /private/lib','runtime'],['unknown password=secret','failed']])assert.equal(classifyLocalError(Error(message)),code);
});
test('real isolated subprocess crash leaves parent responsive',async()=>{
 const runtime=new LocalRuntime({model:'org/model',timeoutMs:2000,spawn:()=>spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','ignore','ignore','ipc']})});
 await assert.rejects(runtime.generate([]),/local_ai_(exit|runtime)/);assert.equal(runtime.status().failed,true);assert.equal(await new Promise(resolve=>setImmediate(()=>resolve('alive'))),'alive');
});
