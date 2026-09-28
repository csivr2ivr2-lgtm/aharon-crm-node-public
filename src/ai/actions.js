import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {db,now} from '../db.js';
import {WorkspaceService} from '../workspace-service.js';
import {audit as writeAudit} from '../platform/audit.js';
import {getSettings} from '../platform/settings.js';
import {emailOf,phoneOf} from '../message-format.js';

const text=(max=500)=>z.string().trim().min(1).max(max);
const id=text(128),optionalText=(max=20000)=>z.string().max(max).optional();
const object=shape=>z.object(shape).strict();
const refs={project_ids:z.array(id).max(20).optional()};
const client={name:text(255),email:z.string().email().max(255).optional(),phone:optionalText(80),company:optionalText(255),notes:optionalText(),...refs};
const project={client_id:id.optional(),name:text(255),description:optionalText(),next_step:optionalText(),status:z.enum(['active','paused','completed']).optional()};
const task={client_id:id.optional(),system_id:text(40).optional(),source_message_id:id.optional(),title:text(500),notes:optionalText(),status:z.enum(['open','in_progress','done','cancelled']).optional(),priority:z.enum(['low','normal','high','urgent']).optional(),due_date:z.string().refine(v=>!v||/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v)&&Number.isFinite(Date.parse(v)),'invalid_due_date').optional(),...refs};
const partial=shape=>Object.fromEntries(Object.entries(shape).map(([k,v])=>[k,v.optional()]));
const registry={};
function register(name,description,schema,op,permission='read'){registry[name]={name,description,schema,op,permission};}
register('search_crm','Search CRM records; use to resolve names and never guess IDs.',object({q:text(500),limit:z.number().int().min(1).max(30).optional()}),'search');
register('get_client','Get exact client record.',object({id}),'client.get');
register('list_clients','List clients and search their names.',object({q:optionalText(255),limit:z.number().int().min(1).max(50).optional()}),'client.list');
register('create_client','Create a client, requiring user approval.',object(client),'client.create','write');
register('update_client','Update exact client fields only.',object({id,...partial(client)}),'client.update','write');
register('list_projects','List current projects.',object({q:optionalText(255),status:optionalText(32),limit:z.number().int().min(1).max(50).optional()}),'project.list');
register('get_project','Read project details.',object({id}),'project.get');
register('create_project','Create a project.',object(project),'project.create','write');
register('update_project','Update a project.',object({id,...partial(project)}),'project.update','write');
register('archive_project','Archive a project reversibly.',object({id}),'project.archive','write');
register('list_tasks','Read tasks.',object({q:optionalText(255),status:z.enum(['open','in_progress','done','cancelled']).optional(),project_id:id.optional(),limit:z.number().int().min(1).max(50).optional()}),'task.list');
register('create_task','Create a task.',object(task),'task.create','write');
register('update_task','Update a task.',object({id,...partial(task)}),'task.update','write');
register('get_system','Read a system by DID.',object({did:text(40)}),'system.get');
register('list_systems','List systems.',object({client_id:id.optional(),project_id:id.optional(),q:optionalText(255),limit:z.number().int().min(1).max(50).optional()}),'system.list');
register('update_system','Update system notes or relationships.',object({did:text(40),notes:optionalText(),client_id:id.optional(),project_id:id.optional(),status:text(40).optional()}),'system.update','write');
register('list_conversations','List conversations, including unread messages.',object({client_id:id.optional(),unread_only:z.boolean().optional(),limit:z.number().int().min(1).max(50).optional()}),'conversation.list');
register('get_conversation','Read a conversation and its messages.',object({id}),'conversation.get');
register('waiting_for_reply','Find conversations whose newest inbound message has no later outgoing reply.',object({}),'waiting_for_reply');
register('recent_activity','Read recent CRM activity.',object({limit:z.number().int().min(1).max(50).optional()}),'activity.list');
register('list_accounts','List sending accounts; credentials are never returned.',object({}),'account.list');
for(const name of ['send_email','send_whatsapp'])register(name,'Send exact text to one resolved client; requires preview and confirmation.',object({client_id:id,account_id:id.optional(),body:text(20000),subject:optionalText(500)}),name,'send');
register('create_draft','Prepare a reply draft without sending.',object({conversation_id:id,instruction:optionalText(2000)}),'create_draft','write');
register('search_files','Search indexed CRM files.',object({q:text(500),client_id:id.optional()}),'search_files');
register('read_file','Read an indexed file by its CRM ID, never a filesystem path.',object({id}),'read_file');
register('create_file','Create a text file.',object({name:text(255),content:z.string().max(100000),client_id:id.optional(),project_id:id.optional(),task_id:id.optional(),folder:optionalText(255)}),'create_file','write');
register('update_file','Edit or rename an existing text file.',object({id,name:text(255).optional(),content:z.string().max(100000).optional(),folder:optionalText(255)}),'update_file','write');
register('list_reminders','Read pending reminders.',object({status:optionalText(32),client_id:id.optional(),limit:z.number().int().min(1).max(50).optional()}),'list_reminders');
register('create_reminder','Create a reminder with an explicit ISO timestamp.',object({title:text(500),due_at:z.string().datetime({offset:true}),mode:z.enum(['remind','draft_follow_up','suggest_next_action']).optional(),client_id:id.optional(),project_id:id.optional(),task_id:id.optional(),conversation_id:id.optional(),notes:optionalText()}),'create_reminder','write');
export const toolDefinitions=()=>Object.values(registry).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:z.toJSONSchema(t.schema)}}));
export function validateTool(name,args){const tool=registry[name];if(!tool)throw Error('unknown_tool');return {tool,args:tool.schema.parse(args)};}
export function authorizeTool(tool,context={}){
 if(!context.actor||!Array.isArray(context.permissions)||!context.permissions.includes(tool.permission))throw Error('tool_permission_denied');
 if(context.source!=='chat'&&tool.permission!=='read'&&!(context.automationApproved===true&&context.allowedTools?.includes(tool.name)&&tool.permission!=='send'))throw Error('untrusted_tool_execution');
 if(context.source==='chat'&&context.trustedInput!==true)throw Error('untrusted_tool_execution');
}
export function needsConfirmation(tool,context={},settings={},args={}){
 if(tool.permission==='send'&&context.source==='chat'&&context.trustedInput===true&&context.sendIntentVerified===true&&settings.messaging?.policy==='auto_send_trusted'&&settings.messaging.trustedClientIds?.includes(args.client_id))return false;
 if(context.source==='chat'&&context.trustedInput===true&&settings.messaging?.policy==='confirm_sensitive'&&['create_draft','create_task','create_reminder'].includes(tool.name))return false;
 return tool.permission!=='read'&&!(context.source==='background'&&context.automationApproved===true&&context.allowedTools?.includes(tool.name)&&tool.permission!=='send');}
