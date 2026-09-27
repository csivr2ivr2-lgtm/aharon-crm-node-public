import makeWASocket,{DisconnectReason,useMultiFileAuthState,getContentType} from "@whiskeysockets/baileys";
import {Boom} from "@hapi/boom";
import QRCode from "qrcode";
import {mkdir} from "node:fs/promises";
import {config} from "../config.js";

const textFrom=m=>{
 const x=m?.message;if(!x)return"";
 const t=getContentType(x);
 if(t==="conversation")return String(x.conversation||"");
 if(t==="extendedTextMessage")return String(x.extendedTextMessage?.text||"");
 if(t==="imageMessage")return String(x.imageMessage?.caption||"");
 if(t==="videoMessage")return String(x.videoMessage?.caption||"");
 if(t==="documentMessage")return String(x.documentMessage?.caption||x.documentMessage?.fileName||"");
 return "";
};

export class WhatsAppConnector{
 constructor(){this.sock=null;this.statusValue="disabled";this.qrDataUrl=null;this.onEvent=null;this.connecting=false;this.stopped=false;this.retryTimer=null;this.lastError=null}
 configured(){return config.whatsappEnabled}
 status(){return {key:"whatsapp",configured:this.configured(),status:this.statusValue,qr:this.qrDataUrl,last_error:this.lastError}}
 async start(onEvent){
  this.stopped=false;this.onEvent=onEvent;if(!this.configured()||this.sock||this.connecting)return;
  this.connecting=true;await mkdir(config.whatsappSessionDir,{recursive:true,mode:0o700});
  try{
   const {state,saveCreds}=await useMultiFileAuthState(config.whatsappSessionDir);
   const sock=makeWASocket({auth:state,markOnlineOnConnect:false,syncFullHistory:false,generateHighQualityLinkPreview:false,logger:{level:"silent",child(){return this},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}}});
   this.sock=sock;this.statusValue="connecting";
   sock.ev.on("creds.update",()=>{void saveCreds().catch(()=>{this.lastError="credentials_save_failed";});});
   sock.ev.on("connection.update",async update=>{
    if(update.qr){this.qrDataUrl=await QRCode.toDataURL(update.qr);this.statusValue="qr_required"}
    if(update.connection==="open"){this.statusValue="connected";this.qrDataUrl=null}
    if(update.connection==="close"){
     this.sock=null;const code=new Boom(update.lastDisconnect?.error).output?.statusCode;
     this.statusValue=code===DisconnectReason.loggedOut?"logged_out":"disconnected";
     this.qrDataUrl=null;
     if(code!==DisconnectReason.loggedOut&&!this.stopped){this.retryTimer=setTimeout(()=>this.start(this.onEvent).catch(()=>{this.lastError="reconnect_failed";}),5000);this.retryTimer.unref?.();}
    }
   });
   sock.ev.on("messages.upsert",async ({messages,type})=>{
    if(type!=="notify"&&type!=="append")return;
    for(const m of messages){
     if(!m?.key?.remoteJid||m.key.remoteJid==="status@broadcast")continue;
     const body=textFrom(m);if(!body&&!m.message)continue;
     const jid=String(m.key.remoteJid),direction=m.key.fromMe?"out":"in";
     const event={id:"wa:"+String(m.key.id||Date.now()),type:"message",source:"whatsapp.baileys",channel:"whatsapp",account_id:"whatsapp-main",
      account:{provider:"whatsapp",type:"whatsapp",identifier:"whatsapp-main",label:"WhatsApp"},
      conversation_external_id:jid,external_id:String(m.key.id||""),direction,sender:direction==="in"?jid:"me",recipient:direction==="out"?jid:"me",
      subject:"",body,is_read:direction==="out",sent_at:new Date(Number(m.messageTimestamp||Math.floor(Date.now()/1000))*1000).toISOString()};
     try{await this.onEvent?.(event)}catch{this.lastError="message_ingestion_failed";}
    }
   });
  }finally{this.connecting=false}
 }
 stop(){this.stopped=true;clearTimeout(this.retryTimer);const sock=this.sock;this.sock=null;sock?.end?.(new Error("shutdown"));}
 async logout(){this.stopped=true;clearTimeout(this.retryTimer);await this.sock?.logout();this.sock=null;this.qrDataUrl=null;this.statusValue="logged_out";}
 async send({to,body}){if(!this.sock||this.statusValue!=="connected")throw Error("WhatsApp is not connected");let jid=String(to||"").trim();if(!jid.includes("@"))jid=jid.replace(/\D/g,"")+"@s.whatsapp.net";const r=await this.sock.sendMessage(jid,{text:String(body||"")});return {ok:true,message_id:String(r?.key?.id||""),jid}}
}
export const whatsapp=new WhatsAppConnector();
