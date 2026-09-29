// Model import, native runtime and inference stay outside the CRM process.
import {classifyLocalError,localErrors,memorySnapshot} from './local-runtime.js';
import {loadTinyModel} from './local-engine.js';
let generator=null;
const send=value=>{if(process.connected)process.send(value);};
process.on('disconnect',()=>process.exit(0));
process.on('message',async({id,model,tokenizer,dtype,cacheDir,messages,maxNew})=>{
 let started=null;
 try{
  if(!generator){
   send({id,type:'loading',memory:memorySnapshot()});
   generator=await loadTinyModel({model,tokenizer,dtype,cacheDir});
   send({id,type:'loaded',memory:memorySnapshot()});
  }
  started=performance.now();send({id,type:'inference'});
  const text=await generator.generate(messages,maxNew);
  send({id,type:'result',text,inference_ms:performance.now()-started,memory:memorySnapshot(),peak_rss:process.resourceUsage().maxRSS*1024});
 }catch(error){send({id,type:'failure',code:Object.hasOwn(localErrors,error.safeCode)?error.safeCode:classifyLocalError(error),phase:error.stage,memory:memorySnapshot(),inference_ms:started===null?null:performance.now()-started,peak_rss:process.resourceUsage().maxRSS*1024});}
});
