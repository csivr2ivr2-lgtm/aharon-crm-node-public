import {config} from '../config.js';

// Providers produce text only. No provider receives executable tools or credentials in context.
export function providerOrder(settings={}) {
 const preferred=settings.provider==='auto'||!settings.provider?(config.localAiEnabled?'local':'external'):settings.provider;
 const available={local:config.localAiEnabled,external:Boolean(config.aiBaseUrl&&config.aiApiToken)};
 return [preferred,...(settings.fallback===false?[]:['local','external'])].filter((x,i,a)=>available[x]&&a.indexOf(x)===i);
}
export async function generate(messages,{settings={},providers,fetcher=fetch}={}) {
 if(!Array.isArray(messages)||messages.some(m=>!['system','user','assistant'].includes(m.role)))throw Error('invalid_ai_messages');
 const order=providers?Object.keys(providers):providerOrder(settings);let lastError;
 for(const provider of order){
  try{
   if(providers)return {text:String(await providers[provider](messages)),provider,model:settings.model||'test'};
   if(provider==='local'){
    const {generateLocal}=await import('./local-ai.js');return {text:await generateLocal(messages,undefined,settings.model||config.localAiModel),provider,model:settings.model||config.localAiModel};
   }
   const url=new URL(config.aiBaseUrl+'/chat/completions');
   if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('ai_endpoint_requires_https');
   const response=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.httpTimeoutMs),headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.aiApiToken},body:JSON.stringify({model:settings.model||config.aiModel||undefined,messages,temperature:Math.min(1,Math.max(0,Number(settings.temperature??0.2))),max_tokens:config.localAiMaxNewTokens})});
   if(!response.ok)throw Error('ai_provider_http_'+response.status);
   const data=await response.json(),text=String(data.choices?.[0]?.message?.content||'').trim();if(!text)throw Error('empty_ai_response');
   return {text,provider,model:settings.model||config.aiModel||'default'};
  }catch(error){lastError=error;}
 }
 throw lastError||Error('ai_provider_unavailable');
}
