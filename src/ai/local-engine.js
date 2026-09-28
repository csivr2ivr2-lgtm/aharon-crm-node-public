import {classifyLocalError} from './local-runtime.js';
// This module is called only inside the isolated worker; Transformers stays lazy.
export async function loadTinyModel({model,tokenizer,dtype,cacheDir},{loadTransformers=()=>import('@huggingface/transformers')}={}){
 let stage='tokenizer';
 try{
  const {env,AutoTokenizer,AutoModelForCausalLM}=await loadTransformers();env.cacheDir=cacheDir;
  const encoder=await AutoTokenizer.from_pretrained(tokenizer);
  stage='model';
  const network=await AutoModelForCausalLM.from_pretrained(model,{dtype,device:'cpu',session_options:{intraOpNumThreads:1,interOpNumThreads:1}});
  encoder.model_max_length=768;
  return {async generate(messages,maxNew){
   const instruction=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n').slice(0,800);
   const data=messages.filter(m=>m.role==='user').map(m=>m.content).join('\n').slice(0,3200);
   const prompt='Task: '+instruction+'\nReturn JSON only.\n\nMessage:\n'+data+'\n\nJSON:\n';
   const inputs=encoder(prompt,{truncation:true,max_length:768,padding:false});
   const output=await network.generate({...inputs,max_new_tokens:maxNew,do_sample:false,repetition_penalty:1.05});
   // Decode generated tokens only. Never include prompt/schema examples in the result.
   const tokens=output.tolist()[0].slice(inputs.input_ids.dims.at(-1));
   return tokens.length?encoder.decode(tokens,{skip_special_tokens:true}).trim():'';
  }};
 }catch(error){throw Object.assign(Error('local_model_load_failed'),{safeCode:classifyLocalError(error,{stage,dtype}),stage});}
}
