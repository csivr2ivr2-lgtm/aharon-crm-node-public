import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createHostelTicket, hostelSsoConfigured, isAllowedHostelIp, normalizeHostelIp, verifiedVisitorIp, SSO_TARGET, CRM_COOKIE_MS, isRecentCrmSession} from '../src/aharon-admin-sso.js';

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
  assert.equal(verifiedVisitorIp({ip:'203.0.113.21',raw:{socket:{remoteAddress:'192.168.1.1'}}},'192.168.1.1'), '203.0.113.21');
  assert.equal(SSO_TARGET,'https://app.aharon.cloud/auth/crm-admin-sso');
 }finally{for(const key of ['HOSTEL_SSO_SHARED_SECRET','HOSTEL_SSO_ALLOWED_IPS']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
test('CRM session is only considered recent for four hours after password login',()=>{
 const now=1700000000000;
 function req(age){return {cookies:{crm_session:String(now-age+CRM_COOKIE_MS)},unsignCookie:raw=>({valid:true,value:raw})};}
 assert.equal(isRecentCrmSession(req(2000),now),true);
 assert.equal(isRecentCrmSession(req(5*60*60*1000),now),false);
 assert.equal(isRecentCrmSession(req(-5000),now),false);
 assert.equal(isRecentCrmSession({cookies:{},unsignCookie:()=>({valid:false})},now),false);
});
