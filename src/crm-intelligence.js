import {randomUUID,createHash} from 'node:crypto';
import {db as defaultDb,ensureColumn} from './db.js';
import {audit as platformAudit} from './platform/audit.js';
const now=()=>new Date().toISOString();
const entities={project:['projects','id'],system:['systems','did']};
export async function migrateCrmIntelligence(){
 for(const table of ['projects','systems']){
  await ensureColumn(table,'deleted_at','VARCHAR(40)');
  await ensureColumn(table,'archived_at','VARCHAR(40)');
 }
 await defaultDb.query(`CREATE TABLE IF NOT EXISTS reminders (
 id VARCHAR(64) PRIMARY KEY,title VARCHAR(500) NOT NULL,notes LONGTEXT,due_at VARCHAR(40) NOT NULL,
 mode VARCHAR(40) NOT NULL DEFAULT 'remind',status VARCHAR(32) NOT NULL DEFAULT 'pending',
 client_id VARCHAR(64),project_id VARCHAR(64),task_id VARCHAR(64),conversation_id VARCHAR(96),
 source_key VARCHAR(191),created_at VARCHAR(40),updated_at VARCHAR(40),completed_at VARCHAR(40),
 UNIQUE KEY uq_reminder_source(source_key),INDEX(status,due_at),INDEX(client_id),INDEX(project_id),INDEX(task_id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export function createCrmIntelligence({db=defaultDb}={}){
 async function audit(c,event,type,id,before,after,options={}){
  await platformAudit({action:event,entityType:type,entityId:id,before,after,actor:options.actor,source:options.source,mode:options.source==='ai'?'ai':'manual',reason:options.reason,confidence:options.confidence,confirmation:options.confirmed===true?'confirmed':null},{db:c});
  await c.execute('INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES(?,?,?,?,?,?)',[event,type,id,event,JSON.stringify({actor:options.actor||'dashboard',source:options.source||'manual',ai:options.source==='ai',reason:options.reason||'',confidence:options.confidence??null,before,after,confirmed:options.confirmed===true}),now()]);
 }
 async function references(c,type,id){
  const [relations]=await c.execute('SELECT * FROM entity_relations WHERE (from_type=? AND from_id=?) OR (to_type=? AND to_id=?)',[type,id,type,id]);
  const [notes]=await c.execute('SELECT id FROM crm_notes WHERE entity_type=? AND entity_id=?',[type,id]);
  const direct={};
  if(type==='project')for(const table of ['systems','conversations','files','reminders']){
   const [rows]=await c.execute(`SELECT ${table==='systems'?'did':'id'} FROM ${table} WHERE project_id=?`,[id]);direct[table]=rows;
  }
  return {relations,notes,...direct,total:relations.length+notes.length+Object.values(direct).reduce((n,r)=>n+r.length,0)};
 }
 async function lifecyclePreview(type,id){
  if(!entities[type])throw Error('invalid_entity_type');
  const [table,key]=entities[type];const [rows]=await db.execute(`SELECT * FROM ${table} WHERE ${key}=?`,[String(id)]);
  if(!rows[0])throw Error('entity_not_found');return {ok:true,item:rows[0],references:await references(db,type,String(id))};
 }
 async function changeLifecycle(type,id,action,options={}){
  if(!entities[type]||!['archive','restore','delete','hard_delete'].includes(action))throw Error('invalid_lifecycle_action');
  if(['delete','hard_delete'].includes(action)&&options.confirmed!==true)throw Error('confirmation_required');
  const [table,key]=entities[type];id=String(id);const c=await db.getConnection();
  try{
   await c.beginTransaction();const [rows]=await c.execute(`SELECT * FROM ${table} WHERE ${key}=? FOR UPDATE`,[id]);
   const before=rows[0];if(!before)throw Error('entity_not_found');const refs=await references(c,type,id);let after;
   if(action==='hard_delete'){
    if(!before.deleted_at)throw Error('soft_delete_required_first');
    if(refs.total&&options.detachRelations!==true)throw Error('related_records_require_detach_confirmation');
    // Preserve business records and audit history, explicitly detach their associations.
    if(type==='project')for(const t of ['systems','conversations','files','reminders'])await c.execute(`UPDATE ${t} SET project_id=NULL WHERE project_id=?`,[id]);
    await c.execute('DELETE FROM entity_relations WHERE (from_type=? AND from_id=?) OR (to_type=? AND to_id=?)',[type,id,type,id]);
    await c.execute('DELETE FROM crm_notes WHERE entity_type=? AND entity_id=?',[type,id]);
    await c.execute(`DELETE FROM ${table} WHERE ${key}=?`,[id]);after=null;
   }else{
    const ts=now();after={...before,updated_at:ts};
    if(action==='archive'){if(before.deleted_at)throw Error('restore_deleted_entity_first');after.archived_at=ts;}
    if(action==='delete')after.deleted_at=ts;
    if(action==='restore'){after.archived_at=null;after.deleted_at=null;}
    await c.execute(`UPDATE ${table} SET archived_at=?,deleted_at=?,updated_at=? WHERE ${key}=?`,[after.archived_at||null,after.deleted_at||null,ts,id]);
   }
   await audit(c,`${type}.${action}`,type,id,before,after,options);await c.commit();return {ok:true,id,action,references:refs.total};
  }catch(error){await c.rollback();throw error;}finally{c.release();}
 }
 async function validateReferences(c,input){
  for(const [field,table] of [['client_id','clients'],['project_id','projects'],['task_id','tasks'],['conversation_id','conversations']]){
   if(!input[field])continue;const [rows]=await c.execute(`SELECT id FROM ${table} WHERE id=?${table==='projects'?' AND deleted_at IS NULL':''}`,[String(input[field])]);if(!rows.length)throw Error('association_not_found');
  }
 }
 async function createReminder(input,options={}){
  const title=String(input.title||'').trim(),date=new Date(input.due_at),mode=input.mode||'remind';
  if(!title||title.length>500||!Number.isFinite(date.getTime()))throw Error('invalid_reminder');
  if(!['remind','draft_follow_up','suggest_next_action'].includes(mode))throw Error('invalid_reminder_mode');
  const source=input.source_key?createHash('sha256').update(String(input.source_key)).digest('hex'):null;
  const c=await db.getConnection();try{await c.beginTransaction();await validateReferences(c,input);
   const id='rem_'+randomUUID(),ts=now();const [result]=await c.execute('INSERT IGNORE INTO reminders(id,title,notes,due_at,mode,status,client_id,project_id,task_id,conversation_id,source_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,title,String(input.notes||'').slice(0,10000),date.toISOString(),mode,'pending',input.client_id||null,input.project_id||null,input.task_id||null,input.conversation_id||null,source,ts,ts]);
   if(result.affectedRows===0){const [found]=await c.execute('SELECT id FROM reminders WHERE source_key=?',[source]);await c.commit();return {ok:true,id:found[0].id,duplicate:true};}
   await audit(c,'reminder.created','reminder',id,null,{title,due_at:date.toISOString(),mode},options);await c.commit();return {ok:true,id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async function listReminders(filters={}){
  const where=[],values=[];for(const key of ['status','client_id','project_id','task_id'])if(filters[key]){where.push(`${key}=?`);values.push(String(filters[key]));}
  const limit=Math.max(1,Math.min(200,Number.parseInt(filters.limit,10)||100));
  const [items]=await db.execute(`SELECT * FROM reminders ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY due_at ASC LIMIT ${limit}`,values);return {ok:true,items};
 }
 async function updateReminder(id,input,options={}){
  if(!['done','cancelled','pending'].includes(input.status))throw Error('invalid_reminder_status');
  const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await c.execute('SELECT * FROM reminders WHERE id=? FOR UPDATE',[id]);if(!rows[0])throw Error('reminder_not_found');
   await c.execute('UPDATE reminders SET status=?,updated_at=?,completed_at=? WHERE id=?',[input.status,now(),input.status==='done'?now():null,id]);await audit(c,'reminder.updated','reminder',id,rows[0],{...rows[0],status:input.status},options);await c.commit();return {ok:true,id};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
 }
 async function processDueReminders(){
  let processed=0;
  // Transactional claim plus deterministic notification IDs prevents duplicate notifications on retry.
  for(let i=0;i<25;i++){
   const c=await db.getConnection();try{await c.beginTransaction();const [rows]=await c.execute("SELECT * FROM reminders WHERE status='pending' AND due_at<=? ORDER BY due_at ASC LIMIT 1 FOR UPDATE",[now()]);if(!rows[0]){await c.commit();break;}
    const r=rows[0];let metadata;try{metadata=JSON.parse(r.notes||'{}');}catch{metadata=null;}
    if(metadata?.followup){
     const followup=metadata.followup;let stale=false;
     if(r.conversation_id){
      const [latest]=await c.execute('SELECT id,classification,spam_disposition FROM messages WHERE conversation_id=? ORDER BY sent_at DESC,id DESC LIMIT 1',[r.conversation_id]);
      stale=!latest[0]||latest[0].id!==followup.messageId||latest[0].spam_disposition==='spam'||['spam','suspicious','marketing','automated','system'].includes(latest[0].classification);
     }else if(r.task_id){
      const [tasks]=await c.execute('SELECT status,due_date FROM tasks WHERE id=?',[r.task_id]);const task=tasks[0];
      const due=task?.due_date,anchor=due?Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(due)?due+'T23:59:59.999Z':due):NaN;
      stale=!task||!['open','in_progress'].includes(task.status)||anchor!==Date.parse(followup.anchorAt);
     }
     if(r.project_id){const [projects]=await c.execute('SELECT status,archived_at,deleted_at FROM projects WHERE id=?',[r.project_id]);const project=projects[0];stale||=!project||Boolean(project.archived_at||project.deleted_at)||!['active','waiting'].includes(project.status);}
     if(stale){await c.execute("UPDATE reminders SET status='cancelled',updated_at=? WHERE id=?",[now(),r.id]);await audit(c,'reminder.obsolete','reminder',r.id,{status:r.status},{status:'cancelled'},{actor:'worker',source:'automation',reason:'followup_source_changed'});await c.commit();continue;}
    }
    const body=metadata?.followup&&typeof metadata.text==='string'?metadata.text:r.notes||'';
    await c.execute('INSERT IGNORE INTO notifications(id,type,title,body,entity_type,entity_id,is_read,created_at) VALUES(?,?,?,?,?,?,?,?)',['notify_'+createHash('sha256').update(r.id).digest('hex').slice(0,40),'reminder.due',r.title,body,r.conversation_id?'conversation':'reminder',r.conversation_id||r.id,0,now()]);
    if(r.mode==='draft_follow_up'&&r.conversation_id){
     const jid='remdraft_'+createHash('sha256').update(r.id).digest('hex').slice(0,40);
     await c.execute("INSERT IGNORE INTO jobs(id,type,payload_json,status,attempts,run_after,created_at,updated_at) VALUES(?,?,?,'queued',0,?,?,?)",[jid,'reminder.follow_up',JSON.stringify({reminderId:r.id,conversationId:r.conversation_id}),now(),now(),now()]);
    }
    await c.execute("UPDATE reminders SET status='notified',updated_at=? WHERE id=?",[now(),r.id]);await c.commit();processed++;
   }catch(e){await c.rollback();throw e;}finally{c.release();}
  }return {ok:true,processed};
 }
 return {lifecyclePreview,changeLifecycle,createReminder,listReminders,updateReminder,processDueReminders};
}
export const crmIntelligence=createCrmIntelligence();
