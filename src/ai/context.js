import {db} from "../db.js";
import {config} from "../config.js";
import {emailOf,phoneOf} from "../message-format.js";
import {retrieveKnowledge} from "./knowledge.js";

// No suffix/empty-phone matching: ambiguous matches must be associated by the user.
export async function findClient(messages){
 const candidates=new Map();
 for(const m of [...messages].filter(m=>m.direction==="in")){
  const phone=phoneOf(m.sender),email=phone?"":emailOf(m.sender);let rows=[];
  if(email)[rows]=await db.execute("SELECT * FROM clients WHERE LOWER(email)=? LIMIT 2",[email]);
  else if(phone)[rows]=await db.execute("SELECT * FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'+',''),'(',''),')','')=? LIMIT 2",[phone]);
  for(const row of rows)candidates.set(row.id,row);
  if(candidates.size>1)return null;
 }
 return candidates.size===1?[...candidates.values()][0]:null;
}

// Retain valid JSON and the newest message; reserve budget for every category.
export function serializeContext(data,maxChars){
 maxChars=Math.max(20,Math.floor(Number(maxChars)||2000));
 const out={truncated:false};const keys=Object.keys(data);const budget=Math.max(100,Math.floor((maxChars-500)/keys.length));
 for(const key of keys){
  const value=data[key];
  if(JSON.stringify(value).length<=budget){out[key]=value;continue;}
  out.truncated=true;
  if(Array.isArray(value)){
   out[key]=[];
   for(const item of value){
    const copy={...item};for(const field of Object.keys(copy))if(typeof copy[field]==="string")copy[field]=copy[field].slice(0,Math.floor(budget/3));
    if(JSON.stringify([...out[key],copy]).length>budget)break;out[key].push(copy);
   }
  }else if(value&&typeof value==="object"){
   out[key]={};const fields=Object.keys(value),n=Math.max(20,Math.floor(budget/fields.length)-20);
   for(const field of fields)out[key][field]=typeof value[field]==="string"?value[field].slice(0,n):value[field];
  }else out[key]=String(value).slice(0,budget);
 }
 while(JSON.stringify(out).length>maxChars){
  out.truncated=true;
  const candidates=[];
  const scan=(value,parent,key)=>{
   if(typeof value==='string'&&value.length)candidates.push({parent,key,size:JSON.stringify(value).length,string:true});
   else if(Array.isArray(value)&&value.length)candidates.push({parent,key,size:JSON.stringify(value).length,string:false});
   else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))scan(v,value,k);
  };
  for(const [key,value] of Object.entries(out))scan(value,out,key);
  candidates.sort((a,b)=>b.size-a.size);const biggest=candidates[0];
  if(biggest){if(biggest.string)biggest.parent[biggest.key]=biggest.parent[biggest.key].slice(0,Math.floor(biggest.parent[biggest.key].length/2));else biggest.parent[biggest.key].pop();}
  else {const key=Object.keys(out).find(k=>k!=='truncated'&&k!=='latest_message')||Object.keys(out).find(k=>k!=='truncated');if(!key)break;delete out[key];}
 }

 return JSON.stringify(out);
}
export async function buildCrmContext({conversationId="",taskId="",query="",maxChars=config.localAiMaxContextChars}={}){
 const ctx={conversation:null,latest_message:null,client:null,task:null,projects:[],tasks:[],systems:[],notes:[],messages:[],previous_messages:[],activities:[],files:[],reminders:[],related_search:[]};
 const projectIds=new Set();let clientId="";
 if(conversationId){
  const [rows]=await db.execute("SELECT * FROM conversations WHERE id=?",[conversationId]);
  if(!rows[0])throw Error("conversation_not_found");ctx.conversation=rows[0];clientId=rows[0].client_id||"";if(rows[0].project_id)projectIds.add(rows[0].project_id);
  const [messages]=await db.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY sent_at DESC LIMIT 100",[conversationId]);
  ctx.messages=messages;ctx.latest_message=messages[0]||null;
  if(!clientId){ctx.client=await findClient(messages);clientId=ctx.client?.id||"";}
 }
 if(taskId){
  const [rows]=await db.execute("SELECT * FROM tasks WHERE id=?",[taskId]);if(!rows[0])throw Error("task_not_found");ctx.task=rows[0];
  const [relations]=await db.execute("SELECT to_id FROM entity_relations WHERE from_type='task' AND from_id=? AND to_type='project'",[taskId]);for(const r of relations.slice(0,30))projectIds.add(r.to_id);
 }
 if(clientId){
  if(!ctx.client){const [rows]=await db.execute("SELECT * FROM clients WHERE id=?",[clientId]);ctx.client=rows[0]||null;}
  const [relations]=await db.execute("SELECT to_id FROM entity_relations WHERE from_type='client' AND from_id=? AND to_type='project'",[clientId]);for(const r of relations.slice(0,30))projectIds.add(r.to_id);
  const [previous]=await db.execute("SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.client_id=? AND c.id<>? ORDER BY m.sent_at DESC LIMIT 100",[clientId,conversationId]);ctx.previous_messages=previous;

 }
 // Customer-facing retrieval excludes shared projects to prevent private data crossing clients.
 if(conversationId){
  if(!clientId)projectIds.clear();
  else for(const projectId of [...projectIds]){
   const [otherClients]=await db.execute("SELECT from_id FROM entity_relations WHERE from_type='client' AND to_type='project' AND to_id=? AND from_id<>? LIMIT 1",[projectId,clientId]);
   const [otherConversations]=await db.execute("SELECT id FROM conversations WHERE project_id=? AND client_id<>? AND client_id IS NOT NULL LIMIT 1",[projectId,clientId]);
   if(otherClients.length||otherConversations.length)projectIds.delete(projectId);
  }
 }
 if(projectIds.size){
  const ids=[...projectIds],marks=ids.map(()=>"?").join(",");
  [ctx.projects]=await db.execute(`SELECT * FROM projects WHERE id IN (${marks}) AND deleted_at IS NULL`,ids);
  [ctx.tasks]=await db.execute(`SELECT DISTINCT t.* FROM tasks t JOIN entity_relations r ON r.from_type='task' AND r.from_id=t.id AND r.to_type='project' WHERE r.to_id IN (${marks}) ORDER BY t.updated_at DESC LIMIT 30`,ids);
  [ctx.systems]=await db.execute(`SELECT * FROM systems WHERE project_id IN (${marks})`,ids);
 }
 if(clientId){const [systems]=await db.execute("SELECT * FROM systems WHERE client_id=?",[clientId]);ctx.systems=[...ctx.systems.filter(s=>!s.client_id||s.client_id===clientId),...systems].filter((x,i,a)=>a.findIndex(y=>y.did===x.did)===i);}
 if(conversationId&&clientId){
  const safeTasks=[];
  for(const task of ctx.tasks){const [foreign]=await db.execute("SELECT to_id FROM entity_relations WHERE from_type='task' AND from_id=? AND to_type='client' AND to_id<>? LIMIT 1",[task.id,clientId]);if(!foreign.length)safeTasks.push(task);}
  ctx.tasks=safeTasks;ctx.systems=ctx.systems.filter(s=>s.client_id===clientId);
 }
 const entities=[conversationId,taskId,clientId,...projectIds,...ctx.tasks.map(t=>t.id),...ctx.systems.map(s=>s.did)].filter(Boolean);
 if(entities.length){
  const marks=entities.map(()=>"?").join(",");
  [ctx.notes]=await db.execute(`SELECT * FROM crm_notes WHERE entity_id IN (${marks}) ORDER BY updated_at DESC LIMIT 100`,entities);
  [ctx.activities]=await db.execute(`SELECT * FROM activities WHERE entity_id IN (${marks}) ORDER BY id DESC LIMIT 60`,entities);
 }
 if(clientId){
  [ctx.files]=await db.execute("SELECT f.id,f.name,f.mime,f.updated_at,f.project_id,f.task_id,LEFT(fc.content,6000) AS content,fc.indexed_at FROM files f JOIN file_content fc ON fc.file_id=f.id AND fc.status='ready' WHERE f.client_id=? AND f.deleted_at IS NULL AND f.archived_at IS NULL ORDER BY f.updated_at DESC LIMIT 20",[clientId]);
  [ctx.reminders]=await db.execute("SELECT id,title,notes,due_at,status,task_id,project_id,updated_at FROM reminders WHERE client_id=? AND status='pending' ORDER BY due_at LIMIT 30",[clientId]);
 }else if(taskId&&!conversationId){
  [ctx.files]=await db.execute("SELECT f.id,f.name,f.mime,f.updated_at,f.project_id,f.task_id,LEFT(fc.content,6000) AS content,fc.indexed_at FROM files f JOIN file_content fc ON fc.file_id=f.id AND fc.status='ready' WHERE f.task_id=? AND f.deleted_at IS NULL AND f.archived_at IS NULL ORDER BY f.updated_at DESC LIMIT 20",[taskId]);
  [ctx.reminders]=await db.execute("SELECT id,title,notes,due_at,status,updated_at FROM reminders WHERE task_id=? AND status='pending' ORDER BY due_at LIMIT 30",[taskId]);
 }
 if(conversationId){
  const safeTasks=new Set(ctx.tasks.map(t=>t.id));
  const safeAssociation=item=>(!item.project_id||projectIds.has(item.project_id))&&(!item.task_id||safeTasks.has(item.task_id));
  ctx.files=ctx.files.filter(safeAssociation);ctx.reminders=ctx.reminders.filter(safeAssociation);
 }
 ctx.business_knowledge=await retrieveKnowledge({query:query||ctx.latest_message?.body||ctx.task?.title||"",maxChars:Math.min(4000,Math.floor(Number(maxChars||18000)/4))});
 const terms=String(query||ctx.latest_message?.body||ctx.task?.title||"").toLowerCase().split(/\s+/).filter(t=>t.length>=3).slice(0,8);
 ctx.related_search=[...ctx.projects,...ctx.tasks,...ctx.notes,...ctx.systems,...ctx.files,...ctx.reminders].filter(x=>terms.some(t=>JSON.stringify(x).toLowerCase().includes(t))).slice(0,12);
 ctx.sources=Object.entries(ctx).flatMap(([type,items])=>Array.isArray(items)?items.filter(x=>x?.id||x?.did).map(x=>({type,id:x.id||x.did})):[]).slice(0,100);
 for(const key of ['projects','tasks','systems','notes','activities','files','reminders'])ctx[key]=rankContext(ctx[key],terms);
 return {data:ctx,text:serializeContext(ctx,Math.min(64000,Math.max(2000,Number(maxChars)||config.localAiMaxContextChars)))};
}

export function rankContext(items,terms=[],clock=Date.now()){
 return [...new Map(items.map(x=>[x.id||x.did||JSON.stringify(x),x])).values()].map(item=>{
  const haystack=JSON.stringify(item).toLowerCase(),matches=terms.filter(t=>haystack.includes(t)).length;
  const timestamp=Date.parse(item.updated_at||item.created_at||item.sent_at||'');
  const age=Number.isFinite(timestamp)?Math.max(0,clock-timestamp)/86400000:365;
  return {item,score:matches*4+1/(1+age/7)};
 }).sort((a,b)=>b.score-a.score).map(x=>x.item);
}
