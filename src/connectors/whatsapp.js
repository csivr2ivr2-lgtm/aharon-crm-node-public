import makeWASocket,{DisconnectReason,useMultiFileAuthState,getContentType,normalizeMessageContent} from "@whiskeysockets/baileys";
import {Boom} from "@hapi/boom";
import QRCode from "qrcode";
import {mkdir,rm} from "node:fs/promises";
import {config} from "../config.js";
import {pairingPhoneNumber} from "./whatsapp-phone.js";
import {isWhatsAppChannelJid,isWhatsAppConversationJid} from "./whatsapp-channel-filter.js";
import {isLidJid,isGroupJid,safeWhatsAppName,safeWhatsAppPn,whatsappPeerTitle} from './whatsapp-identity.js';

export function whatsappDestination(value){
 const raw=String(value||"").trim();
 if(/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(raw)||/^\d{5,20}(?:-\d{5,20})?@g\.us$/.test(raw)||/^\d{5,20}@lid$/.test(raw))return raw;
 if(!/^\+?[\d ()-]+$/.test(raw))throw Error("invalid_whatsapp_recipient");
 const digits=raw.replace(/\D/g,"");if(!/^[1-9]\d{6,14}$/.test(digits))throw Error("invalid_whatsapp_recipient");
 return digits+"@s.whatsapp.net";
}
export const textFrom=m=>{
 const x=normalizeMessageContent(m?.message);if(!x)return"";
 const t=getContentType(x);
 if(t==="conversation")return String(x.conversation||"");
 if(t==="extendedTextMessage")return String(x.extendedTextMessage?.text||"");
 if(t==="imageMessage")return String(x.imageMessage?.caption||"");
 if(t==="videoMessage")return String(x.videoMessage?.caption||"");
 if(t==="documentMessage")return String(x.documentMessage?.caption||x.documentMessage?.fileName||"");
 return "";
};

