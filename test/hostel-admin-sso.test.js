import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostelTicket,hostelSsoConfigured,CRM_COOKIE_MS} from '../src/aharon-admin-sso.js';
test('SSO v2 signs a non-IP-bound 60-second ticket only with a strong private secret',()=>{
 const old={...process.env};
 try{
  delete process.env.HOSTEL_SSO_SHARED_SECRET;
  process.env.HOSTEL_SSO_ALLOWED_IPS='203.0.113.21';
  assert.equal(hostelSsoConfigured(),false);
  assert.throws(()=>createHostelTicket(),/hostel_sso_unavailable/);
  process.env.HOSTEL_SSO_SHARED_SECRET='x'.repeat(64);
  process.env.HOSTEL_SSO_ALLOWED_IPS='irrelevant-invalid-ip';
  assert.equal(hostelSsoConfigured(),true);
  const now=1700000000000,nonce='a'.repeat(32);
  const token=createHostelTicket({now,nonce});
  assert.match(token,/^v2\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/);
  const item=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  assert.deepEqual(item,{v:2,iss:'aharon-crm',aud:'aharon-cloud-admin',iat:now,exp:now+60000,nonce});
  assert.equal(Object.hasOwn(item,'ip'),false);
  delete process.env.HOSTEL_SSO_ALLOWED_IPS;
  assert.equal(hostelSsoConfigured(),true);
 }finally{for(const key of ['HOSTEL_SSO_SHARED_SECRET','HOSTEL_SSO_ALLOWED_IPS']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
test('CRM SSO requires signed session and fresh password but no IP or four-hour rule',async()=>{
 const {readFileSync}=await import('node:fs'),s=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const r=s.slice(s.indexOf("app.post('/auth/aharon-admin'"),s.indexOf('app.get("/api/status"'));
 assert.match(r,/if\(!logged\(req\)\)/);
 assert.match(r,/verifyAdminReauthChallenge/);
 assert.match(r,/equalToken\(password,config.dashboardPassword\)/);
 assert.match(r,/createHostelTicket\(\)/);
 assert.doesNotMatch(r,/isAllowedHostelIp|verifiedVisitorIp|RECENT_CRM_LOGIN_MS/);
 assert.equal(CRM_COOKIE_MS,14*24*60*60*1000);
});
test('CRM password reauthentication page and denial do not disclose private location or visitor IP',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const route=source.slice(source.indexOf("app.post('/auth/aharon-admin'"),source.indexOf('app.get("/api/status"'));
 assert.match(route,/sendAdminReauthPage/);
 const ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
 assert.ok(ui.includes('הכניסה לא זמינה'));
 assert.ok(route.includes('Referrer-Policy'));
 assert.match(route,/createAdminReauthChallenge/);
 assert.match(route,/verifyAdminReauthChallenge/);
 assert.doesNotMatch(route,/כתובת שהשרת מזהה|הוסטל|(?:[0-9]{1,3}[.]){3}[0-9]{1,3}/);
 assert.equal(route.includes("'+(ip"),false);
 const html=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
 assert.doesNotMatch(html,/מרשת ההוסטל/);
});
