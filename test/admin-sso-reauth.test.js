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
 assert.match(confirm,/if\(!hostelSsoConfigured\(\)\)/);
 assert.doesNotMatch(confirm,/isAllowedHostelIp|verifiedVisitorIp/);
 assert.doesNotMatch(first,/HOSTEL_SSO_ALLOWED_IPS/);
});

test('password confirmation uses same-origin form policy and keeps strict origin and signed step-up validation',()=>{
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const guard=source.slice(source.indexOf('app.addHook("onRequest"'),source.indexOf('app.addHook("onRequest"',source.indexOf('app.addHook("onRequest"')+1));
 const form=source.slice(source.indexOf('function adminReauthHeaders'),source.indexOf("app.post('/auth/aharon-admin'",source.indexOf('function adminReauthHeaders')));
 assert.match(guard,/req\.headers\.origin!==expected/);
 assert.match(guard,/origin_rejected/);
 assert.match(form,/Referrer-Policy','same-origin'/);
 assert.doesNotMatch(form,/Referrer-Policy','no-referrer'/);
 const confirm=source.slice(source.indexOf("app.post('/auth/aharon-admin/confirm'"),source.indexOf('app.get("/api/status"'));
 assert.match(confirm,/verifyAdminReauthChallenge/);
 assert.match(confirm,/equalToken\(password,config.dashboardPassword\)/);
});
