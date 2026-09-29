import {config} from '../config.js';
import {resolveLocalModel} from './local-model.js';
import {TINY_WORKLOADS,parseStructured,LABELS,labelMessages,labelSchema,parseLabel} from './tiny-contract.js';

export const externalAvailable=settings=>settings?.generativeProvider!=='disabled'&&Boolean(config.aiBaseUrl&&config.aiApiToken);
const externalModel=settings=>settings.externalModel||(!/^(onnx-community\/|.*Supra-50M)/i.test(settings.model||'')&&settings.provider!=='local'?settings.model:'')||config.aiModel||'';
export function providerOrder(settings={},workload='text'){
 if(!Object.hasOwn(LABELS,workload))return externalAvailable(settings)?['external']:[];
 return [...(config.localAiEnabled?['local']:[]),...(settings.fallback!==false&&externalAvailable(settings)?['external']:[])];
}
async function external(messages,{settings,fetcher}){
 if(!externalAvailable(settings))throw Error('external_ai_required');
 const url=new URL(config.aiBaseUrl+'/chat/completions');
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('ai_endpoint_requires_https');
 const model=externalModel(settings);
 if(/Supra-50M|^onnx-community\//i.test(model))throw Error('external_ai_model_required');
 const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.httpTimeoutMs),headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.aiApiToken},body:JSON.stringify({model:model||undefined,messages,temperature:Math.min(1,Math.max(0,Number(settings.temperature??0.2))),max_tokens:1024})});
 if(!response.ok)throw Error('ai_provider_http_'+response.status);
 const data=await response.json(),text=String(data.choices?.[0]?.message?.content||'').trim();if(!text)throw Error('empty_ai_response');return {text,provider:'external',model:model||'default'};
}
function validateMessages(messages){if(!Array.isArray(messages)||messages.some(m=>!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw Error('invalid_ai_messages');}
// Text, reasoning and tool planning are external-only, even under legacy provider=local.
export async function generateText(messages,{settings={},providers,fetcher=fetch}={}){
 validateMessages(messages);
 if(providers){if(!providers.external)throw Error('external_ai_required');return {text:String(await providers.external(messages)),provider:'external',model:externalModel(settings)||'test'};}
 return external(messages,{settings,fetcher});
}
export const generate=generateText; // Compatibility entry point remains external-only.
export async function generateLabel(input,{workload,settings={},providers,fetcher=fetch}={}){
 const messages=labelMessages(workload,input),schema=labelSchema(workload);
 const order=providers?['local',...(settings.fallback===false?[]:['external'])].filter(p=>providers[p]):providerOrder(settings,workload);let lastError;
 for(const provider of order)try{
  let text;
  if(providers)text=String(await providers[provider](messages));
  else if(provider==='local'){const {generateLocal}=await import('./local-ai.js');text=await generateLocal(messages,config.localAiMaxNewTokens,resolveLocalModel(settings,config).model,schema);}
  else text=(await external(messages,{settings,fetcher})).text;
  return {label:parseLabel(text,workload),provider};
 }catch(error){lastError=error;}
 throw lastError||Error('tiny_ai_unavailable');
}
// Compatibility for CRM callers: JSON is assembled by code, never requested from Tiny.
export async function generateStructured(messages,{settings={},workload,schema,providers,fetcher=fetch}={}){
 validateMessages(messages);if(!TINY_WORKLOADS.includes(workload)||!schema?.safeParse)throw Error('invalid_tiny_workload');
 if(messages.length!==2||messages[0].role!=='system'||messages[1].role!=='user'||messages[0].content.length>800||messages.reduce((n,m)=>n+m.content.length,0)>config.localAiMaxContextChars)throw Error('tiny_context_too_large');
 if(['classify','spam','intent'].includes(workload)){
  const input=messages[1].content;
  if(workload==='intent'){
   const intent=await generateLabel(input,{workload:'intent',settings,providers,fetcher}),task=await generateLabel(input,{workload:'task',settings,providers,fetcher}),reply=await generateLabel(input,{workload:'needs_reply',settings,providers,fetcher});
   const data=schema.parse({intent:intent.label,has_task:task.label==='yes',needs_reply:reply.label==='yes'});return {data,text:JSON.stringify(data),provider:intent.provider};
  }
  const result=await generateLabel(input,{workload:'classify',settings,providers,fetcher});
  const data=schema.parse({classification:result.label,confidence:0.75,reason:'Tiny label; uncalibrated confidence'});return {data,text:JSON.stringify(data),provider:result.provider};
 }
 // Free extraction and multi-field suggestions require an external provider.
 const result=await generateText(messages,{settings,providers,fetcher});const data=parseStructured(result.text,schema);return {...result,data,text:JSON.stringify(data)};
}
