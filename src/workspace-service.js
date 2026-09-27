import {randomBytes,createHash} from "node:crypto";
import {db,now} from "./db.js";
const id=p=>p+"_"+randomBytes(8).toString("hex");
const lim=(v,d=50,m=200)=>Math.max(1,Math.min(m,Number.parseInt(String(v??d),10)||d));
const j=v=>JSON.stringify(v??{});
const parse=v=>{try{return JSON.parse(v||"{}")}catch{return {}}};

async function activity(event,entity_type="",entity_id="",title="",metadata={}){await db.execute("INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES(?,?,?,?,?,?)",[event,entity_type,entity_id,title,j(metadata),now()]);}
async function relIds(type,key,to){const [r]=await db.execute("SELECT to_id FROM entity_relations WHERE from_type=? AND from_id=? AND to_type=?",[type,key,to]);return r.map(x=>String(x.to_id));}
async function replaceRelations(type,key,to,ids=[]){const c=await db.getConnection();try{await c.beginTransaction();await c.execute("DELETE FROM entity_relations WHERE from_type=? AND from_id=? AND to_type=?",[type,key,to]);for(const x of [...new Set(ids.map(String).filter(Boolean))])await c.execute("INSERT IGNORE INTO entity_relations(from_type,from_id,to_type,to_id,relation_type,created_at) VALUES(?,?,?,?,?,?)",[type,key,to,x,"belongs_to",now()]);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}}
const hashId=(p,s)=>p+"_"+createHash("sha256").update(s).digest("hex").slice(0,32);

async function saveProject(d){const key=String(d.id||id("proj")),ts=now();const [old]=await db.execute("SELECT created_at FROM projects WHERE id=?",[key]);await db.execute(`INSERT INTO projects(id,name,slug,status,category,description,next_step,source,repo_full_name,url,language,is_private,modules_json,custom_fields_json,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),slug=VALUES(slug),status=VALUES(status),category=VALUES(category),description=VALUES(description),next_step=VALUES(next_step),source=VALUES(source),repo_full_name=VALUES(repo_full_name),url=VALUES(url),language=VALUES(language),is_private=VALUES(is_private),modules_json=VALUES(modules_json),custom_fields_json=VALUES(custom_fields_json),deleted_at=VALUES(deleted_at),updated_at=VALUES(updated_at)`,[key,String(d.name||"").trim(),String(d.slug||d.name||""),String(d.status||"active"),String(d.category||""),String(d.description||""),String(d.next_step||""),String(d.source||"manual"),String(d.repo_full_name||""),String(d.url||""),String(d.language||""),d.is_private?1:0,j(d.modules||[]),j(d.custom_fields||{}),d.deleted_at||null,old[0]?.created_at||ts,ts]);await activity(old.length?"project.updated":"project.created","project",key,String(d.name||""));return key;}
async function saveClient(d){const key=String(d.id||id("client")),ts=now();const [old]=await db.execute("SELECT created_at FROM clients WHERE id=?",[key]);await db.execute(`INSERT INTO clients(id,name,phone,email,company,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),phone=VALUES(phone),email=VALUES(email),company=VALUES(company),status=VALUES(status),notes=VALUES(notes),updated_at=VALUES(updated_at)`,[key,String(d.name||"").trim(),String(d.phone||""),String(d.email||""),String(d.company||""),String(d.status||"active"),String(d.notes||""),old[0]?.created_at||ts,ts]);await replaceRelations("client",key,"project",Array.isArray(d.project_ids)?d.project_ids:[]);await activity(old.length?"client.updated":"client.created","client",key,String(d.name||""));return key;}
async function saveTask(d){const key=String(d.id||id("task")),ts=now();const [old]=await db.execute("SELECT created_at FROM tasks WHERE id=?",[key]);await db.execute(`INSERT INTO tasks(id,title,status,priority,due_date,notes,automation_mode,worker_state,worker_result,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),status=VALUES(status),priority=VALUES(priority),due_date=VALUES(due_date),notes=VALUES(notes),automation_mode=VALUES(automation_mode),worker_state=VALUES(worker_state),worker_result=VALUES(worker_result),updated_at=VALUES(updated_at)`,[key,String(d.title||"").trim(),String(d.status||"open"),String(d.priority||"normal"),String(d.due_date||""),String(d.notes||""),String(d.automation_mode||"manual"),String(d.worker_state||"idle"),String(d.worker_result||""),old[0]?.created_at||ts,ts]);await replaceRelations("task",key,"project",Array.isArray(d.project_ids)?d.project_ids:[]);await activity(old.length?"task.updated":"task.created","task",key,String(d.title||""));return key;}
async function saveAccount(d){const key=String(d.id||id("acct")),ts=now();const [old]=await db.execute("SELECT created_at FROM accounts WHERE id=?",[key]);await db.execute(`INSERT INTO accounts(id,type,label,identifier,status,integration_key,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE type=VALUES(type),label=VALUES(label),identifier=VALUES(identifier),status=VALUES(status),integration_key=VALUES(integration_key),notes=VALUES(notes),updated_at=VALUES(updated_at)`,[key,String(d.type||"other"),String(d.label||"Account"),String(d.identifier||""),String(d.status||"active"),d.integration_key?String(d.integration_key):null,String(d.notes||""),old[0]?.created_at||ts,ts]);await replaceRelations("account",key,"project",Array.isArray(d.project_ids)?d.project_ids:[]);return key;}

