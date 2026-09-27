import {ImapFlow} from "imapflow";
import nodemailer from "nodemailer";
import {simpleParser} from "mailparser";
import {EncryptedVault} from "./vault.js";
import {resolve} from "node:path";
import {emailOf,safeHeader} from "../message-format.js";
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
     const refs=Array.isArray(mail.references)?mail.references:mail.references?[mail.references]:[];
     const from=addresses(mail.from),to=addresses(mail.to),cc=addresses(mail.cc);
     const self=String(settings.user).toLowerCase();
     const fromSelf=emailOf(from)===self;
     events.push({
      id:"hostinger:"+messageId,type:"message",source:"hostinger.imap",channel:"email",
      account_id:settings.user,
      account:{provider:"hostinger",type:"email",identifier:settings.user,label:"Hostinger · "+settings.user},
      conversation_external_id:"email:"+String(refs[0]||mail.inReplyTo||messageId),
      external_id:messageId,rfc_message_id:messageId,references:refs,thread_id:String(refs[0]||mail.inReplyTo||messageId),direction:fromSelf?"out":"in",sender:from,recipient:to,cc,subject:String(mail.subject||""),
      body:String(mail.text||""),is_read:Boolean(meta?.flags?.has("\\Seen")),sent_at:(mail.date||new Date()).toISOString()
     });
    }catch(error){events.push({id:"hostinger-error:"+uid,type:"sync.error",source:"hostinger.imap",title:"Hostinger mail parse failed",error:"mail_message_parse_failed"})}
   }
  }finally{lock?.release();await c.logout().catch(()=>{})}
  return events;
 }

 async send({account_id="",to,subject="",body="",cc="",replyTo="",in_reply_to="",references=[]}){
  if(!Array.isArray(references))throw Error("invalid_mail_references");
  [to,subject,cc,replyTo,in_reply_to]=[to,subject,cc,replyTo,in_reply_to].map(safeHeader);references=references.map(safeHeader);
  if(!this.configured())throw Error("Hostinger Mail is not configured");
  if(account_id&&String(account_id).toLowerCase()!==this.settings().user.toLowerCase())throw Error("mail_account_mismatch");
  const tx=this.transporter();try{
   const info=await tx.sendMail({from:this.settings().user,to,cc:cc||undefined,replyTo:replyTo||undefined,subject,text:String(body||""),inReplyTo:in_reply_to||undefined,references:references.length?references:undefined});
   if(!info.accepted?.length)throw Error("smtp_recipient_rejected");
   return {ok:true,message_id:String(info.messageId||""),accepted:info.accepted||[],rejected:info.rejected||[]};
  }finally{tx.close()}
 }
}
export const hostingerMail=new HostingerMailConnector();

