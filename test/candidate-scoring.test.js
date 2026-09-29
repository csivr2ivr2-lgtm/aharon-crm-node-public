import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCandidates,rankCandidates,logProbability} from '../src/ai/candidate-scoring.js';
import {benchmarkCases,benchmarkSummary} from '../src/ai/tiny-benchmark.js';
import {loadTinyModel} from '../src/ai/local-engine.js';
class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.disposed=true;}}
function fixture(){
 const calls=[],outputs=[];
 const encoder={encode(text,options){if(text==='yes')return [1];if(text==='no')return [2,3];assert.equal(options.add_special_tokens,true);return [0,0];}};
 const network={generate(){throw Error('generate must never run');},async forward(inputs){
  const ids=Array.from(inputs.input_ids.data,Number);calls.push(ids);const n=ids.length,data=new Float32Array(n*4);
  // P(first candidate token | prompt), then P(second token | prompt, first token).
  data[(2-1)*4+1]=2;data[(2-1)*4+2]=1;
  if(n===3)data[2*4+3]=4;
  const logits=new Tensor('float32',data,[1,n,4]);outputs.push(logits);return {logits};
 }};return {network,encoder,Tensor,calls,outputs};
}
test('single and multi-token candidates use causal positions with deterministic normalized scores',async()=>{
 const f=fixture(),options={...f,prompt:'prompt',candidates:['yes','no'],minMargin:0};
 const result=await scoreCandidates(options),again=await scoreCandidates(options);
 assert.deepEqual(result,again);assert.deepEqual(f.calls.slice(0,2),[[0,0],[0,0,2]]);assert.ok(f.outputs.every(t=>t.disposed));
 const first=logProbability([0,2,1,0],0,4,2),second=logProbability([0,0,0,4],0,4,3);
 assert.equal(result.label,'yes');assert.ok(result.margin>0);assert.ok(Math.abs(result.margin-(logProbability([0,2,1,0],0,4,1)-(first+second)/2))<1e-6);
});
test('length normalization can change ranking; ties and low margins abstain',()=>{
 const scores=[{label:'short',sum:-1,tokens:1},{label:'long',sum:-1.2,tokens:2}];
 assert.equal(rankCandidates(scores,{lengthNormalize:true,minMargin:0}).label,'long');assert.equal(rankCandidates(scores,{lengthNormalize:false,minMargin:0}).label,'short');
 assert.equal(rankCandidates(scores,{minMargin:1}).label,'uncertain');assert.equal(rankCandidates([{label:'a',sum:-1,tokens:1},{label:'b',sum:-1,tokens:1}],{minMargin:0}).label,'uncertain');
});
test('Supra engine calls forward, never generate, for Hebrew and English inputs',async()=>{
 const f=fixture();const model=await loadTinyModel({model:'org/model',tokenizer:'org/tokenizer',dtype:'q4'},{loadTransformers:async()=>({env:{},Tensor,AutoTokenizer:{from_pretrained:async()=>f.encoder},AutoModelForCausalLM:{from_pretrained:async()=>f.network}})});
 for(const content of ['Please help','אנא עזור'])assert.ok(['yes','no','uncertain'].includes((await model.classify([{role:'system',content:'Task?'},{role:'user',content}],'task',0)).label));
 assert.equal(model.generate,undefined);assert.equal(f.calls.length,4);
});
test('scoring errors release tensors and never retry free generation',async()=>{
 const f=fixture();f.network.forward=async()=>{throw Error('scoring failed');};await assert.rejects(scoreCandidates({...f,prompt:'x',candidates:['yes','no']}),/scoring failed/);
 assert.throws(()=>logProbability([NaN],0,1,0));
});
test('benchmark covers 10 synthetic examples per language, all labels and summary denominators',()=>{
 for(const language of ['en','he']){const items=benchmarkCases.filter(x=>x.language===language);assert.equal(items.length,10);assert.deepEqual(new Set(items.map(x=>x.expected.intent)),new Set(['support','sales','follow_up','other']));for(const w of ['task','needs_reply','spam'])assert.equal(new Set(items.map(x=>x.expected[w])).size,2);}
 const groups=benchmarkCases.map(c=>({...c,decisions:Object.entries(c.expected).map(([workload,label])=>({workload,label,matched:true,inference_ms:100}))}));
 groups[0].decisions[0]={workload:'intent',label:'uncertain',matched:false,inference_ms:200};const s=benchmarkSummary(groups);
 assert.equal(s.overall.correct,79);assert.equal(s.overall.total,80);assert.equal(s.overall.uncertain,1);assert.equal(s.languages.en.correct,39);assert.equal(s.workloads.intent.correct,19);assert.equal(s.completed,true);
});
test('extreme finite logits remain numerically stable',()=>{
 assert.ok(Math.abs(logProbability([10000,10000],0,2,0)+Math.log(2))<1e-9);
});
test('worker IPC invokes classifier and returns scored decisions, with safe failure handling',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const source=(await readFile(new URL('../src/ai/local-worker.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const handlers={},sent=[];let loads=0,calls=0,broken=false;
 const decision={label:'yes',score:-0.2,margin:0.4};
 vm.runInNewContext(source,{process:{connected:true,send:m=>sent.push(m),on:(event,fn)=>handlers[event]=fn,resourceUsage:()=>({maxRSS:100}),exit(){}},performance:{now:()=>1},memorySnapshot:()=>({rss:100}),localErrors:{runtime:'safe'},classifyLocalError:()=> 'runtime',loadTinyModel:async()=>{loads++;return {classify:async(messages,workload)=>{calls++;assert.equal(workload,'task');if(broken)throw Error('/private/credential');return decision;}};}});
 const request={id:1,model:'org/model',tokenizer:'org/tokenizer',workload:'task',messages:[]};
 await handlers.message(request);await handlers.message({...request,id:2});assert.equal(loads,1);assert.equal(calls,2);assert.equal(sent.filter(m=>m.type==='result').length,2);assert.deepEqual(sent.find(m=>m.type==='result').decision,decision);
 broken=true;await handlers.message({...request,id:3});assert.equal(sent.at(-1).code,'runtime');assert.ok(!JSON.stringify(sent).includes('credential'));assert.ok(!JSON.stringify(sent).includes('"text"'));
});
