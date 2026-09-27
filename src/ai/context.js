import {db} from "../db.js";
import {config} from "../config.js";
import {emailOf,phoneOf} from "../message-format.js";

// No suffix/empty-phone matching: ambiguous matches must be associated by the user.
export async function findClient(messages){
 for(const m of [...messages].reverse().filter(m=>m.direction==="in")){
  const email=emailOf(m.sender),phone=phoneOf(m.sender);let rows=[];
  if(email)[rows]=await db.execute("SELECT * FROM clients WHERE LOWER(email)=? LIMIT 2",[email]);
  else if(phone)[rows]=await db.execute("SELECT * FROM clients WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'+',''),'(',''),')','')=? LIMIT 2",[phone]);
  if(rows.length===1)return rows[0];
 }
 return null;
}

// Retain valid JSON and the newest message; reserve budget for every category.
export function serializeContext(data,maxChars){
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
 while(JSON.stringify(out).length>maxChars){const entries=Object.entries(out).filter(([,v])=>Array.isArray(v)&&v.length);if(!entries.length)break;entries.sort((a,b)=>JSON.stringify(b[1]).length-JSON.stringify(a[1]).length);out[entries[0][0]].pop();out.truncated=true;}
 return JSON.stringify(out);
}
export async function buildCrmContext({conversationId="",taskId="",query=""}={}){
 const ctx={conversation:null,latest_message:null,client:null,task:null,projects:[],tasks:[],systems:[],notes:[],messages:[],previous_messages:[],activities:[],related_search:[]};
 const projectIds=new Set();let clientId="";
 if(conversationId){
  const [rows]=await db.execute("SELECT * FROM conversations WHERE id=?",[conversationId]);
  if(!rows[0])throw Error("conversation_not_found");ctx.conversation=rows[0];clientId=rows[0].client_id||"";if(rows[0].project_id)projectIds.add(rows[0].project_id);
  const [messages]=await db.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY sent_at DESC",[conversationId]);
  ctx.messages=messages;ctx.latest_message=messages[0]||null;
  if(!clientId){ctx.client=await findClient(messages);clientId=ctx.client?.id||"";}
 }
 if(taskId){
  const [rows]=await db.execute("SELECT * FROM tasks WHERE id=?",[taskId]);if(!rows[0])throw Error("task_not_found");ctx.task=rows[0];
  const [relations]=await db.execute("SELECT to_id FROM entity_relations WHERE from_type='task' AND from_id=? AND to_type='project'",[taskId]);for(const r of relations)projectIds.add(r.to_id);
 }
 if(clientId){
  if(!ctx.client){const [rows]=await db.execute("SELECT * FROM clients WHERE id=?",[clientId]);ctx.client=rows[0]||null;}
  const [relations]=await db.execute("SELECT to_id FROM entity_relations WHERE from_type='client' AND from_id=? AND to_type='project'",[clientId]);for(const r of relations)projectIds.add(r.to_id);
  const [previous]=await db.execute("SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.client_id=? AND c.id<>? ORDER BY m.sent_at DESC LIMIT 100",[clientId,conversationId]);ctx.previous_messages=previous;
  if(ctx.client?.email){const [previousEmail]=await db.execute("SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE (c.client_id IS NULL OR c.client_id='') AND c.id<>? AND (LOWER(m.sender)=? OR LOWER(m.sender) LIKE ?) ORDER BY m.sent_at DESC LIMIT 50",[conversationId,ctx.client.email.toLowerCase(),"%<"+ctx.client.email.toLowerCase()+">"]);ctx.previous_messages.push(...previousEmail);}
 }
 if(projectIds.size){
  const ids=[...projectIds],marks=ids.map(()=>"?").join(",");
  [ctx.projects]=await db.execute(`SELECT * FROM projects WHERE id IN (${marks}) AND deleted_at IS NULL`,ids);
  [ctx.tasks]=await db.execute(`SELECT DISTINCT t.* FROM tasks t JOIN entity_relations r ON r.from_type='task' AND r.from_id=t.id AND r.to_type='project' WHERE r.to_id IN (${marks}) ORDER BY t.updated_at DESC LIMIT 100`,ids);
  [ctx.systems]=await db.execute(`SELECT * FROM systems WHERE project_id IN (${marks})`,ids);
 }
 if(clientId){const [systems]=await db.execute("SELECT * FROM systems WHERE client_id=?",[clientId]);ctx.systems=[...ctx.systems,...systems].filter((x,i,a)=>a.findIndex(y=>y.did===x.did)===i);}
 const entities=[conversationId,taskId,clientId,...projectIds,...ctx.tasks.map(t=>t.id),...ctx.systems.map(s=>s.did)].filter(Boolean);
 if(entities.length){
  const marks=entities.map(()=>"?").join(",");
  [ctx.notes]=await db.execute(`SELECT * FROM crm_notes WHERE entity_id IN (${marks}) ORDER BY updated_at DESC LIMIT 100`,entities);
  [ctx.activities]=await db.execute(`SELECT * FROM activities WHERE entity_id IN (${marks}) ORDER BY id DESC LIMIT 60`,entities);
 }
 const terms=String(query||ctx.latest_message?.body||ctx.task?.title||"").toLowerCase().split(/\s+/).filter(t=>t.length>=3).slice(0,8);
 ctx.related_search=[...ctx.projects,...ctx.tasks,...ctx.notes,...ctx.systems].filter(x=>terms.some(t=>JSON.stringify(x).toLowerCase().includes(t))).slice(0,12);
 return {data:ctx,text:serializeContext(ctx,config.localAiMaxContextChars)};
}
