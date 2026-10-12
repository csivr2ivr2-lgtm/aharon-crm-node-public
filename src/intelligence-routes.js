import {externalProviderHealth} from './ai/external-router.js';
import {listInboxWork,updateInboxWork,markInboxVisit} from './inbox-workbench.js';
import {db,now} from './db.js';
import {getSettings,updateSettings} from './platform/settings.js';
import {listJobs,retryJob,enqueueJob} from './platform/jobs.js';
import {audit,listAudit} from './platform/audit.js';
import {assistant} from './ai/assistant.js';
import {AssistantChatHistory} from './assistant-chat-history.js';
import {diagnoseAi} from './ai/diagnostics.js';
import {actionEngine} from './ai/actions.js';
import {setSpamFeedback,resolveSuggestion} from './ai/intelligence.js';
import {backfillInboxHistory} from './ai/historical-triage.js';
import {listHistoryProgress,discoverHistoryAccounts} from './historical-sync.js';
import {crmIntelligence} from './crm-intelligence.js';
import {fileIntelligence} from './file-intelligence.js';
import {loginSecurity} from './login-security.js';
import {getFollowupCandidates,scheduleFollowup} from './followups.js';
import {listKnowledge,proposeKnowledge,approveKnowledge,updateKnowledge,archiveKnowledge} from './ai/knowledge.js';

