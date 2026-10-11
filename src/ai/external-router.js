// External-only AI routing. Credentials remain in server-side environment variables.
// This module deliberately never exposes configured tokens in errors or return values.
const cooldowns=new Map();
const retryableCodes=new Set([408,425,429,500,502,503,504]);
const validId=x=>typeof x==='string'&&/^[a-z0-9_-]{1,40}$/i.test(x);

export function parseAiProviders({aiProvidersJson='',aiBaseUrl='',aiApiToken='',aiModel=''}={}){
 let entries=[];
 if(aiProvidersJson){
  try{entries=JSON.parse(aiProvidersJson);}catch{throw Error('ai_provider_configuration_invalid');}
  if(!Array.isArray(entries)||entries.length>8)throw Error('ai_provider_configuration_invalid');
 }else if(aiBaseUrl&&aiApiToken)entries=[{id:'primary',base_url:aiBaseUrl,api_key:aiApiToken,model:aiModel}];
 const seen=new Set();
 return entries.map(entry=>{
  if(!entry||typeof entry!=='object'||!validId(entry.id)||seen.has(entry.id)||typeof entry.api_key!=='string'||!entry.api_key||typeof entry.base_url!=='string'||typeof entry.model!=='string'||(entry.model.length===0&&entry.id!=='primary')||entry.model.length>180)throw Error('ai_provider_configuration_invalid');
  seen.add(entry.id);
  let url;try{url=new URL(entry.base_url);}catch{throw Error('ai_provider_configuration_invalid');}
  if(url.protocol!=='https:'&&!(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:'))throw Error('ai_provider_configuration_invalid');
  if(url.username||url.password||url.search||url.hash)throw Error('ai_provider_configuration_invalid');
  if(/Supra-50M|^onnx-community\//i.test(entry.model))throw Error('ai_provider_configuration_invalid');
  const base=url.href.replace(/\/$/,'');
  return {id:entry.id,base_url:base,api_key:entry.api_key,model:entry.model,host:url.host};
 });
}

export async function callExternalAi(messages,{routes,fetcher=fetch,timeoutMs=20000,temperature=0.2,now=()=>Date.now()}={}){
 if(!Array.isArray(routes)||!routes.length)throw Error('external_ai_required');
 const blockedHosts=new Set();let lastError=Error('ai_providers_unavailable');
 for(const route of routes){
  if(blockedHosts.has(route.host)||Number(cooldowns.get(route.id)||0)>now()||Number(cooldowns.get('host:'+route.host)||0)>now())continue;
  try{
   const response=await fetcher(route.base_url+'/chat/completions',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+route.api_key},
    body:JSON.stringify({model:route.model||undefined,messages,temperature:Math.min(1,Math.max(0,Number(temperature)||0)),max_tokens:1024})
   });
   if(!response.ok){
    const status=response.status;
    if(status===429){blockedHosts.add(route.host);cooldowns.set('host:'+route.host,now()+60000);cooldowns.set(route.id,now()+60000);lastError=Error('ai_rate_limited');continue;}
    if(retryableCodes.has(status)){cooldowns.set(route.id,now()+15000);lastError=Error('ai_provider_unavailable');continue;}
    if(status===401||status===403){cooldowns.set(route.id,now()+300000);lastError=Error('ai_provider_unauthorized');continue;}
    throw Error('ai_provider_rejected_request');
   }
   const body=await response.json();
   const content=body?.choices?.[0]?.message?.content;
   if(typeof content!=='string'||!content.trim())throw Error('empty_ai_response');
   return {text:content.trim(),provider:route.id,model:route.model||'default'};
  }catch(error){
   if(['ai_provider_rejected_request','empty_ai_response'].includes(error?.message))throw error;
   lastError=['ai_rate_limited','ai_provider_unavailable','ai_provider_unauthorized'].includes(error?.message)?error:Error('ai_provider_unavailable');
   cooldowns.set(route.id,now()+15000);
  }
 }
 throw lastError;
}
