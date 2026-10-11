import makeWASocket,{DisconnectReason,useMultiFileAuthState,getContentType} from "@whiskeysockets/baileys";
import {Boom} from "@hapi/boom";
import QRCode from "qrcode";
import {mkdir,rm} from "node:fs/promises";
import {config} from "../config.js";

export function whatsappDestination(value){
 const raw=String(value||"").trim();
 if(/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(raw)||/^\d{5,20}(?:-\d{5,20})?@g\.us$/.test(raw)||/^\d{5,20}@lid$/.test(raw))return raw;
 if(!/^\+?[\d ()-]+$/.test(raw))throw Error("invalid_whatsapp_recipient");
 const digits=raw.replace(/\D/g,"");if(!/^[1-9]\d{6,14}$/.test(digits))throw Error("invalid_whatsapp_recipient");
 return digits+"@s.whatsapp.net";
}
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

export function pairingPhoneNumber(input){
 const number=String(input||"").trim();
 if(!/^[1-9]\d{7,14}$/.test(number))throw Error("invalid_whatsapp_pairing_number");
 return number;
}
export class WhatsAppConnector{
 constructor(){this.sock=null;this.statusValue="disabled";this.qrDataUrl=null;this.onEvent=null;this.connecting=false;this.stopped=false;this.retryTimer=null;this.lastError=null;this.credentialWrites=Promise.resolve();this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.qrReady=false}
 configured(){return config.whatsappEnabled}
 status(){return {key:"whatsapp",configured:this.configured(),status:this.statusValue,qr:this.qrDataUrl,pairing_code:this.pairingCode,last_error:this.lastError}}
 async pairWithPhone(number,onEvent=this.onEvent){
  if(!this.configured())throw Error("whatsapp_not_enabled");
  const phone=pairingPhoneNumber(number);
  if(this.sock?.authState?.creds?.registered||this.statusValue==="connected")throw Error("whatsapp_already_connected");
  if(this.pairingPhone&&this.pairingPhone!==phone&&this.pairingRequested)throw Error("whatsapp_pairing_in_progress");
  this.pairingPhone=phone;this.pairingCode=null;this.pairingRequested=false;
  if(this.sock&&this.qrReady)await this.preparePairingCode(this.sock);
  else if(!this.sock)await this.start(onEvent);
  return {ok:true,...this.status()};
 }
 async preparePairingCode(sock){
  if(this.sock!==sock||this.stopped||!this.pairingPhone||this.pairingRequested||sock.authState?.creds?.registered)return;
  this.pairingRequested=true;this.statusValue="pairing_pending";this.qrDataUrl=null;
  try{
   const code=await sock.requestPairingCode(this.pairingPhone);
   if(this.sock===sock&&!this.stopped){this.pairingCode=String(code||"");this.statusValue="pairing_code_ready";this.lastError=null;}
  }catch{
   if(this.sock===sock&&!this.stopped){this.pairingRequested=false;this.statusValue="error";this.lastError="whatsapp_pairing_failed";}
  }
 }
 async start(onEvent){
  this.stopped=false;this.onEvent=onEvent;if(!this.configured()||this.sock||this.connecting)return;
  this.connecting=true;this.qrReady=false;clearTimeout(this.retryTimer);this.statusValue="connecting";this.lastError=null;
  try{
   await mkdir(config.whatsappSessionDir,{recursive:true,mode:0o700});
   const {state,saveCreds}=await useMultiFileAuthState(config.whatsappSessionDir);
   const sock=makeWASocket({auth:state,markOnlineOnConnect:false,syncFullHistory:false,generateHighQualityLinkPreview:false,logger:{level:"silent",child(){return this},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}}});
   if(this.stopped){sock.end?.(new Error("shutdown"));return;}
   this.sock=sock;this.statusValue="connecting";
   sock.ev.on("creds.update",()=>{this.credentialWrites=this.credentialWrites.then(async()=>{if(this.sock===sock&&!this.stopped)await saveCreds();}).catch(()=>{this.lastError="credentials_save_failed";});});
   sock.ev.on("connection.update",async update=>{
    if(this.sock!==sock||this.stopped)return;
    if(update.qr){
     this.qrReady=true;
     if(this.pairingPhone){await this.preparePairingCode(sock);}
     else try{const qr=await QRCode.toDataURL(update.qr);if(this.sock!==sock||this.stopped)return;this.qrDataUrl=qr;this.statusValue="qr_required";}catch{this.lastError="qr_generation_failed";this.statusValue="error";}
    }
    if(update.connection==="open"){this.statusValue="connected";this.qrDataUrl=null;this.pairingCode=null;this.pairingPhone=null;this.pairingRequested=false;this.lastError=null}
    if(update.connection==="close"){
     this.sock=null;this.qrReady=false;const code=new Boom(update.lastDisconnect?.error).output?.statusCode;
     this.statusValue=code===DisconnectReason.loggedOut?"logged_out":"disconnected";
     this.qrDataUrl=null;
     if(code!==DisconnectReason.loggedOut&&!this.stopped){this.statusValue="reconnecting";clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.start(this.onEvent).catch(()=>{this.lastError="reconnect_failed";this.statusValue="error";}),5000);this.retryTimer.unref?.();}
    }
   });
   sock.ev.on("messages.upsert",async ({messages,type})=>{
    if(this.sock!==sock||this.stopped||!Array.isArray(messages))return;
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
  }catch{this.lastError="connection_failed";this.statusValue="error";throw Error("whatsapp_connection_failed");}finally{this.connecting=false}
 }
 stop(){this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.sock;this.sock=null;this.qrReady=false;this.qrDataUrl=null;this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.statusValue="disconnected";sock?.end?.(new Error("shutdown"));}
 async disconnect(){this.stop();return {ok:true,...this.status()};}
 async reconnect(onEvent=this.onEvent){this.stop();await this.start(onEvent);return {ok:true,...this.status()};}
 async logout(){
  this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.sock;this.sock=null;this.qrReady=false;this.qrDataUrl=null;this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.statusValue="disconnected";
  try{await sock?.logout();}catch{this.lastError="logout_failed";throw Error("whatsapp_logout_failed");}finally{sock?.end?.(new Error("logout"));}
  // Removing stored credentials also works when there is no active socket.
  await this.credentialWrites;
  await rm(config.whatsappSessionDir,{recursive:true,force:true});this.statusValue="logged_out";this.lastError=null;
 }
 async deleteSession(){await this.logout();return {ok:true,...this.status()};}
 async send({to,body}){if(!this.sock||this.statusValue!=="connected")throw Error("WhatsApp is not connected");const jid=whatsappDestination(to);if(!String(body||"").trim())throw Error("body_required");const r=await this.sock.sendMessage(jid,{text:String(body)});return {ok:true,message_id:String(r?.key?.id||""),jid};}
}
export const whatsapp=new WhatsAppConnector();
