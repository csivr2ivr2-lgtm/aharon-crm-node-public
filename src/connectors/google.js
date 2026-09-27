import {simpleParser} from "mailparser";
import {emailOf,safeHeader} from "../message-format.js";
import { google } from "googleapis";
import { config } from "../config.js";
import { createOauthState, verifyOauthState } from "./security.js";

const header=(headers,name)=>String((headers||[]).find(h=>String(h.name||"").toLowerCase()===name.toLowerCase())?.value||"");
const publicAccount=a=>({id:a.id,email:a.email,name:a.name||"",connected_at:a.connected_at||""});
export function mimeMessage({to,subject,body,from,cc="",in_reply_to="",references=[]}){
 for(const value of [to,subject,from,cc,in_reply_to,...references])safeHeader(value);
 const enc=v=>"=?UTF-8?B?"+Buffer.from(String(v),"utf8").toString("base64")+"?=";
 return Buffer.from(["MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","To: "+to,...(from?["From: "+from]:[]),...(cc?["Cc: "+cc]:[]),...(in_reply_to?["In-Reply-To: "+in_reply_to]:[]),...(references.length?["References: "+references.join(" ")]:[]),"Subject: "+enc(subject),"",Buffer.from(String(body),"utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n")||""].join("\r\n"),"utf8").toString("base64url");
}

