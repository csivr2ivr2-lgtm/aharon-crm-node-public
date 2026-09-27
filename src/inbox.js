import {randomUUID,createHash} from "node:crypto";
import {db,now} from "./db.js";
import {draftReply} from "./ai/local-ai.js";
import {ConnectorsClient} from "./clients/connectors.js";
import {WorkspaceService} from "./workspace-service.js";
import {emailOf} from "./message-format.js";
const connectors=new ConnectorsClient(),workspace=new WorkspaceService();

export async function createDraft({conversationId,instruction="",tone="",idempotencyKey=""}){
 const draftId=idempotencyKey?"draft_"+createHash("sha256").update(idempotencyKey).digest("hex").slice(0,40):"draft_"+randomUUID();
 if(idempotencyKey){const [existing]=await db.execute("SELECT * FROM message_drafts WHERE id=?",[draftId]);if(existing.length)return {ok:true,id:draftId,draft:existing[0].body,provider:existing[0].provider,model:existing[0].model};}
 const r=await draftReply({conversationId,instruction,tone:tone||"אנושי, מקצועי, ברור וקצר"});
 const ts=now();
 await db.execute("INSERT IGNORE INTO message_drafts(id,conversation_id,body,instruction,provider,model,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",[draftId,conversationId,r.draft,instruction,r.provider,r.model,"draft",ts,ts]);
 return {ok:true,id:draftId,...r};
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
