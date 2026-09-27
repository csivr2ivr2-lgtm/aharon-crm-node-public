import {ImapFlow} from "imapflow";
import nodemailer from "nodemailer";
import {simpleParser} from "mailparser";
import {emailOf} from "../message-format.js";
import {config} from "../config.js";

function enabled(){return config.hostingerMailEnabled&&Boolean(config.hostingerMailUser&&config.hostingerMailPassword)}
function addresses(value){return value?.value?.map(x=>x.address).filter(Boolean).join(", ")||""}

export class HostingerMailConnector{
 configured(){return enabled()}
 status(){return {key:"hostinger-mail",configured:this.configured(),account:config.hostingerMailUser||null,imap:config.hostingerImapHost,smtp:config.hostingerSmtpHost}}
 client(){return new ImapFlow({host:config.hostingerImapHost,port:config.hostingerImapPort,secure:config.hostingerImapSecure,auth:{user:config.hostingerMailUser,pass:config.hostingerMailPassword},logger:false})}
 transporter(){return nodemailer.createTransport({host:config.hostingerSmtpHost,port:config.hostingerSmtpPort,secure:config.hostingerSmtpSecure,auth:{user:config.hostingerMailUser,pass:config.hostingerMailPassword},pool:true,maxConnections:2,maxMessages:100})}

 async sync(){
  if(!this.configured())return [];
  const c=this.client(),events=[];
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
     const self=String(config.hostingerMailUser).toLowerCase();
     const fromSelf=emailOf(from)===self;
     events.push({
      id:"hostinger:"+messageId,type:"message",source:"hostinger.imap",channel:"email",
      account_id:config.hostingerMailUser,
      account:{provider:"hostinger",type:"email",identifier:config.hostingerMailUser,label:"Hostinger · "+config.hostingerMailUser},
      conversation_external_id:"email:"+String(refs[0]||mail.inReplyTo||messageId),
      external_id:messageId,rfc_message_id:messageId,references:refs,thread_id:String(refs[0]||mail.inReplyTo||messageId),direction:fromSelf?"out":"in",sender:from,recipient:to,cc,subject:String(mail.subject||""),
      body:String(mail.text||""),is_read:Boolean(meta?.flags?.has("\\Seen")),sent_at:(mail.date||new Date()).toISOString()
     });
    }catch(error){events.push({id:"hostinger-error:"+uid,type:"sync.error",source:"hostinger.imap",title:"Hostinger mail parse failed",error:error.message})}
   }
  }finally{lock?.release();await c.logout().catch(()=>{})}
  return events;
 }

 async send({to,subject="",body="",cc="",replyTo="",in_reply_to="",references=[]}){
  if(!this.configured())throw Error("Hostinger Mail is not configured");
  const tx=this.transporter();try{
   const info=await tx.sendMail({from:config.hostingerMailUser,to,cc:cc||undefined,replyTo:replyTo||undefined,subject,text:body,inReplyTo:in_reply_to||undefined,references:references.length?references:undefined});
   if(!info.accepted?.length)throw Error("smtp_recipient_rejected");
   return {ok:true,message_id:String(info.messageId||""),accepted:info.accepted||[],rejected:info.rejected||[]};
  }finally{tx.close()}
 }
}
export const hostingerMail=new HostingerMailConnector();
