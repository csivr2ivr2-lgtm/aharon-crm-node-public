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
 constructor({sessionId="whatsapp-main",sessionDir=config.whatsappSessionDir,label="WhatsApp"}={}){this.sessionId=sessionId;this.sessionDir=sessionDir;this.label=label;this.sock=null;this.statusValue="disabled";this.qrDataUrl=null;this.onEvent=null;this.connecting=false;this.stopped=false;this.retryTimer=null;this.lastError=null;this.credentialWrites=Promise.resolve();this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.qrReady=false;this.peerNames=new Map();this.peerPhones=new Map();this.groupRequests=new Set();this.historyQueue=Promise.resolve();this.knownChats=new Set();this.historyAnchors=new Map();this.historyStats={batches:0,chats:0,imported:0,duplicates:0,failed:0,last_at:null}}
 configured(){return config.whatsappEnabled}
 status(){return {key:"whatsapp",id:this.sessionId,label:this.label,configured:this.configured(),status:this.statusValue,qr:this.qrDataUrl,pairing_code:this.pairingCode,last_error:this.lastError,history:{...this.historyStats,known_chats:this.knownChats.size,anchor_chats:this.historyAnchors.size}}}
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
   const sock=makeWASocket({auth:state,markOnlineOnConnect:false,syncFullHistory:true,shouldSyncHistoryMessage:()=>true,generateHighQualityLinkPreview:false,logger:{level:"silent",child(){return this},trace(){},debug(){},info(){},warn(){},error(){},fatal(){}}});
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
   sock.ev.on('messaging-history.set',history=>{void this.queueHistory(sock,history);});
   // Best-effort: newer Baileys builds emit this event for some, not all mappings.
   sock.ev.on('lid-mapping.update',mapping=>{
    void this.consumeLidMappings(sock,mapping).catch(()=>{this.lastError='lid_mapping_metadata_failed';});
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
 async consumeLidMappings(sock,mapping){
  if(this.sock!==sock||this.stopped)return;
  const entries=Array.isArray(mapping)?mapping:Array.isArray(mapping?.mappings)?mapping.mappings:[mapping];
  for(const item of entries){
   const lid=String(item?.lid||'').toLowerCase(),phone=safeWhatsAppPn(item?.pn);
   if(isLidJid(lid)&&phone)await this.rememberPeer(sock,lid,{phoneJid:phone});
  }
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
  for(const c of chats){
   const jid=String(c?.id||'').toLowerCase();
   if(!isWhatsAppConversationJid(jid))continue;
   this.knownChats.add(jid);
   // Some chat payloads include a real last-message anchor; most carry metadata only.
   if(c?.lastMessage?.key)this.rememberHistoryAnchor(c.lastMessage);
   await this.onEvent?.({type:'whatsapp.history.chat',account_id:this.sessionId,jid});
   const name=c?.name||c?.subject||c?.notify||'';
   const alternative=String(c?.pnJid||c?.phoneNumber||c?.phone_number||'').toLowerCase();
   await this.rememberPeer(sock,jid,{name,phoneJid:alternative});
   // A PN chat may also expose its LID; keep that relationship without
   // guessing it from digits or merging unrelated conversations.
   const lid=String(c?.lid||c?.lidJid||'').toLowerCase();
   if(isLidJid(lid)&&safeWhatsAppPn(jid))await this.rememberPeer(sock,lid,{name,phoneJid:jid});
  }
 }
 async resolveGroupName(sock,jid){
  if(this.groupRequests.has(jid)||typeof sock.groupMetadata!=='function')return;
  this.groupRequests.add(jid);
  try{const info=await sock.groupMetadata(jid);if(info?.subject)await this.rememberPeer(sock,jid,{name:info.subject});}
  catch{/* Group metadata might be unavailable. Preserve the group JID. */}
 }
 async refreshPhoneMappings(jids=[]){
  const sock=this.sock;
  if(!sock||this.statusValue!=='connected')return {ok:false,error:'whatsapp_not_connected'};
  const candidates=[...new Set([...jids,...this.knownChats])].filter(isLidJid).slice(0,150);
  let resolved=0,unresolved=0,failed=0;
  for(const jid of candidates){
   if(this.sock!==sock||this.stopped)break;
   try{
    const pn=await this.knownPhone(sock,jid,'');
    if(pn){await this.rememberPeer(sock,jid,{phoneJid:pn});resolved++;}
    else unresolved++;
   }catch{failed++;}
  }
  return {ok:true,examined:resolved+unresolved+failed,resolved,unresolved,failed,
   note:'Only locally known PN mappings can be recovered; no phone number is inferred from LID digits.'};
 }
 async knownPhone(sock,jid,alt){
  // A canonical PN wins over conflicting alternatives; only LIDs need resolution.
  if(!isLidJid(jid))return safeWhatsAppPn(jid);
  const existing=safeWhatsAppPn(alt)||this.peerPhones.get(jid)||'';
  if(existing)return existing;
  try{
   const store=sock.signalRepository?.lidMapping,resolver=store?.getPNForLID;
   if(typeof resolver==='function')return safeWhatsAppPn(await resolver.call(store,jid));
  }catch{/* Older Baileys versions and old history may lack the mapping. */}
  return '';
 }
 // History is delivered as multiple asynchronous chunks. Process one chunk at
 // a time, in chat order, and acknowledge progress only after durable ingestion.
 queueHistory(sock,history){
  const work=this.historyQueue.then(()=>this.consumeHistory(sock,history));
  this.historyQueue=work.catch(()=>{this.lastError='history_chunk_failed';});
  return work;
 }
 async consumeHistory(sock,history={}){
  if(this.sock!==sock||this.stopped)return {skipped:true};
  const contacts=Array.isArray(history.contacts)?history.contacts:[];
  const chats=Array.isArray(history.chats)?history.chats:[];
  try{await this.consumeContacts(sock,contacts);}catch{this.lastError='history_contact_metadata_failed';}
  // History may contain verified LID -> PN mappings even when chat labels are empty.
  try{await this.consumeLidMappings(sock,history.lidPnMappings||[]);}
  catch{this.lastError='history_contact_metadata_failed';}
  try{await this.consumeChats(sock,chats);}catch{this.lastError='history_chat_metadata_failed';}
  const grouped=new Map();
  for(const message of Array.isArray(history.messages)?history.messages:[]){
   const jid=String(message?.key?.remoteJid||'').toLowerCase();
   if(!isWhatsAppConversationJid(jid))continue;
   if(!grouped.has(jid))grouped.set(jid,[]);
   grouped.get(jid).push(message);
  }
  for(const [jid,messages] of grouped){
   try{await this.onEvent?.({type:'whatsapp.history.chat',account_id:this.sessionId,jid});}catch{this.lastError='history_chat_discovery_failed';}
   for(let offset=0;offset<messages.length;offset+=100){
    if(this.sock!==sock||this.stopped)return {interrupted:true};
    const chunk=messages.slice(offset,offset+100),result=await this.receiveMessages(sock,{messages:chunk,type:'append'});
    this.historyStats.imported+=result.imported;
    this.historyStats.duplicates+=result.duplicates;
    this.historyStats.failed+=result.failed;
    await this.onEvent?.({type:'whatsapp.history.batch',account_id:this.sessionId,jid,
     imported:result.imported,duplicates:result.duplicates,failed:result.failed});
   }
  }
  this.historyStats.batches++;this.historyStats.chats+=new Set([...grouped.keys(),...chats.map(c=>c?.id).filter(isWhatsAppConversationJid)]).size;
  this.historyStats.last_at=new Date().toISOString();
  return {ok:true,chats:grouped.size,messages:[...grouped.values()].reduce((n,a)=>n+a.length,0)};
 }
 // WhatsApp's on-demand API requires the key and timestamp of an actual message.
 // Keep the earliest raw key from observed live/history traffic even when its
 // CRM row is not yet available (for example during initial synchronization).
 rememberHistoryAnchor(message){
  const jid=String(message?.key?.remoteJid||'').toLowerCase(),id=String(message?.key?.id||'');
  const raw=Number(message?.messageTimestamp);
  const timestamp=raw>1e12?raw:raw*1000;
  if(!isWhatsAppConversationJid(jid)||!id||id.length>128||!Number.isSafeInteger(timestamp)||
   timestamp<946684800000||timestamp>Date.now()+300000)return false;
  this.knownChats.add(jid);
  const previous=this.historyAnchors.get(jid);
  if(previous&&previous.timestamp<=timestamp)return false;
  // Bounded in-memory cache; not a replacement for SQL history inventory.
  if(this.historyAnchors.size>=3000&&!this.historyAnchors.has(jid))
   this.historyAnchors.delete(this.historyAnchors.keys().next().value);
  const key={remoteJid:jid,id,fromMe:message.key.fromMe===true};
  if(message.key.participant)key.participant=message.key.participant;
  this.historyAnchors.set(jid,{jid,key,timestamp});
  return true;
 }
 historyAnchorCandidates(limit=10){
  return [...this.historyAnchors.values()].sort((a,b)=>a.timestamp-b.timestamp)
   .slice(0,Math.max(1,Math.min(50,Number(limit)||10)));
 }
 // A single bounded on-demand request per known chat. A successful request
 // means WhatsApp accepted the REQUEST, not that older messages were delivered.
 async requestHistory(candidates=[]){
  if(this.statusValue!=='connected'||!this.sock)throw Error('whatsapp_not_connected');
  if(typeof this.sock.fetchMessageHistory!=='function')
   return {ok:true,requested:0,attempted:0,reason:'unsupported_api',results:[]};
  const results=[],sock=this.sock;
  for(const c of candidates.slice(0,10)){
   if(this.sock!==sock||this.stopped||this.statusValue!=='connected')break;
   if(!isWhatsAppConversationJid(c.jid)||!c.key?.id||!Number.isFinite(c.timestamp))continue;
   try{
    // WhatsApp's documented on-demand page limit is 50 messages.
    const ticket=await sock.fetchMessageHistory(50,c.key,c.timestamp);
    results.push({jid:c.jid,status:ticket?'requested':'unconfirmed'});
   }catch(error){
    const category=/timeout/i.test(String(error?.message||''))?'timeout':'request_failed';
    results.push({jid:c.jid,status:'failed',reason:category});
   }
  }
  const requested=results.filter(x=>x.status==='requested').length;
  return {ok:true,requested,attempted:results.length,reason:requested?'submitted':
   results.some(x=>x.status==='failed')?'request_failed':'no_confirmed_requests',
   results,note:'Sending a request does not mean WhatsApp will return historical messages'};
 }

 async receiveMessages(sock,{messages,type}={}){
    if(this.sock!==sock||this.stopped||!Array.isArray(messages))return;
    if(type!=="notify"&&type!=="append")return;
    const summary={imported:0,duplicates:0,failed:0};
    for(const m of messages){
     if(this.sock!==sock||this.stopped)break;
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
     const rawTimestamp=Number(m.messageTimestamp);
     let timestamp=rawTimestamp>1e12?rawTimestamp:rawTimestamp*1000;
     if(!Number.isSafeInteger(timestamp)||timestamp<946684800000||timestamp>Date.now()+300000){this.lastError="invalid_message_timestamp";timestamp=0;if(!eventType)eventType="timestamp_review";}
     const jid=String(m.key.remoteJid).toLowerCase(),direction=m.key.fromMe?"out":"in";
     if(isGroupJid(jid))void this.resolveGroupName(sock,jid);
     const pn=await this.knownPhone(sock,jid,m.key.remoteJidAlt);
     const publicName=direction==='in'?(m.pushName||m.verifiedBizName||''):'';
     // pushName is a display hint, never a phone-number proof.
     if((pn&&!this.peerPhones.has(jid))||(publicName&&!this.peerNames.has(jid)))
      try{await this.rememberPeer(sock,jid,{phoneJid:pn,name:publicName});}catch{this.lastError='message_profile_failed';}
     const participant=String(m.key.participant||'').toLowerCase();
     const participantPn=safeWhatsAppPn(m.key.participantAlt)||safeWhatsAppPn(participant)||
      (isLidJid(participant)?await this.knownPhone(sock,participant,''):'');
     const actualSender=isGroupJid(jid)?(participantPn||participant||jid):pn||jid;
     const title=whatsappPeerTitle({jid,name:this.peerNames.get(jid),phoneJid:pn});
     const event={id:"wa:"+this.sessionId+":"+String(m.key.id||Date.now()),type:"message",source:"whatsapp.baileys",channel:"whatsapp",account_id:this.sessionId,
      account:{provider:"whatsapp",type:"whatsapp",identifier:this.sessionId,label:this.label},
      conversation_external_id:jid,conversation_title:title,external_id:String(m.key.id||""),direction,
      sender:direction==="in"?actualSender:"me",recipient:direction==="out"?pn||jid:"me",
      subject:"",body,inbox_event_type:eventType,is_read:direction==="out"||Boolean(eventType),sent_at:new Date(timestamp).toISOString()};
     if(this.sock!==sock||this.stopped)break;
     // Preserve recovery anchors even if persistence temporarily fails.
     this.rememberHistoryAnchor(m);
     let result;
     for(let attempt=0;attempt<3;attempt++){
      try{result=await this.onEvent?.(event);break;}
      catch(error){
       if(attempt===2)throw error;
       await new Promise(resolve=>setTimeout(resolve,80*(attempt+1)));
      }
     }
     this.rememberHistoryAnchor(m);
     if(result?.inserted===true)summary.imported++;
     else if(result?.inserted===false)summary.duplicates++;
     else {summary.failed++;this.lastError='message_ingestion_unconfirmed';}
     }catch{summary.failed++;this.lastError="message_ingestion_failed";}
    }
    return summary;
 }

 stop(){this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.sock;this.sock=null;this.qrReady=false;this.qrDataUrl=null;this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.statusValue="disconnected";sock?.end?.(new Error("shutdown"));}
 async disconnect(){this.stop();return {ok:true,...this.status()};}
 async reconnect(onEvent=this.onEvent){this.stop();await this.start(onEvent);return {ok:true,...this.status()};}
 async logout(){
  this.stopped=true;clearTimeout(this.retryTimer);this.retryTimer=null;const sock=this.sock;this.sock=null;this.qrReady=false;this.qrDataUrl=null;this.pairingPhone=null;this.pairingCode=null;this.pairingRequested=false;this.statusValue="disconnected";
  try{await sock?.logout();}catch{this.lastError="logout_failed";throw Error("whatsapp_logout_failed");}finally{sock?.end?.(new Error("logout"));}
  // Removing stored credentials also works when there is no active socket.
  await this.credentialWrites;
  await rm(this.sessionDir,{recursive:true,force:true});this.knownChats.clear();this.historyAnchors.clear();this.statusValue="logged_out";this.lastError=null;
 }
 async deleteSession(){await this.logout();return {ok:true,...this.status()};}
 async send({to,body}){if(!this.sock||this.statusValue!=="connected")throw Error("WhatsApp is not connected");const jid=whatsappDestination(to);if(!String(body||"").trim())throw Error("body_required");const r=await this.sock.sendMessage(jid,{text:String(body)});if(!r?.key?.id)throw Error("send_not_confirmed");return {ok:true,message_id:String(r.key.id),jid};}
}