const normalizedPhone=value=>{let p=phoneOf(value);if(p.startsWith('00'))p=p.slice(2);if(/^0[2-9]\d{7,8}$/.test(p))p='972'+p.slice(1);return p;};
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
const safeJSON=v=>JSON.parse(JSON.stringify(v,(key,val)=>/^(password|token|secret|access_token|refresh_token|api_key|token_hash)$/i.test(key)?undefined:val));
export function boundedToolResult(value,max=12000){
 let budget=max-200,truncated=false;
 const walk=(item,depth=0)=>{
  if(budget<50||depth>8){truncated=true;return '[truncated]';}
  if(typeof item==='string'){const n=Math.min(3000,budget);const out=item.slice(0,n);budget-=JSON.stringify(out).length;if(out.length<item.length)truncated=true;return out;}
  if(Array.isArray(item)){const out=[];for(const child of item.slice(0,50)){if(budget<100){truncated=true;break;}out.push(walk(child,depth+1));}if(item.length>50)truncated=true;return out;}
  if(item&&typeof item==='object'){const out={};for(const [key,child] of Object.entries(item)){if(budget<100){truncated=true;break;}budget-=key.length+4;out[key]=walk(child,depth+1);}return out;}
  budget-=20;return item;
 };
 const result=walk(value);if(JSON.stringify(result).length>max-100)return {truncated:true,preview:JSON.stringify(result).slice(0,Math.floor((max-200)/2))};
 return truncated?{...result,truncated:true}:result;
}
const summary=(tool,args)=>tool+' — '+String(args.name||args.title||args.client_id||args.id||args.did||'');

