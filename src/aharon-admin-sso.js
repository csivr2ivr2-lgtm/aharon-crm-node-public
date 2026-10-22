import {createHmac, randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {config} from './config.js';

export const SSO_TARGET = 'https://app.aharon.cloud/auth/crm-admin-sso';
export const SSO_ISSUER = 'aharon-crm';
export const SSO_AUDIENCE = 'aharon-cloud-admin';
export const SSO_TTL_MS = 60_000;
export const RECENT_CRM_LOGIN_MS = 4 * 60 * 60 * 1000;
export const CRM_COOKIE_MS = 14 * 24 * 60 * 60 * 1000;

export function normalizeHostelIp(value) {
 let ip = String(value || '').trim().toLowerCase();
 if(ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip=ip.slice(7);
 return isIP(ip)?ip:'';
}
export function isPublicVisitorIp(value) {
 const ip=normalizeHostelIp(value),type=isIP(ip);
 if(type===4) {
  const [a,b]=ip.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||(a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===192&&b===0)||(a===198&&(b===18||b===19)));
 }
 if(type===6)return ip!=='::'&&ip!=='::1'&&!ip.startsWith('fc')&&!ip.startsWith('fd')&&!/^fe[89ab]/.test(ip)&&!ip.startsWith('ff');
 return false;
}
// SSO-only client IP detection; does NOT trust Fastify trustProxy=true or a
// client-controlled leftmost X-Forwarded-For. A verified immediate proxy peer
// must append/overwrite the true upstream IP as the RIGHTMOST XFF entry.
export function verifiedVisitorIp(req,proxies=process.env.HOSTEL_SSO_TRUSTED_PROXY_IPS){
 const direct=normalizeHostelIp(req?.raw?.socket?.remoteAddress||req?.socket?.remoteAddress);
 if(!direct)return '';
 const trusted=String(proxies||'').split(',').map(normalizeHostelIp).filter(Boolean);
 if(!trusted.includes(direct))return direct;
 const forwarded=req?.raw?.headers?.['x-forwarded-for']??req?.headers?.['x-forwarded-for'];
 if(typeof forwarded!=='string'||forwarded.length>512)return '';
 const hops=forwarded.split(',');
 if(!hops.length||hops.length>12)return '';
 const nearest=normalizeHostelIp(hops[hops.length-1]);
 return isPublicVisitorIp(nearest)?nearest:'';
}
export function isAllowedHostelIp(value,allowlist=process.env.HOSTEL_SSO_ALLOWED_IPS){
 const parts=String(allowlist||'').split(',').map(normalizeHostelIp);
 return Boolean(String(allowlist||'').trim()) && parts.every(isPublicVisitorIp) && isPublicVisitorIp(value) && parts.includes(normalizeHostelIp(value));
}
export function hostelSsoConfigured(){
 try {
  const origin=new URL(config.publicBaseUrl);
  return String(process.env.HOSTEL_SSO_SHARED_SECRET||'').length >= 32 &&
    Boolean(String(process.env.HOSTEL_SSO_ALLOWED_IPS||'').trim()) &&
    String(process.env.HOSTEL_SSO_ALLOWED_IPS||'').split(',').every(isPublicVisitorIp) &&
    origin.protocol==='https:' && origin.origin===config.publicBaseUrl && !origin.username && !origin.password;
 } catch { return false; }
}
export function isRecentCrmSession(req,now=Date.now()){
 const cookie=req.unsignCookie(req.cookies?.crm_session||'');
 if(!cookie.valid)return false;
 const expiry=Number(cookie.value);
 const issuedAt=expiry-CRM_COOKIE_MS;
 return Number.isSafeInteger(expiry) && expiry>now && issuedAt<=now &&
   issuedAt >= now-RECENT_CRM_LOGIN_MS;
}
export function createHostelTicket(ip,{now=Date.now(),nonce=randomBytes(16).toString('hex')}={}){
 if(!hostelSsoConfigured()||!isAllowedHostelIp(ip))throw Error('hostel_sso_unavailable');
 if(!Number.isSafeInteger(now)||!/^[a-f0-9]{32}$/.test(nonce))throw Error('invalid_hostel_ticket');
 const payload={v:1,iss:SSO_ISSUER,aud:SSO_AUDIENCE,ip:normalizeHostelIp(ip),iat:now,exp:now+SSO_TTL_MS,nonce};
 const signed='v1.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
 const mac=createHmac('sha256',process.env.HOSTEL_SSO_SHARED_SECRET).update(signed).digest('hex');
 return signed+'.'+mac;
}
