import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createHostelTicket, hostelSsoConfigured, isAllowedHostelIp, normalizeHostelIp, verifiedVisitorIp, SSO_TARGET, CRM_COOKIE_MS} from '../src/aharon-admin-sso.js';

test('Hostel ticket issuer fails closed until configured and accepts only exact IPs',()=>{
 const old={...process.env};
 try{
  delete process.env.HOSTEL_SSO_SHARED_SECRET;
  process.env.HOSTEL_SSO_ALLOWED_IPS='203.0.113.21';
  assert.equal(hostelSsoConfigured(),false);
  assert.throws(()=>createHostelTicket('203.0.113.21'),/hostel_sso_unavailable/);
  assert.equal(isAllowedHostelIp('203.0.113.21','203.0.113.21'),true);
  assert.equal(isAllowedHostelIp('203.0.113.22','203.0.113.21'),false);
  assert.equal(isAllowedHostelIp('203.0.113.22','203.0.113.0/24'),false);
  assert.equal(normalizeHostelIp('::ffff:203.0.113.21'),'203.0.113.21');
  assert.equal(isAllowedHostelIp('192.168.1.1','192.168.1.1'),false);
  assert.equal(verifiedVisitorIp({ip:'203.0.113.21',raw:{socket:{remoteAddress:'192.168.1.1'}}}), '192.168.1.1');
  assert.equal(verifiedVisitorIp({ip:'203.0.113.21',raw:{socket:{remoteAddress:'192.168.1.1'},headers:{'x-forwarded-for':'203.0.113.21'}}},'192.168.1.1'), '203.0.113.21');
  assert.equal(SSO_TARGET,'https://app.aharon.cloud/auth/crm-admin-sso');
 }finally{for(const key of ['HOSTEL_SSO_SHARED_SECRET','HOSTEL_SSO_ALLOWED_IPS']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
test('CRM handoff requires a signed active CRM login, but not an additional 4-hour recency restriction', async()=>{
 const {readFileSync}=await import('node:fs');
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const start=server.indexOf("app.post('/auth/aharon-admin'");
 assert.notEqual(start,-1);
 const route=server.slice(start,server.indexOf('app.get("/api/status"',start));
 assert.match(route,/if\(!logged\(req\)\)/);
 assert.match(route,/createHostelTicket\(ip\)/);
 assert.doesNotMatch(route,/isRecentCrmSession|RECENT_CRM_LOGIN_MS|4 \* 60 \* 60/);
 assert.equal(CRM_COOKIE_MS,14*24*60*60*1000);
});

test('Hostinger localhost proxy resolves only last forwarded IP with an explicit trusted peer',()=>{
 const make=(peer,header,reported='203.0.113.21')=>({raw:{socket:{remoteAddress:peer},headers:header===undefined?{}:{'x-forwarded-for':header}},ip:reported});
 assert.equal(verifiedVisitorIp(make('127.0.0.1','203.0.113.21'),'127.0.0.1'),'203.0.113.21');
 assert.equal(verifiedVisitorIp(make('127.0.0.1','203.0.113.21, 203.0.113.70'),'127.0.0.1'),'203.0.113.70');
 assert.equal(verifiedVisitorIp(make('203.0.113.70','203.0.113.21'),'127.0.0.1'),'203.0.113.70');
 assert.equal(verifiedVisitorIp(make('127.0.0.1','203.0.113.21')),'127.0.0.1');
 assert.equal(verifiedVisitorIp(make('127.0.0.1',undefined),'127.0.0.1'),'');
 assert.equal(verifiedVisitorIp(make('127.0.0.1','192.168.1.2'),'127.0.0.1'),'');
 assert.equal(verifiedVisitorIp(make('127.0.0.1','not-an-ip'),'127.0.0.1'),'');
});

test('CRM denies access without exposing network, location or visitor IP in browser-visible HTML',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const route=src.slice(src.indexOf("app.post('/auth/aharon-admin'"),src.indexOf('app.get("/api/status"'));
 const error=route.slice(route.indexOf('const errorPage='),route.indexOf('const ticket=createHostelTicket'));
 assert.ok(error.includes('הכניסה לא זמינה'));
 assert.ok(error.includes('Referrer-Policy'));
 assert.doesNotMatch(error,/כתובת שהשרת מזהה|הוסטל|(?:\d{1,3}\.){3}\d{1,3}/);
 assert.doesNotMatch(error,/\+\s*\(ip/);
 const html=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
 assert.doesNotMatch(html,/מרשת ההוסטל/);
});