export async function ingestMessage(p){
 const account=p.account||{},provider=String(account.provider||String(p.source||"external").split(".")[0]);
 const externalAccountId=String(p.account_id||account.identifier||"default"),integrationKey=provider+":"+externalAccountId;
 const ext=String(p.conversation_external_id||p.thread_id||p.external_id||p.id||"");
 const ev=String(p.external_id||p.id||"");
 if(!ext||!ev)throw Error("message_and_conversation_id_required");
 const accountId=hashId("acct",integrationKey);let convId=hashId("conv",provider+"|"+externalAccountId+"|"+ext);
 const msgId=hashId("msg",provider+"|"+externalAccountId+"|"+ev);
 const date=new Date(p.sent_at||Date.now());if(Number.isNaN(date.getTime()))throw Error("invalid_sent_at");
 const ts=date.toISOString(),direction=p.direction==="out"?"out":"in",read=direction==="out"||Boolean(p.is_read);
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  await c.execute(`INSERT INTO accounts(id,type,label,identifier,status,integration_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label),updated_at=VALUES(updated_at)`,[accountId,account.type||"email",account.label||account.identifier||provider,account.identifier||externalAccountId,"active",integrationKey,now(),now()]);
  const [accounts]=await c.execute("SELECT id FROM accounts WHERE integration_key=?",[integrationKey]);const localAccountId=accounts[0].id;
  if(provider==="hostinger"&&Array.isArray(p.references)&&p.references.length){
   const refs=p.references.slice(-30),marks=refs.map(()=>"?").join(",");
   const [linked]=await c.execute(`SELECT m.conversation_id FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE cv.account_id=? AND m.rfc_message_id IN (${marks}) ORDER BY m.sent_at ASC LIMIT 1`,[localAccountId,...refs]);
   if(linked[0])convId=linked[0].conversation_id;
  }
  const [exists]=await c.execute("SELECT m.id,m.conversation_id FROM messages m JOIN conversations cv ON cv.id=m.conversation_id WHERE m.id=? OR (cv.account_id=? AND m.external_id=?) LIMIT 1",[msgId,localAccountId,ev]);
  if(exists.length){await c.commit();return {inserted:false,conversation_id:exists[0].conversation_id,message_id:exists[0].id,account_id:localAccountId};}
  await c.execute(`INSERT INTO conversations(id,channel,account_id,external_id,title,client_id,project_id,unread_count,last_message_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)`,[convId,p.channel||"email",localAccountId,ext,String(p.subject||p.sender||ext).slice(0,500),String(p.client_id||""),String(p.project_id||""),0,ts,now(),now()]);
  await c.execute("SELECT id FROM conversations WHERE id=? FOR UPDATE",[convId]);
  await c.execute(`INSERT INTO messages(id,conversation_id,external_id,direction,sender,recipient,subject,body,is_read,sent_at,created_at,source,channel,account_id,thread_id,cc,rfc_message_id,references_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[msgId,convId,ev,direction,String(p.sender||""),String(p.recipient||""),String(p.subject||""),String(p.body||""),read?1:0,ts,now(),String(p.source||provider),p.channel||"email",localAccountId,String(p.thread_id||ext),String(p.cc||""),String(p.rfc_message_id||""),j(p.references||[])]);
  await c.execute("UPDATE conversations SET last_message_at=GREATEST(COALESCE(last_message_at,''),?),unread_count=unread_count+?,updated_at=? WHERE id=?",[ts,direction==="in"&&!read?1:0,now(),convId]);
  await c.execute("INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES(?,?,?,?,?,?)",["message."+direction,"conversation",convId,String(p.subject||p.body||"הודעה חדשה").slice(0,160),j({source:provider}),now()]);
  await c.commit();return {inserted:true,conversation_id:convId,message_id:msgId,account_id:localAccountId};
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}

async function search(q,max=30){q=String(q||"").trim();if(!q)return[];const like="%"+q+"%",out=[];for(const s of [["project","projects","id","name","category","CONCAT_WS(' ',description,next_step,repo_full_name)"],["client","clients","id","name","company","CONCAT_WS(' ',phone,email,notes)"],["system","systems","did","did","status","notes"],["task","tasks","id","title","priority","notes"],["conversation","conversations","id","title","channel","external_id"],["account","accounts","id","label","type","CONCAT_WS(' ',identifier,notes)"]]){const [e,t,k,title,sub,body]=s;const [r]=await db.execute(`SELECT ${k} entity_id,${title} title,${sub} subtitle FROM ${t} WHERE ${title} LIKE ? OR ${sub} LIKE ? OR ${body} LIKE ? LIMIT 12`,[like,like,like]);out.push(...r.map(x=>({entity_type:e,entity_id:String(x.entity_id),title:String(x.title||""),subtitle:String(x.subtitle||"")})));}return out.slice(0,max);}

export class WorkspaceService{
 async call(op,p={}){
  const entity=op.split(".")[0];
  if(["project","client","task","account"].includes(entity)&&/\.(create|update)$/.test(op)){
   let resetWorker=false;
   if(op.endsWith(".update")){
    if(!p.id)throw Error("id_required");
    const [rows]=await db.execute(`SELECT * FROM ${entity}s WHERE id=?`,[String(p.id)]);
    if(!rows[0])throw Error(entity+"_not_found");
    const previous=rows[0];
    if(entity==="project"){previous.modules=parse(previous.modules_json||"[]");previous.custom_fields=parse(previous.custom_fields_json||"{}");}
    else previous.project_ids=await relIds(entity,p.id,"project");
    if(entity==="task")resetWorker=["title","notes","automation_mode","project_ids"].some(k=>p[k]!==undefined&&JSON.stringify(p[k])!==JSON.stringify(previous[k]));
    p={...previous,...p};
    if(resetWorker){p.worker_state="idle";p.worker_result="";p.reset_worker=true;}
   }else if(p.id)throw Error("create_id_not_allowed");
   if(["project","client"].includes(entity)&&!String(p.name||"").trim())throw Error("name_required");
   if(entity==="task"){
    if(!String(p.title||"").trim())throw Error("title_required");
    if(!["manual","ai","ai_draft"].includes(p.automation_mode||"manual"))throw Error("invalid_automation_mode");
    if(!["open","in_progress","done","cancelled"].includes(p.status||"open"))throw Error("invalid_task_status");
   }
  }
  if(op==="task.get"){const [r]=await db.execute("SELECT * FROM tasks WHERE id=?",[String(p.id||"")]);if(!r[0])return {ok:false,error:"task_not_found"};r[0].project_ids=await relIds("task",p.id,"project");return {ok:true,item:r[0]};}
  if(op==="conversation.update"){
   const [rows]=await db.execute("SELECT * FROM conversations WHERE id=?",[String(p.id||"")]);if(!rows[0])throw Error("conversation_not_found");
   for(const field of ["client_id","project_id"]){if(p[field]===undefined)continue;const table=field==="client_id"?"clients":"projects";if(p[field]){const [found]=await db.execute(`SELECT id FROM ${table} WHERE id=?`,[String(p[field])]);if(!found.length)throw Error("association_not_found");}await db.execute(`UPDATE conversations SET ${field}=?,updated_at=? WHERE id=?`,[String(p[field]||""),now(),p.id]);}return {ok:true};
  }
  if(op==="system.create"||op==="system.update"){
   const did=String(p.did||"").trim();if(!/^[+0-9-]{3,40}$/.test(did))throw Error("invalid_did");
   const [rows]=await db.execute("SELECT * FROM systems WHERE did=?",[did]);const d={...rows[0],...p};
   await db.execute(`INSERT INTO systems(did,status,project_id,client_id,notes,updated_at) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),project_id=VALUES(project_id),client_id=VALUES(client_id),notes=VALUES(notes),updated_at=VALUES(updated_at)`,[did,d.status||"active",d.project_id||"",d.client_id||"",d.notes||"",now()]);return {ok:true,id:did};
  }
  if(op==="note.list"){const [items]=await db.execute("SELECT * FROM crm_notes WHERE entity_type=? AND entity_id=? ORDER BY updated_at DESC",[String(p.entity_type||""),String(p.entity_id||"")]);return {ok:true,items};}
  if(op==="note.create"){
   if(!p.entity_type||!p.entity_id||!String(p.body||"").trim())throw Error("note_fields_required");
   const key=id("note");await db.execute("INSERT INTO crm_notes(id,entity_type,entity_id,title,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",[key,p.entity_type,p.entity_id,p.title||"",p.body,now(),now()]);return {ok:true,id:key};
  }

  if(op==="status"){const counts={};for(const t of ["projects","clients","systems","tasks","conversations","messages"]){const [r]=await db.query(`SELECT COUNT(*) n FROM ${t}`);counts[t]=Number(r[0]?.n||0);}return {ok:true,service:"aharon-crm-node",counts,time:now()};}
  if(op==="search")return {ok:true,results:await search(p.q,lim(p.limit,25,50))};
  if(["project.list","client.list","system.list","task.list","conversation.list","account.list"].includes(op)){
   const table=entity==="system"?"systems":entity+"s",where=[],values=[];
   if(entity==="project")where.push("deleted_at IS NULL");
   const columns={project:["status"],client:["status"],system:["status","project_id","client_id"],task:["status"],conversation:["channel","client_id","project_id","account_id"],account:["type","status"]}[entity];
   for(const key of columns)if(p[key]){where.push(`e.${key}=?`);values.push(String(p[key]));}
   if(p.project_id&&["task","client","account"].includes(entity)){where.push("EXISTS(SELECT 1 FROM entity_relations r WHERE r.from_type=? AND r.from_id=e.id AND r.to_type='project' AND r.to_id=?)");values.push(entity,String(p.project_id));}
   if(entity==="conversation"&&p.unread_only)where.push("unread_count>0");
   if(p.q){const fields={project:["name","description","next_step"],client:["name","phone","email","notes"],system:["did","notes"],task:["title","notes"],conversation:["title"],account:["label","identifier"]}[entity];where.push("("+fields.map(f=>`e.${f} LIKE ?`).join(" OR ")+")");values.push(...fields.map(()=>"%"+String(p.q)+"%"));}
   const order=entity==="conversation"?"last_message_at":"updated_at";
   const [items]=await db.execute(`SELECT e.* ${entity==="conversation"?",a.type AS account_type,a.integration_key,a.label AS account_label":""} FROM ${table} e ${entity==="conversation"?"LEFT JOIN accounts a ON a.id=e.account_id":""} ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY e.${order} DESC LIMIT ${lim(p.limit,100,200)}`,values);
   for(const item of items){if(["client","task","account"].includes(entity))item.project_ids=await relIds(entity,item.id,"project");if(entity==="project"){item.modules=parse(item.modules_json||"[]");item.custom_fields=parse(item.custom_fields_json||"{}");}}
   return {ok:true,items};
  }
  if(op==="project.get"){const [r]=await db.execute("SELECT * FROM projects WHERE id=?",[String(p.id||"")]);return r[0]?{ok:true,item:{...r[0],modules:parse(r[0].modules_json||"[]"),custom_fields:parse(r[0].custom_fields_json||"{}")}}:{ok:false,error:"project_not_found"};}
  if(op==="client.get"){const [r]=await db.execute("SELECT * FROM clients WHERE id=?",[String(p.id||"")]);if(!r[0])return {ok:false,error:"client_not_found"};r[0].project_ids=await relIds("client",r[0].id,"project");return {ok:true,item:r[0]};}
  if(op==="system.get"){const [r]=await db.execute("SELECT * FROM systems WHERE did=?",[String(p.did||"")]);return r[0]?{ok:true,item:r[0]}:{ok:false,error:"system_not_found"};}
  if(op==="activity.list"){const [items]=await db.query(`SELECT * FROM activities ORDER BY id DESC LIMIT ${lim(p.limit,50,100)}`);return {ok:true,items};}
  if(op==="conversation.get"){const [c]=await db.execute("SELECT * FROM conversations WHERE id=?",[String(p.id||"")]);if(!c[0])return {ok:false,error:"conversation_not_found"};const [messages]=await db.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY sent_at ASC",[String(p.id||"")]);return {ok:true,item:c[0],messages};}
  if(op==="project.create"||op==="project.update")return {ok:true,id:await saveProject(p)};
  if(op==="client.create"||op==="client.update")return {ok:true,id:await saveClient(p)};
  if(op==="task.create"||op==="task.update"){const key=await saveTask(p);if(p.reset_worker)await db.execute("UPDATE tasks SET worker_attempts=0,worker_claim=NULL,worker_retry_at=NULL WHERE id=?",[key]);return {ok:true,id:key};}
  if(op==="account.create"||op==="account.update")return {ok:true,id:await saveAccount(p)};
  if(op==="message.ingest")return {ok:true,...await ingestMessage(p)};
  if(op==="activity.add"){await activity(String(p.event||"external.event"),String(p.entity_type||"integration"),String(p.entity_id||""),String(p.title||"External event"),p.metadata||{});return {ok:true};}
  if(op==="conversation.read"){await db.execute("UPDATE messages SET is_read=1 WHERE conversation_id=?",[String(p.id||"")]);await db.execute("UPDATE conversations SET unread_count=0,updated_at=? WHERE id=?",[now(),String(p.id||"")]);return {ok:true};}
  throw Error("Unknown Workspace operation: "+op);
 }
}
