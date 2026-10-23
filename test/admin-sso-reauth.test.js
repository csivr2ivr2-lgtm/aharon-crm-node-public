import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAdminReauthChallenge,verifyAdminReauthChallenge,ADMIN_REAUTH_TTL_MS} from '../src/admin-sso-reauth.js';

test('signed session and fresh password confirmation challenge required',()=>{
 const secret='x'.repeat(64),now=1700000000000,cookie='s:actual-signed-cookie-example';
 const token=createAdminReauthChallenge(cookie,secret,now);
 assert.equal(verifyAdminReauthChallenge(token,cookie,secret,now+1000),true);
 assert.equal(verifyAdminReauthChallenge(token,cookie,secret,now+ADMIN_REAUTH_TTL_MS+1),false);
 assert.equal(verifyAdminReauthChallenge(token,'another-cookie',secret,now),false);
 assert.equal(verifyAdminReauthChallenge(token,cookie,'y'.repeat(64),now),false);
 assert.equal(verifyAdminReauthChallenge(token.slice(0,-1)+'0',cookie,secret,now),false);
 assert.equal(verifyAdminReauthChallenge('garbage',cookie,secret,now),false);
 assert.throws(()=>createAdminReauthChallenge(cookie,'weak',now));
});
test('CRM handoff never issues ticket before password confirmation',()=>{
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const first=source.slice(source.indexOf("app.post('/auth/aharon-admin'"),source.indexOf("app.post('/auth/aharon-admin/confirm'"));
 const confirm=source.slice(source.indexOf("app.post('/auth/aharon-admin/confirm'"),source.indexOf('app.get("/api/status"'));
 assert.doesNotMatch(first,/createHostelTicket/);
 assert.match(first,/createAdminReauthChallenge/);
 assert.match(confirm,/verifyAdminReauthChallenge/);
 assert.match(confirm,/equalToken\(password,config.dashboardPassword\)/);
 assert.match(confirm,/loginSecurity.failed/);
 assert.match(confirm,/createHostelTicket/);
 assert.match(confirm,/hostelSsoConfigured\(\)\|\|!isAllowedHostelIp\(ip\)/);
 assert.doesNotMatch(first,/HOSTEL_SSO_ALLOWED_IPS/);
});