export class ActionEngine{
 constructor({database=db,workspace=new WorkspaceService(),send,ingest,files,crm,draft,settings=()=>getSettings(database),clock=()=>Date.now()}={}){Object.assign(this,{database,workspace,send,ingest,files,crm,draft,settings,clock});}
 async audit(action,state,before=null,after=null,database=this.database){await writeAudit({action:action.tool,source:action.source,actor:action.actor,mode:'ai',entityType:'ai_action',entityId:action.id,reason:action.reason||'assistant_tool_request',before,after,confirmation:state},{db:database});await database.execute('INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES(?,?,?,?,?,?)',['ai.'+state,'ai_action',action.id,action.tool,JSON.stringify(safeJSON({action:action.tool,source:action.source,actor:action.actor,ai:true,reason:action.reason||'assistant_tool_request',confidence:null,before,after,confirmation_state:state})),now()]);}
 async execute(name,input,context,options={}){
  const {tool,args}=validateTool(name,input);authorizeTool(tool,context);
  if(tool.permission==='read'){const result=boundedToolResult(safeJSON(await this.perform(tool,args,'')));await this.audit({id:'act_'+randomUUID(),tool:name,actor:context.actor,source:context.source},'read_completed',null,{query:args});return {ok:true,status:'completed',tool:name,result};}
  const settings=await this.settings();
  if(tool.permission==='send'&&!args.account_id){args.account_id=settings.messaging?.defaultAccountId;if(!args.account_id)throw Error('sending_account_required');}
  const resolved=tool.permission==='send'?await this.resolveSend(tool.name,args):null;
  const preview=resolved?{recipient:resolved.to,client:resolved.client.name,account:resolved.account.label,account_key:resolved.account.integration_key,body:args.body,subject:args.subject||''}:null;
  const actionId=options.requestId||'act_'+randomUUID();if(!/^[\w-]{16,64}$/.test(actionId))throw Error('invalid_action_id');
  const intent=context.sendIntent;
  const sendIntentVerified=Boolean(resolved&&intent&&intent.tool===name&&intent.body===args.body&&String(intent.recipient).trim().toLocaleLowerCase()===String(resolved.client.name).trim().toLocaleLowerCase());
  const pending=needsConfirmation(tool,{...context,sendIntentVerified},settings,args),token=randomBytes(32).toString('hex');
  const [insert]=await this.database.execute('INSERT IGNORE INTO ai_actions(id,actor,source,tool,args_json,state,token_hash,expires_at,created_at,updated_at,preview_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[actionId,context.actor,context.source,name,JSON.stringify(args),pending?'pending':'ready',pending?hash(token):'',new Date(this.clock()+15*60*1000).toISOString(),now(),now(),JSON.stringify(preview)]);
  if(!insert.affectedRows){const [old]=await this.database.execute('SELECT * FROM ai_actions WHERE id=?',[actionId]);const row=old[0];if(!row||row.actor!==context.actor||row.tool!==name||row.args_json!==JSON.stringify(args))throw Error('action_id_conflict');if(row.state==='completed')return {ok:true,id:actionId,tool:name,status:'completed',result:JSON.parse(row.result_json)};throw Error('action_already_pending_or_uncertain');}
  const action={id:actionId,actor:context.actor,source:context.source,tool:name,args_json:JSON.stringify(args),preview_json:JSON.stringify(preview)};
  await this.audit(action,pending?'pending':'ready',null,args);
  if(pending)return {ok:true,id:actionId,tool:name,summary:summary(name,args),args,status:'pending',confirmation_token:token,...(preview?{preview}:{})};
  return this.run(action,tool,args,'ready');
 }
 async confirm(actionId,token,context){
  if(context.source!=='chat'||context.trustedInput!==true)throw Error('confirmation_requires_user');
  const [rows]=await this.database.execute('SELECT * FROM ai_actions WHERE id=?',[actionId]);const action=rows[0];
  if(!action||action.actor!==context.actor)throw Error('action_not_found');
  const {tool,args}=validateTool(action.tool,JSON.parse(action.args_json));authorizeTool(tool,context);
  const expected=Buffer.from(action.token_hash||'','hex'),actual=Buffer.from(hash(token||''),'hex');if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw Error('invalid_confirmation');
  if(action.state==='completed')return {ok:true,id:action.id,tool:tool.name,status:'completed',result:JSON.parse(action.result_json)};
  if(action.state!=='pending'||Date.parse(action.expires_at)<=this.clock())throw Error('confirmation_expired_or_used');
  if(tool.permission==='send'){const resolved=await this.resolveSend(tool.name,args),preview=JSON.parse(action.preview_json||'null');if(!preview||preview.recipient!==resolved.to||preview.account_key!==resolved.account.integration_key)throw Error('destination_changed_request_new_confirmation');}
  return this.run(action,tool,args,'pending');
 }
 async run(action,tool,args,expectedState){
  const [claim]=await this.database.execute("UPDATE ai_actions SET state='executing',updated_at=? WHERE id=? AND state=?",[now(),action.id,expectedState]);if(!claim.affectedRows)throw Error('action_already_executing');
  let before=null;
  try{
   if(tool.op.endsWith('.update')){const op=tool.op.replace('.update','.get');before=await this.workspace.call(op,args);if(before?.ok===false)throw Error(before.error||'entity_not_found');}
   const result=await this.perform(tool,args,action.id,action.preview_json?JSON.parse(action.preview_json):null);if(result?.ok===false)throw Error(result.error||'action_failed');
   await this.database.execute("UPDATE ai_actions SET state='completed',result_json=?,updated_at=? WHERE id=?",[JSON.stringify(safeJSON(result)),now(),action.id]);await this.audit(action,'completed',before,result);return {ok:true,id:action.id,tool:tool.name,status:'completed',result:safeJSON(result)};
  }catch(error){await this.database.execute("UPDATE ai_actions SET state='uncertain',error=?,updated_at=? WHERE id=?",['action_failed_review_required',now(),action.id]);await this.audit(action,'uncertain',before,{error:'action_failed_review_required'});throw error;}
 }
 async resolveSend(name,args){
  const result=await this.workspace.call('client.get',{id:args.client_id});if(!result.ok)throw Error('client_not_found');const client=result.item;
  const accounts=await this.workspace.call('account.list',{});const account=accounts.items.find(a=>a.id===args.account_id&&a.status==='active');if(!account)throw Error('account_not_found');
  const provider=String(account.integration_key||'').split(':')[0],externalId=String(account.integration_key||'').slice(provider.length+1);
  if(name==='send_whatsapp'&&provider!=='whatsapp'||name==='send_email'&&!['google','hostinger'].includes(provider))throw Error('account_channel_mismatch');
  let to=name==='send_email'?emailOf(client.email):normalizedPhone(client.phone);if(!to)throw Error('client_destination_missing');if(name==='send_whatsapp'&&!/^[1-9][0-9]{8,14}$/.test(to))throw Error('international_phone_required');
  return {to,client,account,provider,externalId};
 }
 async perform(tool,args,actionId,approvedPreview=null){
  if(tool.op==='waiting_for_reply'){const [items]=await this.database.execute("SELECT c.id,c.title,c.client_id,c.channel,m.sent_at AS waiting_since FROM conversations c JOIN messages m ON m.conversation_id=c.id LEFT JOIN clients cl ON cl.id=c.client_id LEFT JOIN projects p ON p.id=c.project_id WHERE m.direction='in' AND COALESCE(m.spam_disposition,'inbox')<>'spam' AND COALESCE(m.classification,'normal')='normal' AND (cl.id IS NULL OR cl.status='active') AND p.deleted_at IS NULL AND p.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM messages newer WHERE newer.conversation_id=c.id AND (newer.sent_at>m.sent_at OR (newer.sent_at=m.sent_at AND newer.id>m.id))) ORDER BY m.sent_at ASC,m.id ASC LIMIT 50");return {ok:true,items};}
  if(tool.permission==='send'){
   const {to,client,account,provider,externalId}=await this.resolveSend(tool.name,args),channel=provider==='google'?'gmail':provider;
   if(approvedPreview&&(approvedPreview.recipient!==to||approvedPreview.account_key!==account.integration_key))throw Error('destination_changed_request_new_confirmation');
   const convExternal=provider==='whatsapp'?to+'@s.whatsapp.net':'assistant_'+actionId;
   const [claim]=await this.database.execute("INSERT IGNORE INTO outgoing_sends(id,conversation_id,status,created_at,updated_at) VALUES(?,?,'sending',?,?)",[actionId,convExternal,now(),now()]);if(!claim.affectedRows)throw Error('send_already_claimed');
   try{
    const send=this.send||((channel,payload)=>import('../clients/connectors.js').then(({ConnectorsClient})=>new ConnectorsClient().send(channel,payload)));
    const sent=await send(channel,{to,body:args.body,subject:args.subject||'',account_id:externalId});if(!sent?.ok||!sent.message_id)throw Error('send_not_confirmed');
    const event={source:provider+'.assistant',channel:provider==='whatsapp'?'whatsapp':'email',account_id:externalId,account:{provider,type:provider==='whatsapp'?'whatsapp':'email',identifier:account.identifier,label:account.label},conversation_external_id:sent.thread_id||convExternal,external_id:sent.message_id,thread_id:sent.thread_id||convExternal,direction:'out',sender:account.identifier,recipient:to,subject:args.subject||'',body:args.body,is_read:true,sent_at:now(),client_id:client.id};
    await (this.ingest?this.ingest(event):this.workspace.call('message.ingest',event));const result={ok:true,message_id:sent.message_id,recipient:to,client_name:client.name};
    await this.database.execute("UPDATE outgoing_sends SET status='sent',result_json=?,updated_at=? WHERE id=?",[JSON.stringify(result),now(),actionId]);return result;
   }catch(error){await this.database.execute("UPDATE outgoing_sends SET status='uncertain',updated_at=? WHERE id=?",[now(),actionId]);throw error;}
  }
  if(tool.op==='create_draft'){const fn=this.draft||(await import('../inbox.js')).createDraft;return fn({conversationId:args.conversation_id,instruction:args.instruction||''});}
  if(['search_files','read_file','create_file','update_file'].includes(tool.op)){
   const files=this.files||(await import('../file-intelligence.js')).fileIntelligence;
   if(tool.op==='search_files')return files.searchFiles(args.q,{internal:true,clientId:args.client_id});
   if(tool.op==='read_file')return files.readFile(args.id,{internal:true});
   if(tool.op==='create_file')return files.createTextFile(args,{internal:true});
   const {id,...changes}=args;return files.updateFile(id,changes,{internal:true});
  }
  if(['list_reminders','create_reminder','project.archive'].includes(tool.op)){
   const crm=this.crm||(await import('../crm-intelligence.js')).crmIntelligence;
   if(tool.op==='list_reminders')return crm.listReminders(args);
   if(tool.op==='create_reminder')return crm.createReminder({...args,source_key:actionId});
   return crm.changeLifecycle('project',args.id,'archive',{confirmed:true,actor:'assistant',source:'ai'});
  }
  if(tool.name==='create_client'){
   const terms=[args.email,args.phone,args.phone?normalizedPhone(args.phone):'',!args.email&&!args.phone?args.name:''].filter(Boolean),items=[];
   for(const q of new Set(terms)){const result=await this.workspace.call('client.list',{q,limit:200});items.push(...result.items);}
   const matches=items.filter(c=>args.email&&c.email?.toLowerCase()===args.email.toLowerCase()||args.phone&&normalizedPhone(c.phone)&&normalizedPhone(c.phone)===normalizedPhone(args.phone)||!args.email&&!args.phone&&c.name===args.name);
   if(matches.length)throw Error('client_already_exists');
  }
  const result=await this.workspace.call(tool.op,args);
  if(tool.name==='get_conversation'&&result.messages)result.messages=result.messages.slice(-50);
  return result;
 }
}
export async function migrateActions(database=db){await database.query(`CREATE TABLE IF NOT EXISTS ai_actions (
 id VARCHAR(64) PRIMARY KEY,actor VARCHAR(100) NOT NULL,source VARCHAR(40) NOT NULL,tool VARCHAR(80) NOT NULL,
 args_json LONGTEXT,preview_json LONGTEXT,state VARCHAR(32) NOT NULL,token_hash VARCHAR(64),expires_at VARCHAR(40),result_json LONGTEXT,
 error VARCHAR(200),created_at VARCHAR(40),updated_at VARCHAR(40),INDEX(actor,state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);}
export const actionEngine=new ActionEngine();
