import {randomUUID} from "node:crypto";
import {config} from "./config.js";
import {db,now} from "./db.js";
import {executeAiTask} from "./ai/local-ai.js";

export class SmartTaskWorker{
 constructor({logger,hub,database=db,execute=executeAiTask}){this.logger=logger;this.hub=hub;this.db=database;this.execute=execute;this.running=false;this.timer=null;this.initial=null;}
 async claim(){
  const c=await this.db.getConnection();try{
   await c.beginTransaction();
   const stale=new Date(Date.now()-30*60*1000).toISOString();
   await c.execute("UPDATE tasks SET worker_state=IF(worker_attempts>=3,'failed','retry'),worker_claim=NULL,worker_retry_at=? WHERE worker_state='running' AND updated_at<?",[now(),stale]);
   const [rows]=await c.execute("SELECT * FROM tasks WHERE status IN ('open','in_progress') AND automation_mode IN ('ai','ai_draft') AND worker_state IN ('idle','retry') AND worker_attempts<3 AND (worker_retry_at IS NULL OR worker_retry_at<=?) ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,updated_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED",[now()]);
   const task=rows[0];if(!task){await c.commit();return null;}
   task.worker_claim=randomUUID();task.worker_attempts=Number(task.worker_attempts||0)+1;
   await c.execute("UPDATE tasks SET worker_state='running',worker_claim=?,worker_attempts=?,updated_at=? WHERE id=?",[task.worker_claim,task.worker_attempts,now(),task.id]);
   await c.commit();return task;
  }catch(error){await c.rollback();throw error;}finally{c.release();}
 }
 async runOnce(){
  if(this.running)return {ok:true,skipped:"busy"};this.running=true;
  try{
   const task=await this.claim();if(!task)return {ok:true,processed:0};
   try{
    const r=await this.execute({taskId:task.id,title:task.title,notes:task.notes});
    const [update]=await this.db.execute("UPDATE tasks SET worker_state='done',worker_result=?,worker_claim=NULL,updated_at=? WHERE id=? AND worker_claim=? AND status IN ('open','in_progress') AND automation_mode IN ('ai','ai_draft')",[r.result,now(),task.id,task.worker_claim]);
    if(!update.affectedRows)return {ok:true,skipped:"claim_expired"};
    await this.db.execute("INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES(?,?,?,?,?,?)",["task.ai.completed","task",task.id,task.title,JSON.stringify({provider:r.provider,model:r.model}),now()]);
    this.hub?.publish("task.ai.completed",{id:task.id});return {ok:true,processed:1,id:task.id};
   }catch(error){
    const state=task.worker_attempts>=3?"failed":"retry";
    await this.db.execute("UPDATE tasks SET worker_state=?,worker_result=?,worker_claim=NULL,worker_retry_at=?,updated_at=? WHERE id=? AND worker_claim=?",[state,"AI processing failed; inspect connector/model configuration",new Date(Date.now()+60000*2**task.worker_attempts).toISOString(),now(),task.id,task.worker_claim]);
    this.logger?.warn?.({taskId:task.id,errorName:error.name},"AI task worker failed");return {ok:false,processed:1,id:task.id,error:"ai_task_failed"};
   }
  }finally{this.running=false;}
 }
 start(){if(!config.taskWorkerEnabled||this.timer)return;const run=()=>this.runOnce().catch(()=>this.logger?.error?.("Task worker failed"));this.timer=setInterval(run,config.taskWorkerIntervalSeconds*1000);this.timer.unref?.();this.initial=setTimeout(run,2500);this.initial.unref?.();}
 stop(){clearInterval(this.timer);clearTimeout(this.initial);this.timer=null;}
}
