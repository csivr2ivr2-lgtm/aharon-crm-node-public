import {createHmac,randomBytes} from 'node:crypto';
import {equalToken} from './http.js';

export const ADMIN_REAUTH_TTL_MS=5*60*1000;

// Token bound to the current signed CRM cookie and a server-held signing secret.
// It does not contain the password and cannot authorize the handoff by itself.
export function createAdminReauthChallenge(signedCookie,secret,now=Date.now()){
 if(!signedCookie||String(secret||'').length<32||!Number.isSafeInteger(now))throw Error('reauth_unavailable');
 const nonce=randomBytes(16).toString('hex'),payload=now+'.'+nonce;
 const mac=createHmac('sha256',secret).update('admin-sso-reauth-v1|'+signedCookie+'|'+payload).digest('hex');
 return payload+'.'+mac;
}
export function verifyAdminReauthChallenge(challenge,signedCookie,secret,now=Date.now()){
 if(!signedCookie||String(secret||'').length<32)return false;
 const match=/^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(String(challenge||''));
 if(!match)return false;
 const created=Number(match[1]);
 if(!Number.isSafeInteger(created)||!Number.isSafeInteger(now)||created>now+5000||now-created>ADMIN_REAUTH_TTL_MS)return false;
 const mac=createHmac('sha256',secret).update('admin-sso-reauth-v1|'+signedCookie+'|'+match[1]+'.'+match[2]).digest('hex');
 return equalToken(mac,match[3]);
}
