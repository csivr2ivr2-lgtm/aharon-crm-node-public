import {randomUUID,createHash} from "node:crypto";
import {db,now} from "./db.js";
import {draftReply} from "./ai/local-ai.js";
import {ConnectorsClient} from "./clients/connectors.js";
import {WorkspaceService} from "./workspace-service.js";
import {emailOf} from "./message-format.js";
import {audit} from "./platform/audit.js";
const connectors=new ConnectorsClient(),workspace=new WorkspaceService();

export async function createDraft({conversationId,instruction="",tone="",idempotencyKey="",expectedLatestMessageId="",reminderId="",signal},dependencies={}){
 const database=dependencies.db||db,generate=dependencies.draftReply||draftReply;
 const draftId=idempotencyKey?"draft_"+createHash("sha256").update(idempotencyKey).digest("hex").slice(0,40):"draft_"+randomUUID();
 const saved=async()=>{const [rows]=await database.execute("SELECT * FROM message_drafts WHERE id=?",[draftId]);return rows[0]?{ok:true,id:draftId,draft:rows[0].body,provider:rows[0].provider,model:rows[0].model}:null;};
 if(idempotencyKey){const existing=await saved();if(existing)return existing;}
 async function guard(connection,lock=false){
  if(signal?.aborted)throw Error("background_claim_lost");
  if(!expectedLatestMessageId&&!reminderId)return true;
  const [conversations]=await connection.execute("SELECT id FROM conversations WHERE id=?"+(lock?" FOR UPDATE":""),[conversationId]);if(!conversations.length)return false;
  if(expectedLatestMessageId){const [latest]=await connection.execute("SELECT id FROM messages WHERE conversation_id=? ORDER BY sent_at DESC,id DESC LIMIT 1",[conversationId]);if(latest[0]?.id!==expectedLatestMessageId)return false;}
  if(reminderId){const [reminders]=await connection.execute("SELECT id FROM reminders WHERE id=? AND conversation_id=? AND status='notified'"+(lock?" FOR UPDATE":""),[reminderId,conversationId]);if(!reminders.length)return false;}
  return true;
 }
 if(!await guard(database))return {ok:true,skipped:true,reason:"followup_no_longer_needed"};
 const r=await generate({conversationId,instruction,tone:tone||"אנושי, מקצועי, ברור וקצר"});
 const connection=await database.getConnection();try{
  await connection.beginTransaction();
  if(!await guard(connection,true)){await connection.commit();return {ok:true,skipped:true,reason:"followup_no_longer_needed"};}
  const ts=now(),[insert]=await connection.execute("INSERT IGNORE INTO message_drafts(id,conversation_id,body,instruction,provider,model,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",[draftId,conversationId,r.draft,instruction,r.provider,r.model,"draft",ts,ts]);
  if(insert.affectedRows)await audit({action:"draft.created",source:reminderId?"followup":"draft",actor:reminderId?"worker":"dashboard",mode:"ai",entityType:"draft",entityId:draftId,after:{conversation_id:conversationId,provider:r.provider,model:r.model},confirmation:"required_before_send"},{db:connection});
  await connection.commit();return insert.affectedRows?{ok:true,id:draftId,...r}:await saved();
 }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
export async function listDrafts(conversationId){const [items]=await db.execute("SELECT * FROM message_drafts WHERE conversation_id=? ORDER BY created_at DESC LIMIT 20",[conversationId]);return items;}

export async function sendConversationReply({conversationId,body,draftId="",requestId},dependencies={}){
 const database=dependencies.db||db,send=dependencies.send||((...args)=>connectors.send(...args)),ingest=dependencies.ingest||((event)=>workspace.call("message.ingest",event));
 if(!String(body||"").trim())throw Error("body_required");
 if(!/^[a-zA-Z0-9_-]{16,64}$/.test(requestId||""))throw Error("request_id_required");
 const requestHash=createHash("sha256").update(JSON.stringify({conversationId,body,draftId})).digest("hex");
 const replay=row=>{
  if(row.conversation_id!==conversationId||row.request_hash&&row.request_hash!==requestHash)throw Error("request_id_conflict");
  if(row.status==="sent")return JSON.parse(row.result_json);
  throw Error("send_pending_or_uncertain_check_provider_before_retry");
 };
 // Replay before draft validation: successful drafts are already marked sent.
 const [previous]=await database.execute("SELECT * FROM outgoing_sends WHERE id=?",[requestId]);
 if(previous[0])return replay(previous[0]);
 const [rows]=await database.execute("SELECT * FROM conversations WHERE id=?",[conversationId]);const conv=rows[0];if(!conv)throw Error("conversation_not_found");
 const [accounts]=await database.execute("SELECT * FROM accounts WHERE id=?",[conv.account_id]);const account=accounts[0];if(!account)throw Error("account_not_found");
 const [messages]=await database.execute("SELECT * FROM messages WHERE conversation_id=? AND direction='in' ORDER BY sent_at DESC LIMIT 1",[conversationId]);const inbound=messages[0];if(!inbound)throw Error("conversation_has_no_incoming_message");
 if(draftId){const [drafts]=await database.execute("SELECT id FROM message_drafts WHERE id=? AND conversation_id=? AND status='draft'",[draftId,conversationId]);if(!drafts.length)throw Error("invalid_draft");}
 const key=String(account.integration_key||""),provider=key.split(":")[0],externalAccountId=key.slice(provider.length+1);
 let channel,payload={body};
 if(provider==="google"||provider==="hostinger"){
  const to=emailOf(inbound.sender);if(!to)throw Error("invalid_reply_recipient");
  let references=[];try{references=JSON.parse(inbound.references_json||"[]");}catch{}
  if(inbound.rfc_message_id)references.push(inbound.rfc_message_id);
  payload={...payload,to,account_id:externalAccountId,subject:/^re:/i.test(inbound.subject||"")?inbound.subject:"Re: "+String(inbound.subject||""),thread_id:inbound.thread_id?.replace(/^gmail:[^:]+:/,""),in_reply_to:inbound.rfc_message_id||"",references:[...new Set(references)]};channel=provider==="google"?"gmail":"hostinger";
 }else if(provider==="whatsapp"){channel="whatsapp";payload.to=conv.external_id;}else throw Error("unsupported_conversation_channel");
 const [claim]=await database.execute("INSERT IGNORE INTO outgoing_sends(id,conversation_id,status,request_hash,created_at,updated_at) VALUES(?,?,'sending',?,?,?)",[requestId,conversationId,requestHash,now(),now()]);
 if(!claim.affectedRows){
  const [old]=await database.execute("SELECT * FROM outgoing_sends WHERE id=?",[requestId]);
  if(!old[0])throw Error("send_claim_missing");
  return replay(old[0]);
 }
 // A draft itself is a second idempotency boundary, even across different requests.
 if(draftId){
  const [reserved]=await database.execute("UPDATE message_drafts SET status='sending',updated_at=? WHERE id=? AND conversation_id=? AND status='draft'",[now(),draftId,conversationId]);
  if(reserved.affectedRows!==1){
   await database.execute("UPDATE outgoing_sends SET status='rejected',updated_at=? WHERE id=?",[now(),requestId]);
   throw Error("draft_already_sending_or_used");
  }
 }
 let sent;
 try{
  sent=await send(channel,payload);if(!sent?.ok||!sent.message_id)throw Error("send_not_confirmed");
  await ingest({type:"message",source:provider+"."+(provider==="google"?"gmail":provider==="hostinger"?"smtp":"baileys"),channel:conv.channel,account_id:externalAccountId,account:{provider,type:conv.channel==="whatsapp"?"whatsapp":"email",identifier:account.identifier,label:account.label},conversation_external_id:conv.external_id,external_id:sent.message_id,thread_id:sent.thread_id||inbound.thread_id,rfc_message_id:provider==="hostinger"?sent.message_id:"",references:payload.references||[],direction:"out",sender:account.identifier,recipient:payload.to,subject:payload.subject||"",body,is_read:true,sent_at:now(),client_id:conv.client_id,project_id:conv.project_id});
  if(draftId)await database.execute("UPDATE message_drafts SET status='sent',updated_at=? WHERE id=? AND conversation_id=?",[now(),draftId,conversationId]);
  const result={ok:true,...sent};await database.execute("UPDATE outgoing_sends SET status='sent',result_json=?,updated_at=? WHERE id=?",[JSON.stringify(result),now(),requestId]);return result;
 }catch(error){
  await database.execute("UPDATE outgoing_sends SET status='uncertain',updated_at=? WHERE id=?",[now(),requestId]);
  if(draftId)await database.execute("UPDATE message_drafts SET status='uncertain',updated_at=? WHERE id=? AND conversation_id=? AND status='sending'",[now(),draftId,conversationId]);
  throw error;
 }
}
