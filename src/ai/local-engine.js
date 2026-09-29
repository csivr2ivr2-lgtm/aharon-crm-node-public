import {scoreCandidates} from './candidate-scoring.js';
import {alpacaPrompt,LABELS} from './tiny-contract.js';
import {classifyLocalError} from './local-runtime.js';
// This module is called only inside the isolated worker; Transformers stays lazy.
export async function loadTinyModel({model,tokenizer,dtype,cacheDir},{loadTransformers=()=>import('@huggingface/transformers')}={}){
 let stage='tokenizer';
 try{
  const {env,AutoTokenizer,AutoModelForCausalLM,Tensor}=await loadTransformers();env.cacheDir=cacheDir;
  const encoder=await AutoTokenizer.from_pretrained(tokenizer);
  stage='model';
  const network=await AutoModelForCausalLM.from_pretrained(model,{dtype,device:'cpu',session_options:{intraOpNumThreads:1,interOpNumThreads:1}});
  encoder.model_max_length=768;
  return {async classify(messages,workload,minMargin){
   if(!Object.hasOwn(LABELS,workload))throw Error('invalid_tiny_workload');
   return scoreCandidates({network,encoder,Tensor,prompt:alpacaPrompt(messages),candidates:LABELS[workload],minMargin});
  }};
 }catch(error){throw Object.assign(Error('local_model_load_failed'),{safeCode:classifyLocalError(error,{stage,dtype}),stage});}
}
