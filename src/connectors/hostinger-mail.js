import {imapObservedState} from '../mail-provider-state.js';
import {imapHistoryScope,readImapHistoryCursor,imapHistoryBefore,imapHistoryCursor} from '../imap-history-cursor.js';
import {inboxHeaders} from '../ai/inbox-headers.js';
import {imapFolderOverview} from '../mail-folder-overview.js';
import {ImapFlow} from "imapflow";
import {syncIssue} from "../sync-diagnostics.js";
import nodemailer from "nodemailer";
import {simpleParser} from "mailparser";
import {describeMailAttachments} from "../mail-attachment-metadata.js";
import {EncryptedVault} from "./vault.js";
import {resolve} from "node:path";
import {emailOf,safeHeader,mailReferences} from "../message-format.js";
import {config} from "../config.js";

function enabled(){return config.hostingerMailEnabled&&Boolean(config.hostingerMailUser&&config.hostingerMailPassword)}
function addresses(value){return value?.value?.map(x=>x.address).filter(Boolean).join(", ")||""}

export class HostingerMailConnector{
 constructor({vault=new EncryptedVault(resolve(config.dataDir,"hostinger-vault.enc")),imapFactory=options=>new ImapFlow(options),smtpFactory=options=>nodemailer.createTransport(options)}={}){this.vault=vault;this.imapFactory=imapFactory;this.smtpFactory=smtpFactory;this.account=null;this.disabled=false;this.initialized=false;}
 async initialize(){if(this.initialized)return;const saved=await this.vault.get("hostinger:account");this.disabled=saved?.disconnected===true;this.account=saved?.email&&saved?.password?saved:null;this.initialized=true;}
 settings(){return this.account?{user:this.account.email,password:this.account.password,imapHost:"imap.hostinger.com",imapPort:993,imapSecure:true,smtpHost:"smtp.hostinger.com",smtpPort:465,smtpSecure:true}:{user:config.hostingerMailUser,password:config.hostingerMailPassword,imapHost:config.hostingerImapHost,imapPort:config.hostingerImapPort,imapSecure:config.hostingerImapSecure,smtpHost:config.hostingerSmtpHost,smtpPort:config.hostingerSmtpPort,smtpSecure:config.hostingerSmtpSecure};}
 configured(){return !this.disabled&&Boolean(this.account||enabled());}
 status(){const s=this.settings();return {key:"hostinger-mail",configured:this.configured(),status:this.configured()?"connected":"disconnected",account:this.disabled?null:s.user||null,imap:s.imapHost,smtp:s.smtpHost};}
 client(settings=this.settings()){return this.imapFactory({host:settings.imapHost,port:settings.imapPort,secure:settings.imapSecure,auth:{user:settings.user,pass:settings.password},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});}
 transporter(settings=this.settings()){return this.smtpFactory({host:settings.smtpHost,port:settings.smtpPort,secure:settings.smtpSecure,requireTLS:!settings.smtpSecure,disableFileAccess:true,disableUrlAccess:true,auth:{user:settings.user,pass:settings.password},pool:true,maxConnections:2,maxMessages:100,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});}
 async configure({email,password}={}){
  const user=String(email||"").trim().toLowerCase(),pass=String(password||"");
  if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(user)||user.length>254)throw Error("invalid_email");
  if(!pass||pass.length>4096)throw Error("password_required");
  const candidate={user,password:pass,imapHost:"imap.hostinger.com",imapPort:993,imapSecure:true,smtpHost:"smtp.hostinger.com",smtpPort:465,smtpSecure:true};
  const client=this.client(candidate),tx=this.transporter(candidate);
  try{await client.connect();await tx.verify();}catch{throw Error("mail_connection_failed");}finally{await client.logout().catch(()=>{});tx.close();}
  const record={email:user,password:pass,connected_at:new Date().toISOString()};
  await this.vault.set("hostinger:account",record);this.account=record;this.disabled=false;this.initialized=true;
  return {ok:true,...this.status()};
 }
 async disconnect(){await this.vault.set("hostinger:account",{disconnected:true});this.account=null;this.disabled=true;this.initialized=true;return {ok:true,...this.status()};}

 async downloadMessageRaw({account_id,state,maxBytes}){
  await this.initialize();
  if(!this.configured())throw Error('hostinger_account_not_connected');
  if(account_id!==this.settings().user)throw Error('mail_account_mismatch');
  if(state?.protocol!=='imap'||typeof state.folder!=='string'||!state.folder||state.folder.length>1024||
   !/^[1-9][0-9]*$/.test(String(state.uid))||!/^[1-9][0-9]*$/.test(String(state.uid_validity)))throw Error('imap_attachment_location_missing');
  const c=this.client();let lock;
  try{
   await c.connect();lock=await c.getMailboxLock(state.folder,{readOnly:true});
   if(String(c.mailbox.uidValidity)!==String(state.uid_validity))throw Error('imap_uid_validity_changed');
   const {content}=await c.download(state.uid,undefined,{uid:true,maxBytes:maxBytes+1});
   const chunks=[];let total=0;
   for await(const part of content){const chunk=Buffer.from(part);total+=chunk.length;
    if(total>maxBytes){content.destroy();throw Error('mail_message_too_large');}chunks.push(chunk);}
   return Buffer.concat(chunks,total);
  }finally{lock?.release();await c.logout().catch(()=>{});}
 }
 async folders(){
  await this.initialize();
  if(!this.configured())throw Error('hostinger_account_not_connected');
  const client=this.client();
  try{
   await client.connect();
   const result=await imapFolderOverview(client);
   return {...result,account:this.settings().user};
  }finally{await client.logout().catch(()=>{});}
 }
 async sync(){
  if(!this.configured())return [];
  const settings=this.settings(),c=this.client(settings),events=[];
  let lock;
  try{
   await c.connect();
   lock=await c.getMailboxLock("INBOX");
   const since=new Date(Date.now()-config.hostingerMailSyncDays*86400000);
   const uids=(await c.search({since},{uid:true}))||[];
   const recent=uids.slice(-Math.min(200,uids.length));
   for(const uid of recent){
    try{
     const {content}=await c.download(uid,undefined,{uid:true});
     const mail=await simpleParser(content,{skipHtmlToText:false,skipTextToHtml:true,maxHtmlLengthToParse:1024*1024});
     const messageId=String(mail.messageId||"uid-"+String(c.mailbox.uidValidity)+"-"+uid);
     const meta=await c.fetchOne(uid,{flags:true},{uid:true});
     const refs=mailReferences(mail);
     const from=addresses(mail.from),to=addresses(mail.to),cc=addresses(mail.cc);
     const self=String(settings.user).toLowerCase();
     const fromSelf=emailOf(from)===self;
     events.push({
      id:"hostinger:"+messageId,type:"message",source:"hostinger.imap",channel:"email",
      account_id:settings.user,
      account:{provider:"hostinger",type:"email",identifier:settings.user,label:"Hostinger · "+settings.user},
      conversation_external_id:"email:"+String(refs[0]||mail.inReplyTo||messageId),
      headers:inboxHeaders(mail.headers),external_id:messageId,rfc_message_id:messageId,references:refs,thread_id:String(refs[0]||mail.inReplyTo||messageId),direction:fromSelf?"out":"in",sender:from,recipient:to,cc,subject:String(mail.subject||""),
      provider_state:imapObservedState("INBOX",uid,c.mailbox.uidValidity,meta),attachments:describeMailAttachments(mail),body:String(mail.text||""),is_read:Boolean(meta?.flags?.has("\\Seen")),sent_at:(mail.date||new Date()).toISOString()
     });
    }catch(error){events.push({...syncIssue("hostinger.imap","parse",error,settings.user),message_index:String(uid).slice(0,30)});}
   }
  }finally{lock?.release();await c.logout().catch(()=>{})}
  return events;
 }


 // Crawl every accessible IMAP folder in bounded UID pages. No delete/flag mutation.
 async historyPage({cursor='',limit=10}={}){
  if(!this.configured())throw Error('hostinger_account_not_connected');
  const settings=this.settings(),c=this.client(settings);
  const size=Math.max(1,Math.min(15,Math.trunc(Number(limit)||10)));
  await c.connect();
  try{
   const folders=(await c.list()).filter(f=>!f.flags?.has('\\Noselect')&&!f.flags?.has('\\NonExistent')).map(f=>f.path);
   folders.sort((a,b)=>Number(b.toUpperCase()==='INBOX')-Number(a.toUpperCase()==='INBOX')||a.localeCompare(b));
   const scope=imapHistoryScope(settings.user,folders),position=readImapHistoryCursor(cursor,scope);
   for(let folder=position.folder;folder<folders.length;folder++){
    const lock=await c.getMailboxLock(folders[folder]);
    try{
     const uids=((await c.search({all:true},{uid:true}))||[]).map(Number).filter(Number.isSafeInteger).sort((a,b)=>b-a);
     const before=imapHistoryBefore(position,folder,c.mailbox.uidValidity);
     const pending=uids.filter(n=>!before||n<before);
     if(!pending.length)continue;
     const selected=pending.slice(0,size),events=[];
     for(const uid of selected){
      const {content}=await c.download(uid,undefined,{uid:true});
      const mail=await simpleParser(content,{skipHtmlToText:false,skipTextToHtml:true,maxHtmlLengthToParse:1024*1024});
      const meta=await c.fetchOne(uid,{flags:true},{uid:true});
      const messageId=String(mail.messageId||'uid-'+String(c.mailbox.uidValidity)+'-'+uid+'-'+folders[folder]);
      const refs=mailReferences(mail);
      const from=addresses(mail.from),to=addresses(mail.to),cc=addresses(mail.cc);
      const fromSelf=emailOf(from)===String(settings.user).toLowerCase();
      events.push({id:'hostinger:'+messageId,type:'message',source:'hostinger.imap',channel:'email',account_id:settings.user,account:{provider:'hostinger',type:'email',identifier:settings.user,label:'Hostinger · '+settings.user},conversation_external_id:'email:'+String(refs[0]||mail.inReplyTo||messageId),headers:inboxHeaders(mail.headers),external_id:messageId,rfc_message_id:messageId,references:refs,thread_id:String(refs[0]||mail.inReplyTo||messageId),direction:fromSelf?'out':'in',sender:from,recipient:to,cc,subject:String(mail.subject||''),provider_state:imapObservedState(folders[folder],uid,c.mailbox.uidValidity,meta),attachments:describeMailAttachments(mail),body:String(mail.text||''),is_read:Boolean(meta?.flags?.has('\\Seen')),sent_at:(mail.date||new Date()).toISOString()});
     }
     const more=pending.length>selected.length;
     const next=more?{scope,folder,before_uid:selected.at(-1),uid_validity:c.mailbox.uidValidity}:{scope,folder:folder+1,before_uid:0,uid_validity:''};
     const done=!more&&folder+1>=folders.length;
     return {messages:events,next_cursor:done?'':imapHistoryCursor(next),done};
    }finally{lock.release();}
   }
   return {messages:[],next_cursor:'',done:true};
  }finally{await c.logout().catch(()=>{});}
 }
 async send({account_id="",to,subject="",body="",cc="",replyTo="",in_reply_to="",references=[]}){
  if(!Array.isArray(references))throw Error("invalid_mail_references");
  [to,subject,cc,replyTo,in_reply_to]=[to,subject,cc,replyTo,in_reply_to].map(safeHeader);references=references.map(safeHeader);
  if(!this.configured())throw Error("Hostinger Mail is not configured");
  if(account_id&&String(account_id).toLowerCase()!==this.settings().user.toLowerCase())throw Error("mail_account_mismatch");
  const tx=this.transporter();try{
   const info=await tx.sendMail({from:this.settings().user,to,cc:cc||undefined,replyTo:replyTo||undefined,subject,text:String(body||""),inReplyTo:in_reply_to||undefined,references:references.length?references:undefined});
   if(!info.accepted?.length)throw Error("smtp_recipient_rejected");
   return {ok:true,status:"smtp_accepted",delivery_confirmed:false,message_id:String(info.messageId||""),accepted:info.accepted||[],rejected:info.rejected||[]};
  }finally{tx.close()}
 }
}
export const hostingerMail=new HostingerMailConnector();


