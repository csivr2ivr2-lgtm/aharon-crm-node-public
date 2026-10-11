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
  const check=run||async()=>{
   const {Assistant}=await import('./assistant.js');
   const instance=new Assistant({
    // The test cannot read, send or modify customer records, even if the model requests tools.
    engine:{execute:async()=>{throw Error('diagnostic_tools_disabled');}}
   });
   return instance.chat({message:'בדיקת מערכת: השב במשפט אחד בעברית שאתה פעיל. אין צורך בכלים.',context:{actor:'diagnostic',source:'chat',permissions:['read'],trustedInput:true}});
  };
  const result=await check();
  if(!result?.ok||!result?.provider)throw Error('ai_unexpected_error');
  return {connected:true,provider:String(result.provider).slice(0,40),model:String(result.model||'').slice(0,180)};
 }catch(error){return {connected:false,error:publicAiError(error)};}
}
