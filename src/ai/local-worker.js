// Model import, native runtime and inference stay outside the CRM process.
import {classifyLocalError,memorySnapshot} from './local-runtime.js';
let generator=null;
const send=value=>{if(process.connected)process.send(value);};
process.on('disconnect',()=>process.exit(0));
process.on('message',async({id,model,dtype,cacheDir,messages,maxNew})=>{
 try{
  if(!generator){
   send({id,type:'loading',memory:memorySnapshot()});
   const {env,pipeline}=await import('@huggingface/transformers');env.cacheDir=cacheDir;
   generator=await pipeline('text-generation',model,{dtype});
   send({id,type:'loaded',memory:memorySnapshot()});
  }
  const out=await generator(messages,{max_new_tokens:maxNew,do_sample:false,repetition_penalty:1.05});
  const generated=out?.[0]?.generated_text;
  const text=(Array.isArray(generated)?String(generated.at(-1)?.content||''):String(generated||'')).trim();
  send(text?{id,type:'result',text}:{id,type:'failure',code:'empty'});
 }catch(error){send({id,type:'failure',code:classifyLocalError(error),memory:memorySnapshot()});}
});
