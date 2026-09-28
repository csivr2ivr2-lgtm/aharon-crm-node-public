import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTinyModel} from '../src/ai/local-engine.js';
import {classifyLocalError,LocalRuntime} from '../src/ai/local-runtime.js';
import {resolveLocalModel,SUPRA_MODEL,SUPRA_TOKENIZER,LEGACY_LOCAL_MODELS} from '../src/ai/local-model.js';
import {validateSettings,migrateLocalModelSettings} from '../src/platform/settings.js';
const output='{"intent":"support","needs_reply":true,"has_task":true}';
function loaders(failure){
 const calls=[];
 const encoder=(prompt,options)=>{calls.push({prompt,options});return {input_ids:{dims:[1,3]},attention_mask:{}};};
 encoder.decode=(tokens,options)=>{assert.deepEqual(tokens,[4n,5n]);assert.equal(options.skip_special_tokens,true);return output;};
 const env={};
 const loadTransformers=async()=>({env,AutoTokenizer:{from_pretrained:async repo=>{calls.push({tokenizer:repo});if(failure?.stage==='tokenizer')throw Error(failure.message);return encoder;}},AutoModelForCausalLM:{from_pretrained:async(repo,options)=>{calls.push({model:repo,options});if(failure?.stage==='model')throw Error(failure.message);return {generate:async options=>{calls.push({generate:options});return {tolist:()=>[[1n,2n,3n,4n,5n]]};}};}}});
 return {calls,env,loadTransformers};
}
test('Supra loads original tokenizer then ONNX q4 model and decodes only generated tokens',async()=>{
 const f=loaders(),engine=await loadTinyModel({model:SUPRA_MODEL,tokenizer:SUPRA_TOKENIZER,dtype:'q4',cacheDir:'/private/cache'},f);
 assert.equal(f.calls[0].tokenizer,SUPRA_TOKENIZER);assert.equal(f.calls[1].model,SUPRA_MODEL);assert.equal(f.calls[1].options.dtype,'q4');assert.equal(f.calls[1].options.device,'cpu');assert.equal(f.env.cacheDir,'/private/cache');
 assert.equal(await engine.generate([{role:'system',content:'Classify. Return JSON.'},{role:'user',content:'שלום'}],48),output);
 assert.match(f.calls[2].prompt,/Task: Classify/);assert.match(f.calls[2].prompt,/Message:\nשלום\n\nJSON:/);assert.equal(f.calls[2].options.max_length,768);assert.equal(f.calls[3].generate.max_new_tokens,48);
});
for(const [stage,message,code] of [
 ['tokenizer','Could not locate file: https://example.test/private/tokenizer.json','tokenizer_file_missing'],
 ['model','404 https://example.test/private/config.json','model_file_missing'],
 ['model','Could not locate file: https://example.test/private/onnx/model_q4.onnx','quantization_missing'],
 ['model','Error 404 loading remote resource','hub_404']
])test('load failure '+code+' is classified without exposing file location',async()=>{
 await assert.rejects(loadTinyModel({model:SUPRA_MODEL,tokenizer:SUPRA_TOKENIZER,dtype:'q4'},loaders({stage,message})),error=>{
  assert.equal(error.safeCode,code);assert.equal(error.stage,stage);assert.ok(!String(error).includes('example.test'));assert.ok(!JSON.stringify(error).includes('/private'));return true;
 });
});
test('saved model wins over env and both old defaults normalize to Supra',()=>{
 const env={localAiModel:LEGACY_LOCAL_MODELS[1],localAiDtype:'q4'};
 for(const old of LEGACY_LOCAL_MODELS){const settings=validateSettings({ai:{localModel:old}});assert.equal(settings.ai.localModel,SUPRA_MODEL);assert.deepEqual(resolveLocalModel(settings.ai,env),{model:SUPRA_MODEL,tokenizer:SUPRA_TOKENIZER,dtype:'q4'});}
 assert.equal(resolveLocalModel({},env).model,SUPRA_MODEL);
 assert.deepEqual(resolveLocalModel({localModel:'custom/tiny'},env),{model:'custom/tiny',tokenizer:'custom/tiny',dtype:'q4'});
 assert.equal(validateSettings({ai:{localModel:'custom/tiny'}}).ai.localModel,'custom/tiny');
});
test('startup data migration is idempotent and preserves custom models and other settings',async()=>{
 for(const original of [...LEGACY_LOCAL_MODELS,'custom/tiny']){
  let value={ai:{localModel:original,externalModel:'keep'},messaging:{signature:'keep'}},updates=0;
  const db={getConnection:async()=>db,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,args)=>{
   if(sql.startsWith('SELECT'))return [[{value_json:JSON.stringify(value)}]];
   if(sql.startsWith('UPDATE')){updates++;value=JSON.parse(args[0]);}return [{affectedRows:1}];
  }};
  await migrateLocalModelSettings(db);await migrateLocalModelSettings(db);
  assert.equal(updates,original==='custom/tiny'?0:1);assert.equal(value.ai.externalModel,'keep');assert.equal(value.messaging.signature,'keep');assert.equal(value.ai.localModel,original==='custom/tiny'?original:SUPRA_MODEL);
 }
});
test('generic network and permission failures are not mistaken for missing model files',()=>{
 assert.equal(classifyLocalError(Error('fetch failed'),{stage:'tokenizer'}),'network');assert.equal(classifyLocalError(Error('403 forbidden'),{stage:'model'}),'access');
});
