import {fork} from 'node:child_process';

export const localErrors=Object.freeze({
 disabled:'המודל המקומי כבוי בהגדרות.',invalid_model:'מזהה המודל אינו תקין. יש להשתמש בשם מאגר מודל, לא בנתיב או בכתובת.',
 busy:'המודל המקומי מטפל כעת בבקשה אחרת. נסה שוב בסיום.',timeout:'הפעולה חרגה מזמן ההמתנה; תהליך המודל נעצר.',
 memory:'אין מספיק זיכרון לטעינת המודל.',access:'הגישה למודל נדחתה. בדוק הרשאות למאגר המודל.',
 missing:'קובצי המודל או גרסת הכימות לא נמצאו.',network:'הורדת המודל נכשלה בגלל חיבור הרשת.',
 storage:'לא ניתן לקרוא או לכתוב את מטמון המודל.',runtime:'רכיב הרצת המודל אינו זמין או אינו תואם לסביבה.',
 empty:'המודל לא החזיר טקסט.',exit:'תהליך המודל הסתיים באופן בלתי צפוי.',failed:'טעינת המודל או הרצתו נכשלה.',closed:'תהליך המודל נעצר עם סגירת השירות.'
});
export function classifyLocalError(error){
 const text=String(error?.message||error||'');
 if(/out of memory|allocat|ENOMEM/i.test(text))return 'memory';
 if(/401|403|unauthori|forbidden|gated/i.test(text))return 'access';
 if(/404|not found|could not locate/i.test(text))return 'missing';
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
 constructor({enabled=true,model,dtype='q4',cacheDir,timeoutMs=180000,spawn=fork,clock=()=>Date.now(),memory=memorySnapshot}={}){
  Object.assign(this,{enabled,model,dtype,cacheDir,timeoutMs,spawn,clock,memory});this.child=null;this.pending=null;this.sequence=0;this.testPromise=null;
  this.state={state:'idle',loaded:false,loading:false,failed:false,attempted_model:null,error:null,started_at:null,finished_at:null,load_duration_ms:null,memory_before:null,memory_after:null,worker_memory_before:null,worker_memory_after:null,test_running:false,test_result:null};
 }
 status(){return {...structuredClone(this.state),enabled:this.enabled,model:validModel(this.model)?this.model:'[invalid model identifier]',dtype:['q4','q8','fp32','fp16','int8','uint8','q4f16','bnb4'].includes(this.dtype)?this.dtype:'[invalid dtype]',load_duration_ms:this.state.loading?Math.max(0,this.clock()-this.started):this.state.load_duration_ms};}
 error(code,phase='load'){return Object.assign(Error('local_ai_'+code),{safe:{code,message:localErrors[code]||localErrors.failed,phase}});}
 fail(code,phase='load'){
  const pending=this.pending;this.pending=null;if(pending)clearTimeout(pending.timer);
  const child=this.child;this.child=null;if(child){child.removeAllListeners();child.on('error',()=>{});child.kill('SIGKILL');}
  if(this.state.loading){this.state.load_duration_ms=Math.max(0,this.clock()-this.started);this.state.finished_at=new Date(this.clock()).toISOString();this.state.memory_after=this.memory();}
  Object.assign(this.state,{state:'failed',loaded:false,loading:false,failed:true,error:this.error(code,phase).safe});
  pending?.reject(this.error(code,phase));
 }
 start(model){
  const old=this.child;this.child=null;if(old){old.removeAllListeners();old.on('error',()=>{});old.kill('SIGKILL');}
  this.started=this.clock();Object.assign(this.state,{state:'loading',loaded:false,loading:true,failed:false,attempted_model:model,error:null,started_at:new Date(this.started).toISOString(),finished_at:null,load_duration_ms:null,memory_before:this.memory(),memory_after:null,worker_memory_before:null,worker_memory_after:null});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|HOME|TMPDIR|TEMP|TMP|SystemRoot|HF_TOKEN|HF_HOME|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy)$/.test(key)));
  const child=this.spawn(new URL('./local-worker.js',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=1024'],env});this.child=child;
  child.on('error',()=>{if(this.child===child)this.fail('runtime',this.state.loading?'load':'inference');});
  child.on('exit',()=>{if(this.child===child)this.fail('exit',this.state.loading?'load':'inference');});
  child.on('message',message=>{
   if(this.child!==child||!message||message.id!==this.pending?.id)return;
   if(message.type==='loading'){this.state.worker_memory_before=memorySnapshot(message.memory);return;}
   if(message.type==='loaded'){
    Object.assign(this.state,{state:'loaded',loaded:true,loading:false,failed:false,finished_at:new Date(this.clock()).toISOString(),load_duration_ms:Math.max(0,this.clock()-this.started),memory_after:this.memory(),worker_memory_after:memorySnapshot(message.memory)});return;
   }
   if(message.type==='failure'){if(this.state.loading&&message.memory)this.state.worker_memory_after=memorySnapshot(message.memory);this.fail(Object.hasOwn(localErrors,message.code)?message.code:'failed',this.state.loading?'load':'inference');return;}
   if(message.type==='result'){
    if(typeof message.text!=='string'||!message.text.trim()){this.fail('empty','inference');return;}
    const pending=this.pending;this.pending=null;clearTimeout(pending.timer);pending.resolve(message.text.slice(0,100000));
   }
  });
 }
 generate(messages,maxNew=320,model=this.model){
  if(this.pending)return Promise.reject(this.error('busy','inference'));
  if(!this.enabled)return Promise.reject(this.error('disabled'));
  if(!validModel(model)){this.fail('invalid_model');this.state.attempted_model='[invalid model identifier]';return Promise.reject(this.error('invalid_model'));}
  return new Promise((resolve,reject)=>{
   const id=++this.sequence;this.pending={id,resolve,reject,timer:setTimeout(()=>this.fail('timeout',this.state.loading?'load':'inference'),this.timeoutMs)};
   try{
    if(!this.child||this.state.attempted_model!==model)this.start(model);
    this.child.send({id,model,dtype:this.dtype,cacheDir:this.cacheDir,messages,maxNew:Math.max(1,Math.min(1024,Number(maxNew)||320))},error=>{if(error&&this.pending?.id===id)this.fail('runtime');});
   }catch{this.fail('runtime');}
  });
 }
 startTest(model=this.model){
  if(this.testPromise||this.pending)return {accepted:false,status:this.status()};
  this.state.test_running=true;this.state.test_result=null;
  this.testPromise=this.generate([{role:'user',content:'כתוב את המילה שלום בלבד.'}],8,model).then(()=>{this.state.test_result={ok:true};},error=>{this.state.test_result={ok:false,error:error.safe||this.error('failed').safe};}).finally(()=>{this.state.test_running=false;this.testPromise=null;});
  return {accepted:true,status:this.status()};
 }
 close(){if(this.child||this.pending)this.fail('closed','shutdown');}
}
