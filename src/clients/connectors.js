import {config} from "../config.js";
import {syncIssue} from "../sync-diagnostics.js";
import {EncryptedVault} from "../connectors/vault.js";
import {GoogleConnector} from "../connectors/google.js";
import {hostingerMail} from "../connectors/hostinger-mail.js";
import {WhatsAppSessions} from "../connectors/whatsapp-sessions.js";
import {WhatsAppConnector} from "../connectors/whatsapp.js";
const whatsapp=new WhatsAppSessions({connectorFactory:options=>new WhatsAppConnector(options)});

const vault=new EncryptedVault(),google=new GoogleConnector(vault);
export const googleConnector=google;
export {hostingerMail,whatsapp};

export class ConnectorsClient{
 async status(){return {ok:true,connectors:[
  {key:"google",configured:google.configured(),accounts:google.configured()?await google.accounts():[]},
  hostingerMail.status(),whatsapp.status()
 ]}}
 async sync(){
  const events=[];
  for(const [name,connector] of [["google",google],["hostinger",hostingerMail]]){if(!connector.configured())continue;try{events.push(...await connector.sync());}catch(error){events.push(syncIssue(name,"connect",error,name==="hostinger"?hostingerMail.settings().user:""));}}
  return {ok:true,events,generated_at:new Date().toISOString()};
 }
 async send(channel,payload){
  if(channel==="hostinger_email"||channel==="hostinger"||channel==="email_hostinger")return hostingerMail.send(payload);
  if(channel==="whatsapp")return whatsapp.send(payload);
  if(channel==="gmail"||channel==="google_email")return google.sendEmail(payload);
  throw Error("Unsupported send channel: "+channel);
 }
 async get(path){
  if(path==="/v1/connectors")return this.status();
  if(path==="/v1/google/accounts")return {ok:true,accounts:await google.accounts()};
  if(path==="/v1/whatsapp/status")return {ok:true,...whatsapp.status()};
  throw Error("Unsupported connector route");
 }
 async post(path,p={}){
  if(path==="/v1/google/auth-url")return {ok:true,url:google.authUrl(String(p.account_hint||""))};
  if(path==="/v1/google/gmail/recent")return google.gmailRecent(p);
  if(path==="/v1/google/calendar/upcoming")return google.calendarUpcoming(p);
  if(path==="/v1/google/drive/search")return google.driveSearch(p);
  if(path==="/v1/google/gmail/send")return google.sendEmail(p);
  if(path==="/v1/hostinger/send")return hostingerMail.send(p);
  if(path==="/v1/whatsapp/send")return whatsapp.send(p);
  if(path==="/v1/sync")return this.sync();
  throw Error("Unsupported connector route");
 }
}