export class GoogleConnector{
 constructor(vault){this.vault=vault;this.disconnectedIds=new Set();}
 configured(){return Boolean(config.googleClientId&&config.googleClientSecret&&config.googleRedirectUri);}
 oauthClient(tokens={},onTokens){
  const c=new google.auth.OAuth2(config.googleClientId,config.googleClientSecret,config.googleRedirectUri);
  c.setCredentials(tokens); if(onTokens)c.on("tokens",fresh=>{Promise.resolve(onTokens(fresh)).catch(()=>{this.tokenPersistenceError=true;});}); return c;
 }
 authUrl(accountHint=""){if(!this.configured())throw Error("Google connector not configured");const state=createOauthState({account_hint:accountHint});return this.oauthClient().generateAuthUrl({access_type:"offline",prompt:"consent",scope:config.googleScopes,state,login_hint:accountHint||undefined});}
 async callback(code,stateRaw){
  verifyOauthState(stateRaw); const client=this.oauthClient(); const {tokens}=await client.getToken(code); client.setCredentials(tokens);
  const oauth=google.oauth2({version:"v2",auth:client}); const info=(await oauth.userinfo.get()).data;
  const id=String(info.id||info.email||"").trim(); if(!id)throw Error("Google account id missing");
  const old=await this.vault.get("google:"+id);
  const record={id,email:String(info.email||""),name:String(info.name||""),tokens:{...(old?.tokens||{}),...tokens},connected_at:old?.connected_at||new Date().toISOString(),updated_at:new Date().toISOString()};
  await this.vault.set("google:"+id,record);this.disconnectedIds.delete(id); return publicAccount(record);
 }
 async disconnect(id){const account=await this.accountRecord(id);this.disconnectedIds.add(account.id);await this.vault.delete("google:"+account.id);return {ok:true,id:account.id};}
 async accounts(){return (await this.vault.entries("google:")).map(x=>publicAccount(x.value));}
 async accountRecord(id=""){
  if(id){const v=await this.vault.get("google:"+id);if(!v)throw Error("Google account not found");return v;}
  const all=await this.vault.entries("google:");if(all.length===0)throw Error("No Google account is connected");if(all.length>1)throw Error("account_id is required");return all[0].value;
 }
 async clientFor(record){
  let current=record; return this.oauthClient(record.tokens,async fresh=>{if(!fresh||!Object.keys(fresh).length||this.disconnectedIds.has(record.id))return;current={...current,tokens:{...current.tokens,...fresh},updated_at:new Date().toISOString()};await this.vault.set("google:"+current.id,current);});
 }
 async gmailRecent({account_id="",max_results=20,q=""}={}){
  const account=await this.accountRecord(account_id),auth=await this.clientFor(account),gmail=google.gmail({version:"v1",auth});
  const list=await gmail.users.messages.list({userId:"me",maxResults:Math.min(100,Math.max(1,Number(max_results||20))),q:q||undefined});
  const messages=[];
  const ids=new Set(),threads=new Set();
  for(const entry of list.data.messages||[]){
   if(!entry.threadId){if(entry.id)ids.add(entry.id);continue;}
   if(threads.has(entry.threadId))continue;threads.add(entry.threadId);
   const thread=(await gmail.users.threads.get({userId:"me",id:entry.threadId,format:"minimal"})).data;
   for(const m of thread.messages||[])if(m.id)ids.add(m.id);
  }
  for(const id of ids){
   const item=(await gmail.users.messages.get({userId:"me",id,format:"raw"})).data;
   const mail=await simpleParser(Buffer.from(item.raw||"","base64url"),{skipTextToHtml:true});
   const d=new Date(Number(item.internalDate||Date.now()));
   messages.push({id:item.id,thread_id:item.threadId,from:mail.from?.text||"",to:mail.to?.text||"",cc:mail.cc?.text||"",subject:mail.subject||"",message_id:mail.messageId||"",references:Array.isArray(mail.references)?mail.references:mail.references?[mail.references]:[],body:String(mail.text||""),unread:(item.labelIds||[]).includes("UNREAD"),sent_at:d.toISOString()});
  }
  return {ok:true,account:publicAccount(account),messages};
 }
 async calendarUpcoming({account_id="",max_results=20}={}){
  const account=await this.accountRecord(account_id),auth=await this.clientFor(account),calendar=google.calendar({version:"v3",auth});
  const r=await calendar.events.list({calendarId:"primary",timeMin:new Date().toISOString(),singleEvents:true,orderBy:"startTime",maxResults:Math.min(50,Math.max(1,Number(max_results||20)))});
  return {ok:true,account:publicAccount(account),events:(r.data.items||[]).map(e=>({id:e.id,summary:e.summary||"",description:e.description||"",start:e.start?.dateTime||e.start?.date||"",end:e.end?.dateTime||e.end?.date||"",location:e.location||"",html_link:e.htmlLink||""}))};
 }
 async driveSearch({account_id="",q="",max_results=20}={}){
  const account=await this.accountRecord(account_id),auth=await this.clientFor(account),drive=google.drive({version:"v3",auth}),safe=String(q||"").replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  const r=await drive.files.list({q:"trashed=false and name contains '"+safe+"'",pageSize:Math.min(50,Math.max(1,Number(max_results||20))),fields:"files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))",orderBy:"modifiedTime desc"});
  return {ok:true,account:publicAccount(account),files:r.data.files||[]};
 }
 async sendEmail({account_id="",to,subject,body,cc="",thread_id="",in_reply_to="",references=[]}){
  const account=await this.accountRecord(account_id),auth=await this.clientFor(account),gmail=google.gmail({version:"v1",auth});
  const r=await gmail.users.messages.send({userId:"me",requestBody:{raw:mimeMessage({to,subject,body,cc,from:account.email,in_reply_to,references}),...(thread_id?{threadId:thread_id}:{})}});
  return {ok:true,account:publicAccount(account),message_id:r.data.id,thread_id:r.data.threadId};
 }
 async sync(){
  const events=[]; for(const account of await this.accounts()){try{const recent=await this.gmailRecent({account_id:account.id,max_results:config.googleSyncMaxResults,q:config.googleSyncQuery});for(const m of recent.messages){const fromSelf=emailOf(m.from)===account.email.toLowerCase();events.push({id:"gmail:"+account.id+":"+m.id,type:"message",source:"google.gmail",channel:"email",account_id:account.id,account:{provider:"google",type:"email",identifier:account.email,label:account.name||account.email},conversation_external_id:"gmail:"+account.id+":"+(m.thread_id||m.id),external_id:m.id,thread_id:m.thread_id,direction:fromSelf?"out":"in",sender:m.from,recipient:m.to,cc:m.cc,rfc_message_id:m.message_id,references:m.references,subject:m.subject,body:m.body,is_read:!m.unread,sent_at:m.sent_at});}}catch(error){events.push({id:"google-sync-error:"+account.id+":"+Date.now(),type:"sync.error",source:"google.gmail",account_id:account.id,title:"Google sync failed",error:"google_sync_failed"});}}
  return events;
 }
}

