import {createHash} from 'node:crypto';
import {z} from 'zod';
import {db,now} from '../db.js';
import {redactAudit} from '../platform/audit.js';
import {ActionEngine} from './actions.js';

const id=z.string().min(1).max(128),object=shape=>z.object(shape).strict();
// Internal operations are deliberately absent from chat toolDefinitions. Each handler
// must be pure or idempotent by its source ID: queue delivery remains at-least-once.
const operations=Object.freeze({
 'inbox.process':object({messageId:id}),
 'file.index':object({fileId:id}),
 'reminders.tick':object({}),
 'followups.tick':object({}),
 'reminder.follow_up':object({reminderId:id,conversationId:id}),
 'task.analyze':object({taskId:id,title:z.string().max(500),notes:z.string().max(20000)})
});
const canonical=value=>JSON.stringify(value,Object.keys(value).sort());
const digest=value=>createHash('sha256').update(value).digest('hex');

export class BackgroundActionRuntime {
 constructor({database=db,handlers={},engine=new ActionEngine({database})}={}) {
  for(const [name,handler] of Object.entries(handlers))if(!Object.hasOwn(operations,name)||typeof handler!=='function')throw Error('unknown_background_handler');
  Object.assign(this,{database,handlers:{...handlers},engine});
 }
 queueHandlers() {
  return Object.fromEntries(Object.keys(operations).filter(name=>name!=='task.analyze').map(name=>[name,(payload,job)=>this.execute(name,payload,{source:'queue',job})]));
 }
 executeTask(task,handler) {
  return this.execute('task.analyze',{taskId:task.id,title:task.title||'',notes:task.notes||''},{source:'task',task},handler);
 }
 async fence(connection,name,args,context,lock=false) {
  if(context.source==='queue'&&name!=='task.analyze'){
   const job=context.job;if(!job?.id||!job.claim_token||job.signal?.aborted)throw Error('background_claim_lost');
   const [rows]=await connection.execute("SELECT type,payload_json FROM jobs WHERE id=? AND status='running' AND claim_token=? AND lease_until>?"+(lock?' FOR UPDATE':''),[job.id,job.claim_token,now()]);
   if(!rows[0]||rows[0].type!==name||canonical(operations[name].parse(JSON.parse(rows[0].payload_json)))!==canonical(args))throw Error('background_claim_lost');
  }else if(context.source==='task'&&name==='task.analyze'){
   const task=context.task;if(!task?.worker_claim||task.id!==args.taskId)throw Error('background_claim_lost');
   const [rows]=await connection.execute("SELECT title,notes FROM tasks WHERE id=? AND worker_claim=? AND worker_state='running' AND status IN ('open','in_progress') AND automation_mode IN ('ai','ai_draft')"+(lock?' FOR UPDATE':''),[task.id,task.worker_claim]);
   if(!rows[0]||(rows[0].title||'')!==args.title||(rows[0].notes||'')!==args.notes)throw Error('background_claim_lost');
  }else throw Error('untrusted_background_execution');
 }
 async execute(name,input,context={},taskHandler) {
  if(!Object.hasOwn(operations,name))throw Error('unknown_background_action');
  if(context.source!=='queue'&&context.source!=='task')throw Error('untrusted_background_execution');
  const args=operations[name].parse(input),encoded=canonical(args);
  const key=context.source==='queue'?context.job?.id:args.taskId+':'+digest(encoded);
  if(!key)throw Error('background_claim_lost');
  const action={id:'bg_'+digest(name+':'+key).slice(0,60),tool:name,source:'background',actor:'worker',reason:'authorized_idempotent_background_operation'};
  const connection=await this.database.getConnection();let locked=false,started=false,transaction=false;
  try {
   // Session lock also prevents concurrent retry handlers after a lease changes.
   const [locks]=await connection.execute('SELECT GET_LOCK(?,0) AS acquired',[action.id]);
   if(Number(locks[0]?.acquired)!==1)throw Error('background_action_busy');locked=true;
   await this.fence(connection,name,args,context);
   const [rows]=await connection.execute('SELECT * FROM ai_actions WHERE id=?',[action.id]);
   const previous=rows[0];
   if(previous&&(previous.tool!==name||previous.args_json!==encoded||previous.actor!=='worker'||previous.source!=='background'))throw Error('background_action_conflict');
   if(previous?.state==='completed')return JSON.parse(previous.result_json);
   if(previous&&!['executing','retryable'].includes(previous.state))throw Error('background_action_state_invalid');
   await connection.beginTransaction();transaction=true;
   if(previous)await connection.execute("UPDATE ai_actions SET state='executing',error=NULL,updated_at=? WHERE id=?",[now(),action.id]);
   else await connection.execute("INSERT INTO ai_actions(id,actor,source,tool,args_json,state,created_at,updated_at) VALUES(?,?,?,?,?,'executing',?,?)",[action.id,action.actor,action.source,name,encoded,now(),now()]);
   await this.engine.audit(action,'executing',null,{job_id:key},connection);
   await connection.commit();transaction=false;started=true;
   const result=await this.perform(name,args,context,taskHandler);
   if(result?.ok===false)throw Error('background_handler_failed');
   const safe=redactAudit(result);
   await connection.beginTransaction();transaction=true;
   await this.fence(connection,name,args,context,true);
   await connection.execute("UPDATE ai_actions SET state='completed',result_json=?,error=NULL,updated_at=? WHERE id=?",[JSON.stringify(safe),now(),action.id]);
   await this.engine.audit(action,'completed',null,safe,connection);
   await connection.commit();transaction=false;return safe;
  }catch(error){
   if(transaction){await connection.rollback();transaction=false;}
   if(started){
    await connection.beginTransaction();transaction=true;
    await connection.execute("UPDATE ai_actions SET state='retryable',error='background_handler_failed',updated_at=? WHERE id=? AND state='executing'",[now(),action.id]);
    await this.engine.audit(action,'retryable',null,{error:'background_handler_failed'},connection);
    await connection.commit();transaction=false;
   }
   throw error;
  }finally{
   try{if(transaction)await connection.rollback();}finally{try{if(locked)await connection.execute('SELECT RELEASE_LOCK(?)',[action.id]);}finally{connection.release();}}
  }
 }
 async perform(name,args,context,taskHandler) {
  if(this.handlers[name])return this.handlers[name](args,context.job||context.task);
  if(name==='inbox.process')return (await import('./intelligence.js')).processIncomingMessage(args,{db:this.database});
  if(name==='file.index')return (await import('../file-intelligence.js')).fileIntelligence.indexFile(args.fileId);
  if(name==='followups.tick')return (await import('../followups.js')).processFollowups({db:this.database});
  if(name==='reminders.tick')return (await import('../crm-intelligence.js')).crmIntelligence.processDueReminders();
  if(name==='reminder.follow_up'){
   const [rows]=await this.database.execute('SELECT conversation_id,notes,status FROM reminders WHERE id=?',[args.reminderId]);
   const reminder=rows[0];if(!reminder||reminder.status!=='notified'||reminder.conversation_id!==args.conversationId)return {ok:true,skipped:'reminder_inactive'};
   let metadata;try{metadata=JSON.parse(reminder.notes||'{}');}catch{metadata={};}
   return (await import('../inbox.js')).createDraft({conversationId:args.conversationId,reminderId:args.reminderId,expectedLatestMessageId:metadata.followup?.messageId,signal:context.job?.signal,instruction:'הכן טיוטת מעקב מנומסת. אל תשלח דבר.',idempotencyKey:'reminder:'+args.reminderId});
  }
  if(name==='task.analyze')return (taskHandler||(await import('./local-ai.js')).executeAiTask)(args);
  throw Error('unknown_background_action');
 }
}
