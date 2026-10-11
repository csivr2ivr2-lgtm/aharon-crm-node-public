// No-customer-data assistant test. The diagnostic must never reveal upstream messages or credentials.
const allowed=new Set([
 'external_ai_required','ai_provider_configuration_invalid','ai_provider_unauthorized',
 'ai_rate_limited','ai_provider_unavailable','ai_model_not_found','ai_request_rejected',
 'ai_provider_rejected_request','ai_context_too_large','empty_ai_response',
 'invalid_assistant_response','assistant_context_budget_too_small','ai_unexpected_error'
]);
export function publicAiError(error){
 const code=String(error?.message||'');
 return allowed.has(code)?code:'ai_unexpected_error';
}
export async function diagnoseAi({run}={}){
 try{
  const check=run||(async()=>{
   const {generateText}=await import('./providers.js');
   const {getSettings}=await import('../platform/settings.js');
   const settings=await getSettings();
   // No assistant tool catalog and no CRM records: diagnose ONLY API reachability, key and model.
   const output=await generateText([
    {role:'system',content:'בדיקת חיבור בלבד. השב במשפט קצר בעברית. אין כלים ואין נתוני לקוחות.'},
    {role:'user',content:'שלום, אשר שאתה מסוגל לענות.'}
   ],{settings:settings.ai});
   return {ok:true,provider:output.provider,model:output.model};
  });
  const result=await check();
  if(!result?.ok||!result?.provider)throw Error('ai_unexpected_error');
  return {connected:true,provider:String(result.provider).slice(0,40),model:String(result.model||'').slice(0,180)};
 }catch(error){return {connected:false,error:publicAiError(error)};}
}
