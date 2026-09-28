import {fork} from 'node:child_process';
import {tokenizerForModel} from './local-model.js';
import {parseStructured,tinyTestMessages,tinyTestSchema} from './tiny-contract.js';

export const localErrors=Object.freeze({
 cooldown:'המודל מושהה זמנית לאחר כשל. אפשר לנסות מאוחר יותר.',invalid_output:'המודל החזיר פלט שאינו JSON תקין לפי המבנה הנדרש.',queue_full:'תור המודל מלא. נסה שוב מאוחר יותר.',queue_timeout:'ההמתנה בתור המודל הסתיימה.',
 disabled:'המודל המקומי כבוי בהגדרות.',invalid_model:'מזהה המודל אינו תקין. יש להשתמש בשם מאגר מודל, לא בנתיב או בכתובת.',
 busy:'המודל המקומי מטפל כעת בבקשה אחרת. נסה שוב בסיום.',timeout:'הפעולה חרגה מזמן ההמתנה; תהליך המודל נעצר.',
 memory:'אין מספיק זיכרון לטעינת המודל.',access:'הגישה למודל נדחתה. בדוק הרשאות למאגר המודל.',
 model_file_missing:'קובץ נדרש של המודל לא נמצא.',tokenizer_file_missing:'קובץ נדרש של הטוקנייזר לא נמצא.',quantization_missing:'קובץ המודל בכימות המבוקש לא נמצא.',hub_404:'שרת המודלים החזיר 404 למשאב המבוקש.',network:'הורדת המודל נכשלה בגלל חיבור הרשת.',
 storage:'לא ניתן לקרוא או לכתוב את מטמון המודל.',runtime:'רכיב הרצת המודל אינו זמין או אינו תואם לסביבה.',
 empty:'המודל לא החזיר טקסט.',exit:'תהליך המודל הסתיים באופן בלתי צפוי.',failed:'טעינת המודל או הרצתו נכשלה.',closed:'תהליך המודל נעצר עם סגירת השירות.'
});
export function classifyLocalError(error,{stage,dtype}={}){
 const text=String(error?.message||error||'');
 if(/out of memory|allocat|ENOMEM/i.test(text))return 'memory';
 if(/401|403|unauthori|forbidden|gated/i.test(text))return 'access';
 if(/404|not found|could not locate|ENOENT/i.test(text)){
  if(stage==='tokenizer'||/tokenizer(?:_config)?\.json|vocab\.json|merges\.txt/i.test(text))return 'tokenizer_file_missing';
  if(/model_(?:q4|q4f16|quantized|int8|uint8|fp16|bnb4)\.onnx/i.test(text))return 'quantization_missing';
  if(/config\.json|model\.onnx|model file/i.test(text))return 'model_file_missing';
  return 'hub_404';
 }
 if(/ENOSPC|EACCES|EROFS|permission denied/i.test(text))return 'storage';
 if(/fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|certificate/i.test(text))return 'network';
 if(/onnx|unsupported|backend|shared object|dlopen/i.test(text))return 'runtime';
 return 'failed';
}
export const validModel=model=>typeof model==='string'&&model.length<=180&&/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(model)&&!model.includes('..');
export function memorySnapshot(value=process.memoryUsage()){
 return Object.fromEntries(['rss','heapUsed','heapTotal','external','arrayBuffers'].map(key=>[key,Number.isFinite(value?.[key])&&value[key]>=0?value[key]:0]));
}
export class LocalRuntime{
 constructor({enabled=true,model,dtype='q4',cacheDir,timeoutMs=180000,idleMs=45000,cooldownMs=60000,queueLimit=2,maxContextChars=4000,spawn=fork,clock=()=>Date.now(),memory=memorySnapshot}={}){
  Object.assign(this,{enabled,model,dtype,cacheDir,timeoutMs,idleMs,cooldownMs,queueLimit,maxContextChars,spawn,clock,memory});this.child=null;this.pending=null;this.sequence=0;this.testPromise=null;this.queue=[];this.idleTimer=null;this.cooldownUntil=0;
  this.state={inference_duration_ms:null,worker_memory_peak:null,worker_memory_inference_after:null,state:'idle',loaded:false,loading:false,failed:false,attempted_model:null,attempted_tokenizer:null,error:null,started_at:null,finished_at:null,load_duration_ms:null,memory_before:null,memory_after:null,worker_memory_before:null,worker_memory_after:null,test_running:false,test_result:null};
 }
 status(){return {...structuredClone(this.state),queued:this.queue.length,cooldown_remaining_ms:Math.max(0,this.cooldownUntil-this.clock()),enabled:this.enabled,model:validModel(this.model)?this.model:'[invalid model identifier]',dtype:['q4','q8','fp32','fp16','int8','uint8','q4f16','bnb4'].includes(this.dtype)?this.dtype:'[invalid dtype]',load_duration_ms:this.state.loading?Math.max(0,this.clock()-this.started):this.state.load_duration_ms};}
 error(code,phase='load'){return Object.assign(Error('local_ai_'+code),{safe:{code,message:localErrors[code]||localErrors.failed,phase}});}
 fail(code,phase='load'){
  clearTimeout(this.idleTimer);this.cooldownUntil=this.clock()+this.cooldownMs;
  for(const queued of this.queue.splice(0)){clearTimeout(queued.timer);queued.reject(this.error('cooldown'));}
  const pending=this.pending;this.pending=null;if(pending)clearTimeout(pending.timer);
  const child=this.child;this.child=null;if(child){child.removeAllListeners();child.on('error',()=>{});child.kill('SIGKILL');}
  if(this.state.loading){this.state.load_duration_ms=Math.max(0,this.clock()-this.started);this.state.finished_at=new Date(this.clock()).toISOString();this.state.memory_after=this.memory();}
  if(phase==='inference'&&this.inferenceStarted!=null&&this.state.inference_duration_ms==null)this.state.inference_duration_ms=Math.max(0,this.clock()-this.inferenceStarted);
  Object.assign(this.state,{state:'failed',loaded:false,loading:false,failed:true,error:this.error(code,phase).safe});
  pending?.reject(this.error(code,phase));
 }
 start(model){
  const old=this.child;this.child=null;if(old){old.removeAllListeners();old.on('error',()=>{});old.kill('SIGKILL');}
  this.started=this.clock();Object.assign(this.state,{inference_duration_ms:null,worker_memory_peak:null,worker_memory_inference_after:null,state:'loading',loaded:false,loading:true,failed:false,attempted_model:model,attempted_tokenizer:tokenizerForModel(model),error:null,started_at:new Date(this.started).toISOString(),finished_at:null,load_duration_ms:null,memory_before:this.memory(),memory_after:null,worker_memory_before:null,worker_memory_after:null});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|HOME|TMPDIR|TEMP|TMP|SystemRoot|HF_TOKEN|HF_HOME|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy)$/.test(key)));
  const child=this.spawn(new URL('./local-worker.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=256'],env});this.child=child;
  child.on('error',()=>{if(this.child===child)this.fail('runtime',this.state.loading?'load':'inference');});
  child.on('exit',()=>{if(this.child===child)this.fail('exit',this.state.loading?'load':'inference');});
  child.on('message',message=>{
   if(this.child!==child||!message||message.id!==this.pending?.id)return;
   if(Number.isFinite(message.inference_ms))this.state.inference_duration_ms=Math.max(0,message.inference_ms);
   if(Number.isFinite(message.peak_rss))this.state.worker_memory_peak=Math.max(0,message.peak_rss);
   if(['result','failure'].includes(message.type)&&!this.state.loading&&message.memory)this.state.worker_memory_inference_after=memorySnapshot(message.memory);
   if(message.type==='inference'){this.inferenceStarted=this.clock();return;}
   if(message.type==='loading'){this.state.worker_memory_before=memorySnapshot(message.memory);return;}
   if(message.type==='loaded'){
    Object.assign(this.state,{state:'loaded',loaded:true,loading:false,failed:false,finished_at:new Date(this.clock()).toISOString(),load_duration_ms:Math.max(0,this.clock()-this.started),memory_after:this.memory(),worker_memory_after:memorySnapshot(message.memory)});return;
   }
   if(message.type==='failure'){if(this.state.loading&&message.memory)this.state.worker_memory_after=memorySnapshot(message.memory);this.fail(Object.hasOwn(localErrors,message.code)?message.code:'failed',this.state.loading?(['tokenizer','model'].includes(message.phase)?message.phase:'load'):'inference');return;}
   if(message.type==='result'){
    if(!this.state.loaded){this.fail('invalid_output','load');return;}
    try{if(this.pending.schema)parseStructured(message.text,this.pending.schema);}catch{this.fail('invalid_output','inference');return;}
    if(typeof message.text!=='string'||!message.text.trim()){this.fail('empty','inference');return;}
    const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve(message.text.slice(0,12000));setImmediate(()=>this.drain());
   }
  });
 }
 drain(){
  if(this.pending)return;
  const queued=this.queue.shift();if(queued){clearTimeout(queued.timer);this.execute(...queued.args).then(queued.resolve,queued.reject);return;}
  clearTimeout(this.idleTimer);if(this.child){this.idleTimer=setTimeout(()=>this.releaseIdle(),this.idleMs);this.idleTimer.unref?.();}
 }
 releaseIdle(){
  if(this.pending||this.queue.length)return;
  const child=this.child;this.child=null;if(child){child.removeAllListeners();child.on('error',()=>{});child.kill('SIGKILL');}
  Object.assign(this.state,{state:'idle',loaded:false,loading:false,failed:false});
 }
 generate(messages,maxNew=48,model=this.model,schema){
  if(this.clock()<this.cooldownUntil)return Promise.reject(this.error('cooldown'));
  if(!Array.isArray(messages)||messages.length>2||messages.some(m=>typeof m.content!=='string')||messages.reduce((n,m)=>n+m.content.length,0)>this.maxContextChars)return Promise.reject(this.error('invalid_output','input'));
  clearTimeout(this.idleTimer);
  if(!this.pending)return this.execute(messages,maxNew,model,schema);
  if(this.queue.length>=this.queueLimit)return Promise.reject(this.error('queue_full'));
  return new Promise((resolve,reject)=>{const entry={args:[messages,maxNew,model,schema],resolve,reject};entry.timer=setTimeout(()=>{this.queue=this.queue.filter(q=>q!==entry);reject(this.error('queue_timeout'));},this.timeoutMs);this.queue.push(entry);});
 }
 execute(messages,maxNew=48,model=this.model,schema){
  if(this.clock()<this.cooldownUntil)return Promise.reject(this.error('cooldown'));
  if(this.pending)return Promise.reject(this.error('busy','inference'));
  if(!this.enabled)return Promise.reject(this.error('disabled'));
  if(!validModel(model)){this.fail('invalid_model');this.state.attempted_model='[invalid model identifier]';return Promise.reject(this.error('invalid_model'));}
  return new Promise((resolve,reject)=>{
   this.inferenceStarted=null;this.state.inference_duration_ms=null;this.state.worker_memory_inference_after=null;
   const id=++this.sequence;this.pending={id,resolve,reject,schema,timer:setTimeout(()=>this.fail('timeout',this.state.loading?'load':'inference'),this.timeoutMs)};
   try{
    if(!this.child||this.state.attempted_model!==model)this.start(model);
    this.child.send({id,model,tokenizer:tokenizerForModel(model),dtype:this.dtype,cacheDir:this.cacheDir,messages,maxNew:Math.max(1,Math.min(128,Number(maxNew)||48))},error=>{if(error&&this.pending?.id===id)this.fail('runtime');});
   }catch{this.fail('runtime');}
  });
 }
 startTest(model=this.model){
  if(this.testPromise||this.pending)return {accepted:false,status:this.status()};
  this.state.test_running=true;this.state.test_result=null;
  this.testPromise=this.generate(tinyTestMessages,48,model,tinyTestSchema).then(()=>{this.state.test_result={ok:true,schema_valid:true};},error=>{this.state.test_result={ok:false,error:error.safe||this.error('failed').safe};}).finally(()=>{this.state.test_running=false;this.testPromise=null;});
  return {accepted:true,status:this.status()};
 }
 close(){clearTimeout(this.idleTimer);if(this.child||this.pending||this.queue.length)this.fail('closed','shutdown');}
}
