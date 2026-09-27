import {randomUUID} from "node:crypto";
import {db,now} from "./db.js";
import {draftReply} from "./ai/local-ai.js";
import {ConnectorsClient} from "./clients/connectors.js";
import {WorkspaceService} from "./workspace-service.js";
import {emailOf} from "./message-format.js";
const connectors=new ConnectorsClient(),workspace=new WorkspaceService();

export async function createDraft({conversationId,instruction="",tone=""}){
 const r=await draftReply({conversationId,instruction,tone:tone||"אנושי, מקצועי, ברור וקצר"});
 const draftId="draft_"+randomUUID(),ts=now();
 await db.execute("INSERT INTO message_drafts(id,conversation_id,body,instruction,provider,model,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",[draftId,conversationId,r.draft,instruction,r.provider,r.model,"draft",ts,ts]);
 return {ok:true,id:draftId,...r};
}
export async function listDrafts(conversationId){const [items]=await db.execute("SELECT * FROM message_drafts WHERE conversation_id=? ORDER BY created_at DESC LIMIT 20",[conversationId]);return items;}

export async function sendConversationReply({conversationId,body,draftId="",requestId},dependencies={}){
 const database=dependencies.db||db,send=dependencies.send||((...args)=>connectors.send(...args)),ingest=dependencies.ingest||((event)=>workspace.call("message.ingest",event));
 if(!String(body||"").trim())throw Error("body_required");
 if(!/^[a-zA-Z0-9_-]{16,64}$/.test(requestId||""))throw Error("request_id_required");
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
 const [claim]=await database.execute("INSERT IGNORE INTO outgoing_sends(id,conversation_id,status,created_at,updated_at) VALUES(?,?,'sending',?,?)",[requestId,conversationId,now(),now()]);
 if(!claim.affectedRows){
  const [old]=await database.execute("SELECT * FROM outgoing_sends WHERE id=?",[requestId]);
  if(old[0]?.conversation_id!==conversationId)throw Error("request_id_conflict");
  if(old[0]?.status==="sent")return JSON.parse(old[0].result_json);
  throw Error("send_pending_or_uncertain_check_provider_before_retry");
 }
 let sent;
 try{
  sent=await send(channel,payload);if(!sent?.ok||!sent.message_id)throw Error("send_not_confirmed");
  await ingest({type:"message",source:provider+"."+(provider==="google"?"gmail":provider==="hostinger"?"smtp":"baileys"),channel:conv.channel,account_id:externalAccountId,account:{provider,type:conv.channel==="whatsapp"?"whatsapp":"email",identifier:account.identifier,label:account.label},conversation_external_id:conv.external_id,external_id:sent.message_id,thread_id:sent.thread_id||inbound.thread_id,rfc_message_id:provider==="hostinger"?sent.message_id:"",references:payload.references||[],direction:"out",sender:account.identifier,recipient:payload.to,subject:payload.subject||"",body,is_read:true,sent_at:now(),client_id:conv.client_id,project_id:conv.project_id});
  if(draftId)await database.execute("UPDATE message_drafts SET status='sent',updated_at=? WHERE id=? AND conversation_id=?",[now(),draftId,conversationId]);
  const result={ok:true,...sent};await database.execute("UPDATE outgoing_sends SET status='sent',result_json=?,updated_at=? WHERE id=?",[JSON.stringify(result),now(),requestId]);return result;
 }catch(error){await database.execute("UPDATE outgoing_sends SET status='uncertain',updated_at=? WHERE id=?",[now(),requestId]);throw error;}
}
