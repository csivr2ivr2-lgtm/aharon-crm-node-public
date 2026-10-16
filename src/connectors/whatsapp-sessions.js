import {randomBytes} from 'node:crypto';
import {readFile,writeFile,rename,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {config} from '../config.js';
import {recoverySummary} from './whatsapp-recovery.js';
import {pairingPhoneNumber} from './whatsapp-phone.js';

const validId=id=>typeof id==='string'&&/^(?:whatsapp-main|wa_[a-f0-9]{16})$/.test(id);
const MAX_SESSIONS=10;

// Preserve the old WhatsApp session at the auth root; new sessions stay in isolated child directories.
export class WhatsAppSessions {
 constructor({rootDir=config.whatsappSessionDir,connectorFactory,enabled=config.whatsappEnabled}={}){
  if(typeof connectorFactory!=='function')throw Error('whatsapp_connector_factory_required');
  this.enabled=enabled;
  this.rootDir=rootDir;this.connectorFactory=connectorFactory;this.sessions=new Map();
  this.sessions.set('whatsapp-main',this.make('whatsapp-main',null));
  this.initializing=null;this.mutations=Promise.resolve();this.onEvent=null;
 }
 make(id,phone){
  const sessionDir=id==='whatsapp-main'?this.rootDir:join(this.rootDir,'sessions',id);
  const connector=this.connectorFactory({sessionId:id,sessionDir,label:phone?'WhatsApp · '+phone:'WhatsApp (ראשי)'});
  connector.phoneNumber=phone;return connector;
 }
 async initialize(){
  if(this.initializing)return this.initializing;
  this.initializing=(async()=>{
   await mkdir(this.rootDir,{recursive:true,mode:0o700});
   let saved=[];
   try{saved=JSON.parse(await readFile(join(this.rootDir,'sessions.json'),'utf8'));}
   catch(e){if(e.code!=='ENOENT')throw Error('whatsapp_registry_invalid');}
   if(!Array.isArray(saved)||saved.length>MAX_SESSIONS-1)throw Error('whatsapp_registry_invalid');
   const phones=new Set();
   for(const entry of saved){
    if(!entry||!validId(entry.id)||entry.id==='whatsapp-main'||this.sessions.has(entry.id))throw Error('whatsapp_registry_invalid');
    const phone=pairingPhoneNumber(entry.phone);
    if(phones.has(phone))throw Error('whatsapp_registry_invalid');phones.add(phone);
    this.sessions.set(entry.id,this.make(entry.id,phone));
   }
  })();
  return this.initializing;
 }
 async persist(){
  const records=[...this.sessions.entries()].filter(([id])=>id!=='whatsapp-main').map(([id,connector])=>({id,phone:connector.phoneNumber}));
  const target=join(this.rootDir,'sessions.json'),temporary=target+'.'+randomBytes(6).toString('hex')+'.tmp';
  try{await writeFile(temporary,JSON.stringify(records),{mode:0o600,flag:'wx'});await rename(temporary,target);}
  finally{await rm(temporary,{force:true}).catch(()=>{});}
 }
 mutate(fn){
  const result=this.mutations.then(fn);
  this.mutations=result.catch(()=>{});
  return result;
 }
 get(id='whatsapp-main'){
  if(!validId(id)||!this.sessions.has(id))throw Error('whatsapp_session_not_found');
  return this.sessions.get(id);
 }
 // Pairing secrets are returned only on the authenticated dashboard endpoint.
 status({includeSecrets=false}={}){
  const sessions=[...this.sessions.entries()].map(([id,connector])=>{
   const s=connector.status();
   const {qr,pairing_code,...safe}=s;
   return {id,...safe,...(includeSecrets?{qr,pairing_code}:{})};
  });
  return {key:'whatsapp',configured:this.enabled,status:sessions.some(s=>s.status==='connected')?'connected':sessions.some(s=>s.status==='connecting')?'connecting':'disconnected',sessions};
 }
 async startAll(onEvent){await this.initialize();this.onEvent=onEvent;if(!this.enabled)return this.status();
  await Promise.allSettled([...this.sessions.values()].map(c=>c.start(onEvent)));
  return this.status();
 }
 async start(onEvent=this.onEvent,id='whatsapp-main'){await this.initialize();this.onEvent=onEvent;await this.get(id).start(onEvent);return this.status({includeSecrets:true});}
 async pairWithPhone(number,onEvent=this.onEvent,id=''){
  await this.initialize();
  if(!this.enabled)throw Error('whatsapp_not_enabled');
  const phone=pairingPhoneNumber(number);this.onEvent=onEvent;
  const connector=await this.mutate(async()=>{
   let existing=id?this.get(id):[...this.sessions.values()].find(c=>c.phoneNumber===phone);
   if(existing){
    if(existing.phoneNumber&&existing.phoneNumber!==phone)throw Error('whatsapp_session_phone_mismatch');
    return existing;
   }
   if(this.sessions.size>=MAX_SESSIONS)throw Error('whatsapp_session_limit');
   const nextId='wa_'+randomBytes(8).toString('hex');
   const added=this.make(nextId,phone);added.phoneNumber=phone;this.sessions.set(nextId,added);
   try{await this.persist();}catch(e){this.sessions.delete(nextId);throw e;}
   return added;
  });
  return {ok:true,session_id:connector.sessionId,...await connector.pairWithPhone(phone,onEvent)};
 }
 async disconnect(id='whatsapp-main'){await this.initialize();return this.get(id).disconnect();}
 async reconnect(id='whatsapp-main',onEvent=this.onEvent){await this.initialize();return this.get(id).reconnect(onEvent);}
 async deleteSession(id='whatsapp-main'){
  await this.initialize();
  return this.mutate(async()=>{
   const c=this.get(id);
   await c.deleteSession();
   if(id!=='whatsapp-main'){this.sessions.delete(id);try{await this.persist();}catch(error){this.sessions.set(id,c);throw error;}}
   return {ok:true,id};
  });
 }
 async logout(id='whatsapp-main'){return this.deleteSession(id);}
 stop(){for(const c of this.sessions.values())c.stop();}
 async historyAnchors(sessionId,limit=20){
  await this.initialize();
  return this.get(sessionId).historyAnchorCandidates(limit);
 }
 async refreshIdentities(sessionId,jids){
  await this.initialize();
  return this.get(sessionId).refreshPhoneMappings(jids);
 }
 async requestHistory(sessionId,candidates){
  await this.initialize();
  return this.get(sessionId).requestHistory(candidates);
 }
 async recoveryStatus(id='whatsapp-main'){
  await this.initialize();const connector=this.get(id);
  return {ok:true,session:connector.status(),...(await recoverySummary(connector.sessionDir))};
 }
 async recoveryProbe(id='whatsapp-main',onEvent=this.onEvent){
  await this.initialize();this.onEvent=onEvent;
  return this.get(id).recoveryProbe(onEvent);
 }
 async deleteForEveryone(payload){await this.initialize();if(!payload?.account_id)throw Error('whatsapp_account_id_required');return this.get(payload.account_id).deleteForEveryone(payload);}
 async send(payload){
  await this.initialize();
  const id=payload.account_id;
  if(id)return this.get(id).send(payload);
  const connected=[...this.sessions.values()].filter(c=>c.statusValue==='connected');
  if(connected.length!==1)throw Error('whatsapp_account_id_required');
  return connected[0].send(payload);
 }
}

