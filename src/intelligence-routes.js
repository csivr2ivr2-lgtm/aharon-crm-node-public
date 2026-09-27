import {db,now} from './db.js';
import {getSettings,updateSettings} from './platform/settings.js';
import {listJobs,retryJob,enqueueJob} from './platform/jobs.js';
import {audit,listAudit} from './platform/audit.js';
import {assistant} from './ai/assistant.js';
import {actionEngine} from './ai/actions.js';
import {setSpamFeedback,resolveSuggestion} from './ai/intelligence.js';
import {crmIntelligence} from './crm-intelligence.js';
import {fileIntelligence} from './file-intelligence.js';
import {loginSecurity} from './login-security.js';

export function registerIntelligenceRoutes(app,{uiAuth,hub,backgroundState={enabled:false,running:false,last_error:null}}){
 const context=()=>({actor:'dashboard',source:'chat',permissions:['read','write','send'],trustedInput:true});
 const scope={internal:true,actor:'dashboard',source:'manual'};
 const route=(method,url,handler)=>app.route({method,url,handler:async(req,reply)=>{if(!uiAuth(req,reply))return;return handler(req,reply);}});
 route('GET','/api/background/status',async()=>{const [rows]=await db.execute("SELECT status,COUNT(*) AS n FROM jobs GROUP BY status");const counts=Object.fromEntries(rows.map(r=>[r.status,Number(r.n)]));return {ok:true,...backgroundState,queued:counts.queued||0,failed:counts.failed||0};});
 route('GET','/api/security/status',async()=>({ok:true,failed_attempts:[...loginSecurity.attempts].map(([ip,count])=>({ip,count})),blocked_ips:(await loginSecurity.blacklist()).blocked.map(entry=>entry.ip),locked:await loginSecurity.isLocked()}));
 route('GET','/api/settings',async()=>({ok:true,settings:await getSettings()}));
 route('PATCH','/api/settings',async req=>({ok:true,settings:await updateSettings(req.body,{actor:'dashboard'})}));
 route('GET','/api/jobs',async()=>({ok:true,items:await listJobs()}));
 route('POST','/api/jobs/:id/retry',async req=>{const result=await retryJob(req.params.id);await audit({action:'job.retry',actor:'dashboard',entityType:'job',entityId:req.params.id,after:result});return result;});
 route('GET','/api/audit',async()=>({ok:true,items:await listAudit()}));
 route('POST','/api/assistant/chat',async req=>assistant.chat({message:req.body?.message,context:context()}));
 route('POST','/api/assistant/actions/:id/confirm',async req=>{
  if(req.body?.confirmed!==true)throw Error('confirmation_required');
  const result=await actionEngine.confirm(req.params.id,req.body.confirmation_token,context());hub.publish('ai.action', {id:req.params.id});return result;
 });
 route('GET','/api/notifications',async()=>{const [items]=await db.execute('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200');return {ok:true,items};});
 route('POST','/api/notifications/:id/read',async req=>{await db.execute('UPDATE notifications SET is_read=1 WHERE id=?',[req.params.id]);return {ok:true};});
 route('GET','/api/suggestions',async()=>{const [rows]=await db.execute('SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT 200');return {ok:true,items:rows.map(({payload_json,...row})=>({...row,payload:JSON.parse(payload_json||'{}')}))};});
 route('POST','/api/suggestions/:id/resolve',async req=>resolveSuggestion({id:req.params.id,...req.body,actor:'dashboard'}));
 route('POST','/api/messages/:id/feedback',async req=>{
  const result=await setSpamFeedback({messageId:req.params.id,classification:req.body?.classification,actor:'dashboard'});
  if(req.body.classification==='normal')await enqueueJob('inbox.process',{messageId:req.params.id},{idempotencyKey:'feedback:'+req.params.id+':'+Date.now()});return result;
 });
 route('PATCH','/api/drafts/:id',async req=>{
  const body=req.body||{};if(body.status!==undefined&&body.status!=='rejected')throw Error('invalid_draft_status');
  if(body.body!==undefined&&(typeof body.body!=='string'||!body.body.trim()||body.body.length>20000))throw Error('invalid_draft_body');
  const connection=await db.getConnection();try{await connection.beginTransaction();
   const [rows]=await connection.execute("SELECT * FROM message_drafts WHERE id=? AND status='draft' FOR UPDATE",[req.params.id]);if(!rows.length)throw Error('draft_not_found');
   const previous=rows[0],after={body:body.body??previous.body,status:body.status||'draft'};
   await connection.execute('UPDATE message_drafts SET body=?,status=?,updated_at=? WHERE id=?',[after.body,after.status,now(),req.params.id]);
   await audit({action:'draft.update',actor:'dashboard',entityType:'draft',entityId:req.params.id,before:{body:previous.body,status:previous.status},after},{db:connection});await connection.commit();return {ok:true};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
 });
 for(const [plural,type] of [['projects','project'],['systems','system']]){
  route('GET','/api/'+plural+'/:id/relations',req=>crmIntelligence.lifecyclePreview(type,req.params.id));
  route('POST','/api/'+plural+'/:id/lifecycle',req=>crmIntelligence.changeLifecycle(type,req.params.id,req.body?.action,{...req.body,actor:'dashboard',source:'manual'}));
 }
 route('GET','/api/reminders',req=>crmIntelligence.listReminders(req.query));
 route('POST','/api/reminders',req=>crmIntelligence.createReminder(req.body||{},scope));
 route('PATCH','/api/reminders/:id',req=>crmIntelligence.updateReminder(req.params.id,req.body||{},scope));
 route('POST','/api/files/text',req=>fileIntelligence.createTextFile(req.body||{},scope));
 route('GET','/api/files/:id/content',req=>fileIntelligence.readFile(req.params.id,scope));
 route('PATCH','/api/files/:id',req=>fileIntelligence.updateFile(req.params.id,req.body||{},scope));
 route('POST','/api/files/:id/lifecycle',req=>fileIntelligence.updateFile(req.params.id,req.body||{},scope));
}