export function registerIntelligenceRoutes(app,{uiAuth,hub,backgroundState={enabled:false,running:false,last_error:null}}){
 const context=()=>({actor:'dashboard',source:'chat',permissions:['read','write','send'],trustedInput:true});
 const chatHistory=new AssistantChatHistory({engine:actionEngine,assistant});
 const scope={internal:true,actor:'dashboard',source:'manual'};
 let lastAiDiagnostic=0;
 const route=(method,url,handler)=>app.route({method,url,handler:async(req,reply)=>{if(!uiAuth(req,reply))return;return handler(req,reply);}});
 route('GET','/api/ai/providers/health',()=>({ok:true,items:externalProviderHealth()}));
 route('POST','/api/inbox/visit',req=>markInboxVisit(String(req.unsignCookie(req.cookies.crm_session).value||'')));
 route('GET','/api/history-sync/status',()=>listHistoryProgress());
 route('POST','/api/history-sync/start',()=>discoverHistoryAccounts());
 route('GET','/api/inbox/work',req=>listInboxWork(req.query));
 route('PATCH','/api/inbox/work/:id',req=>updateInboxWork(req.params.id,req.body||{}));
 route('POST','/api/inbox/work/:id/spam',async req=>{
  const [inbound]=await db.execute("SELECT id FROM messages WHERE conversation_id=? AND direction='in' ORDER BY sent_at DESC,id DESC LIMIT 1",[req.params.id]);
  if(!inbound.length)throw Error('conversation_has_no_incoming_message');
  return setSpamFeedback({messageId:inbound[0].id,classification:'spam',actor:'dashboard'});
 });
 route('POST','/api/outgoing/prepare',async req=>{
  const {client_id,account_id,body,subject='',channel}=req.body||{};
  if(!['email','whatsapp'].includes(channel))throw Error('invalid_sending_channel');
  return actionEngine.execute(channel==='email'?'send_email':'send_whatsapp',{client_id,account_id,body,subject},context());
 });
 route('GET','/api/inbox/work/:id',async req=>{const result=await listInboxWork({conversation_id:req.params.id,view:'all'});if(!result.items[0])throw Error('conversation_not_found');return {ok:true,item:result.items[0]};});
 route('POST','/api/inbox/work/:id/task',async req=>{
  const result=await listInboxWork({conversation_id:req.params.id,view:'all'});const item=result.items[0];if(!item)throw Error('conversation_not_found');
  return actionEngine.execute('create_task',{title:'מעקב: '+String(item.title||item.contact_name).slice(0,450),source_message_id:item.message_id,...(item.client_id?{client_id:item.client_id}:{})},context(),{requestId:req.body?.request_id});
 });

 route('GET','/api/background/status',async()=>{const [rows]=await db.execute("SELECT status,COUNT(*) AS n FROM jobs GROUP BY status");const counts=Object.fromEntries(rows.map(r=>[r.status,Number(r.n)]));return {ok:true,...backgroundState,queued:counts.queued||0,failed:counts.failed||0};});
 route('GET','/api/security/status',async()=>({ok:true,failed_attempts:[...loginSecurity.attempts].map(([ip,count])=>({ip,count})),blocked_ips:(await loginSecurity.blacklist()).blocked.map(entry=>entry.ip),locked:await loginSecurity.isLocked()}));
 route('GET','/api/followups',()=>getFollowupCandidates());
 route('POST','/api/followups/:id/remind',req=>scheduleFollowup(req.params.id,{mode:req.body?.mode},{actor:'dashboard'}));
 route('GET','/api/knowledge',async()=>{const result=await listKnowledge();return {ok:true,items:result.articles};});
 route('GET','/api/knowledge/candidates',async()=>{const result=await listKnowledge();return {ok:true,items:result.candidates};});
 route('POST','/api/knowledge/candidates',req=>proposeKnowledge({sourceMessageId:req.body?.sourceMessageId,title:req.body?.title,body:req.body?.body,actor:'owner'}));
 route('POST','/api/knowledge/candidates/:id/approve',req=>approveKnowledge({id:req.params.id,title:req.body?.title,body:req.body?.body,reviewed:req.body?.reviewed,actor:'owner'}));
 route('PATCH','/api/knowledge/:id',req=>req.body?.archived===true?archiveKnowledge({id:req.params.id,actor:'owner'}):updateKnowledge({id:req.params.id,title:req.body?.title,body:req.body?.body,reviewed:req.body?.reviewed,actor:'owner'}));
 route('GET','/api/settings',async()=>({ok:true,settings:await getSettings()}));
 route('PATCH','/api/settings',async req=>({ok:true,settings:await updateSettings(req.body,{actor:'dashboard'})}));
 route('GET','/api/jobs',async()=>({ok:true,items:await listJobs()}));
 route('POST','/api/jobs/:id/retry',async req=>{const result=await retryJob(req.params.id);await audit({action:'job.retry',actor:'dashboard',entityType:'job',entityId:req.params.id,after:result});return result;});
 route('GET','/api/audit',async()=>({ok:true,items:await listAudit()}));
 // Session-scoped chat history, with server-side action ownership checks.
 route('GET','/api/assistant/sessions',()=>chatHistory.list(context().actor));
 route('POST','/api/assistant/sessions',()=>chatHistory.create(context().actor));
 route('GET','/api/assistant/sessions/:id',req=>chatHistory.load(req.params.id,context().actor));
 route('POST','/api/assistant/sessions/:id/archive',req=>chatHistory.archive(req.params.id,context().actor));
 route('POST','/api/assistant/sessions/:id/chat',req=>chatHistory.send({sessionId:req.params.id,message:req.body?.message,requestId:req.body?.request_id,actor:context().actor,context:context()}));
 route('POST','/api/assistant/sessions/:id/actions/:actionId/confirm',async req=>{
  if(req.body?.confirmed!==true)throw Error('confirmation_required');
  await chatHistory.actionBelongs(req.params.id,req.params.actionId,context().actor);
  const result=await actionEngine.confirm(req.params.actionId,req.body.confirmation_token,context());
  hub.publish('ai.action',{id:req.params.actionId});
  return result;
 });
 route('POST','/api/assistant/sessions/:id/actions/:actionId/dismiss',req=>chatHistory.dismiss(req.params.id,req.params.actionId,context().actor));
 route('POST','/api/assistant/actions/:id/dismiss',req=>actionEngine.dismissPending(req.params.id,context()));
 // Legacy read-only client support; new dashboard always uses persisted session endpoints.
 route('POST','/api/assistant/chat',async req=>assistant.chat({message:req.body?.message,context:context()}));
 route('POST','/api/ai/diagnose',async()=>{
  if(Date.now()-lastAiDiagnostic<30000)return {ok:true,connected:false,error:'ai_diagnostic_throttled'};
  lastAiDiagnostic=Date.now();
  return {ok:true,...await diagnoseAi()};
 });
 route('POST','/api/assistant/actions/:id/confirm',async req=>{
  if(req.body?.confirmed!==true)throw Error('confirmation_required');
  const result=await actionEngine.confirm(req.params.id,req.body.confirmation_token,context());hub.publish('ai.action', {id:req.params.id});return result;
 });
 route('GET','/api/notifications',async()=>{const [items]=await db.execute('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200');return {ok:true,items};});
 route('POST','/api/notifications/:id/read',async req=>{await db.execute('UPDATE notifications SET is_read=1 WHERE id=?',[req.params.id]);return {ok:true};});
 route('GET','/api/suggestions',async()=>{const [rows]=await db.execute('SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT 200');return {ok:true,items:rows.map(({payload_json,...row})=>({...row,payload:JSON.parse(payload_json||'{}')}))};});
 route('POST','/api/suggestions/:id/resolve',async req=>resolveSuggestion({id:req.params.id,...req.body,actor:'dashboard'}));
 route('POST','/api/inbox/history/triage',async req=>{
  const dry_run=req.body?.dry_run!==false;
  if(!dry_run&&req.body?.confirmed!==true)throw Error('confirmation_required');
  return backfillInboxHistory({cursor:req.body?.cursor||'',limit:req.body?.limit,dry_run});
 });
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

