import {createHmac,randomBytes} from 'node:crypto';
import {config} from './config.js';
export const SSO_TARGET='https://app.aharon.cloud/auth/crm-admin-sso';
export const SSO_ISSUER='aharon-crm';
export const SSO_AUDIENCE='aharon-cloud-admin';
export const SSO_TTL_MS=60_000;
export const CRM_COOKIE_MS=14*24*60*60*1000;
export function hostelSsoConfigured(){
 try{
  const raw=String(config.publicBaseUrl||''),url=new URL(raw);
  return String(process.env.HOSTEL_SSO_SHARED_SECRET||'').length>=32 &&
    url.protocol==='https:'&&url.origin===raw&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;
 }catch{return false;}
}
export function createHostelTicket({now=Date.now(),nonce=randomBytes(16).toString('hex')}={}){
 if(!hostelSsoConfigured())throw Error('hostel_sso_unavailable');
 if(!Number.isSafeInteger(now)||!/^[a-f0-9]{32}$/.test(nonce))throw Error('invalid_hostel_ticket');
 const payload={v:2,iss:SSO_ISSUER,aud:SSO_AUDIENCE,iat:now,exp:now+SSO_TTL_MS,nonce};
 const signed='v2.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
 return signed+'.'+createHmac('sha256',process.env.HOSTEL_SSO_SHARED_SECRET).update(signed).digest('hex');
}