export class WhatsAppConnector{
 constructor({sessionId="whatsapp-main",sessionDir=config.whatsappSessionDir,label="WhatsApp"}={}){this.sessionId=sessionId;this.sessionDir=sessionDir;this.label=label;this.sock=null;this.statusValue="disabled";this.qrDataUrl=null;this.onEvent=null;this.connecting=false;this.stopped=false;this.retryTimer=null;this.lastError=null;this.credentialWrites=Promise.resolve();this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.qrReady=false;this.peerNames=new Map();this.peerPhones=new Map();this.groupRequests=new Set()}
 configured(){return config.whatsappEnabled}
 status(){return {key:"whatsapp",id:this.sessionId,label:this.label,configured:this.configured(),status:this.statusValue,qr:this.qrDataUrl,pairing_code:this.pairingCode,last_error:this.lastError}}
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
   await mkdir(this.sessionDir,{recursive:true,mode:0o700});
   const {state,saveCreds}=await useMultiFileAuthState(this.sessionDir);
   const sock=makeWASocket({auth:state,markOnlineOnConnect:false,syncFullHistory:false,generateHighQualityLinkPreview:false,logger:{level:"silent",child(){return this},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}}});
   if(this.stopped){sock.end?.(new Error("shutdown"));return;}
   this.sock=sock;this.statusValue="connecting";
   this.groupRequests.clear();
   sock.ev.on("creds.update",()=>{this.credentialWrites=this.credentialWrites.then(async()=>{if(this.sock===sock&&!this.stopped)await saveCreds();}).catch(()=>{this.lastError="credentials_save_failed";});});
   sock.ev.on("connection.update",async update=>{
    if(this.sock!==sock||this.stopped)return;
    if(update.qr){
     this.qrReady=true;
     if(this.pairingPhone){await this.preparePairingCode(sock);}
     else try{const qr=await QRCode.toDataURL(update.qr);if(this.sock!==sock||this.stopped)return;this.qrDataUrl=qr;this.statusValue="qr_required";}catch{this.lastError="qr_generation_failed";this.statusValue="error";}
    }
    if(this.sock!==sock||this.stopped)return;
    if(update.connection==="open"){this.statusValue="connected";this.qrDataUrl=null;this.pairingCode=null;this.pairingPhone=null;this.pairingRequested=false;this.lastError=null}
    if(update.connection==="close"){
     this.sock=null;this.qrReady=false;const code=new Boom(update.lastDisconnect?.error).output?.statusCode;
     this.statusValue=code===DisconnectReason.loggedOut?"logged_out":"disconnected";
     this.qrDataUrl=null;
     if(code!==DisconnectReason.loggedOut&&!this.stopped){this.statusValue="reconnecting";clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.start(this.onEvent).catch(()=>{this.lastError="reconnect_failed";this.statusValue="error";}),5000);this.retryTimer.unref?.();}
    }
   });
   sock.ev.on("messages.upsert",batch=>this.receiveMessages(sock,batch));
   for(const event of ['contacts.upsert','contacts.update'])
    sock.ev.on(event,items=>{void this.consumeContacts(sock,items).catch(()=>{this.lastError='contact_metadata_failed';});});
   for(const event of ['groups.upsert','groups.update'])
    sock.ev.on(event,items=>{void this.consumeGroups(sock,items).catch(()=>{this.lastError='group_metadata_failed';});});
   for(const event of ['chats.upsert','chats.update'])
    sock.ev.on(event,items=>{void this.consumeChats(sock,items).catch(()=>{this.lastError='chat_metadata_failed';});});
   sock.ev.on('messaging-history.set',history=>{
    void Promise.all([this.consumeContacts(sock,history?.contacts),this.consumeChats(sock,history?.chats),this.consumeGroups(sock,history?.groups)]).catch(()=>{this.lastError='history_metadata_failed';});
   });
  }catch{this.lastError="connection_failed";this.statusValue="error";throw Error("whatsapp_connection_failed");}finally{this.connecting=false}
 }

 async rememberPeer(sock,jid,{name='',phoneJid=''}={}){
  if(this.sock!==sock||this.stopped||!isWhatsAppConversationJid(jid))return;
  const cleanName=safeWhatsAppName(name),pn=isLidJid(jid)?safeWhatsAppPn(phoneJid):'';
  if(!cleanName&&!pn)return;
  if(cleanName)this.peerNames.set(jid,cleanName);
  if(pn)this.peerPhones.set(jid,pn);
  await this.onEvent?.({type:'whatsapp.profile',source:'whatsapp.baileys',account_id:this.sessionId,
   jid,name:cleanName,phone_jid:pn});
 }
 async consumeContacts(sock,contacts){
  if(this.sock!==sock||!Array.isArray(contacts))return;
  for(const c of contacts.slice(0,2000)){
   const jid=String(c?.id||'').toLowerCase();
   if(!isWhatsAppConversationJid(jid)||isGroupJid(jid))continue;
   const other=String(isLidJid(jid)?c?.phoneNumber||c?.pn||'':c?.lid||'').toLowerCase();
   await this.rememberPeer(sock,jid,{name:c?.name||c?.notify||c?.verifiedName||'',phoneJid:other});
   if(isLidJid(other)&&safeWhatsAppPn(jid))await this.rememberPeer(sock,other,{name:c?.name||c?.notify||'',phoneJid:jid});
  }
 }
 async consumeGroups(sock,groups){
  if(this.sock!==sock||!Array.isArray(groups))return;
  for(const g of groups.slice(0,500)){
   const jid=String(g?.id||'').toLowerCase();
   if(isGroupJid(jid))await this.rememberPeer(sock,jid,{name:g.subject||g.name||g.notify||''});
  }
 }
 async consumeChats(sock,chats){
  if(this.sock!==sock||!Array.isArray(chats))return;
  for(const c of chats.slice(0,1000)){
   const jid=String(c?.id||'').toLowerCase();
   if(isWhatsAppConversationJid(jid))await this.rememberPeer(sock,jid,{name:c?.name||c?.subject||''});
  }
 }
 async resolveGroupName(sock,jid){
  if(this.groupRequests.has(jid)||typeof sock.groupMetadata!=='function')return;
  this.groupRequests.add(jid);
  try{const info=await sock.groupMetadata(jid);if(info?.subject)await this.rememberPeer(sock,jid,{name:info.subject});}
  catch{/* Group metadata might be unavailable. Preserve the group JID. */}
 }
 async knownPhone(sock,jid,alt){
  const existing=safeWhatsAppPn(alt)||this.peerPhones.get(jid)||'';
  if(existing||!isLidJid(jid))return existing;
  try{
   const store=sock.signalRepository?.lidMapping,resolver=store?.getPNForLID;
   if(typeof resolver==='function')return safeWhatsAppPn(await resolver.call(store,jid));
  }catch{/* Older Baileys versions and old history may lack the mapping. */}
  return '';
 }
 async receiveMessages(sock,{messages,type}={}){
    if(this.sock!==sock||this.stopped||!Array.isArray(messages))return;
    if(type!=="notify"&&type!=="append")return;
    for(const m of messages){
     try{
     if(!m?.key?.remoteJid||isWhatsAppChannelJid(m.key.remoteJid)||!isWhatsAppConversationJid(m.key.remoteJid))continue;
     const content=normalizeMessageContent(m.message);
     if(!content)continue;
     const contentType=getContentType(content);
     // Protocol traffic is not a new human message. Preserve recognized reactions
     // as events while keeping them out of the meaningful conversation clock.
     let eventType=contentType==='reactionMessage'?'reaction':
      ['protocolMessage','senderKeyDistributionMessage'].includes(contentType)?'technical':'';
     const body=contentType==='reactionMessage'?String(content.reactionMessage?.text||''):textFrom(m);if(!body&&!m.message)continue;
     let timestamp=Number(m.messageTimestamp);
     if(!Number.isFinite(timestamp)||timestamp<=0||timestamp*1000>Date.now()+300000){this.lastError="invalid_message_timestamp";timestamp=0;if(!eventType)eventType="timestamp_review";}
     const jid=String(m.key.remoteJid).toLowerCase(),direction=m.key.fromMe?"out":"in";
     if(isGroupJid(jid))void this.resolveGroupName(sock,jid);
     const pn=await this.knownPhone(sock,jid,m.key.remoteJidAlt);
     if(pn&&!this.peerPhones.has(jid))await this.rememberPeer(sock,jid,{phoneJid:pn});
     const participant=String(m.key.participant||'').toLowerCase();
     const participantPn=safeWhatsAppPn(m.key.participantAlt)||safeWhatsAppPn(participant)||
      (isLidJid(participant)?await this.knownPhone(sock,participant,''):'');
     const actualSender=isGroupJid(jid)?(participantPn||participant||jid):pn||jid;
     const title=whatsappPeerTitle({jid,name:this.peerNames.get(jid),phoneJid:pn});
     const event={id:"wa:"+this.sessionId+":"+String(m.key.id||Date.now()),type:"message",source:"whatsapp.baileys",channel:"whatsapp",account_id:this.sessionId,
      account:{provider:"whatsapp",type:"whatsapp",identifier:this.sessionId,label:this.label},
      conversation_external_id:jid,conversation_title:title,external_id:String(m.key.id||""),direction,
      sender:direction==="in"?actualSender:"me",recipient:direction==="out"?pn||jid:"me",
      subject:"",body,inbox_event_type:eventType,is_read:direction==="out"||Boolean(eventType),sent_at:new Date(timestamp*1000).toISOString()};
     await this.onEvent?.(event);
     }catch{this.lastError="message_ingestion_failed";}
    }
 }

 stop(){this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.sock;this.sock=null;this.qrReady=false;this.qrDataUrl=null;this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.statusValue="disconnected";sock?.end?.(new Error("shutdown"));}
 async disconnect(){this.stop();return {ok:true,...this.status()};}
 async reconnect(onEvent=this.onEvent){this.stop();await this.start(onEvent);return {ok:true,...this.status()};}
 async logout(){
  this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.sock;this.sock=null;this.qrReady=false;this.qrDataUrl=null;this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.statusValue="disconnected";
  try{await sock?.logout();}catch{this.lastError="logout_failed";throw Error("whatsapp_logout_failed");}finally{sock?.end?.(new Error("logout"));}
  // Removing stored credentials also works when there is no active socket.
  await this.credentialWrites;
  await rm(this.sessionDir,{recursive:true,force:true});this.statusValue="logged_out";this.lastError=null;
 }
 async deleteSession(){await this.logout();return {ok:true,...this.status()};}
 async send({to,body}){if(!this.sock||this.statusValue!=="connected")throw Error("WhatsApp is not connected");const jid=whatsappDestination(to);if(!String(body||"").trim())throw Error("body_required");const r=await this.sock.sendMessage(jid,{text:String(body)});if(!r?.key?.id)throw Error("send_not_confirmed");return {ok:true,message_id:String(r.key.id),jid};}
}

