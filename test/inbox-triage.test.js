import test from 'node:test';
import assert from 'node:assert/strict';
import {nonCustomerSignal} from '../src/ai/inbox-signals.js';
import {syncFailure} from '../src/sync-diagnostics.js';

test('WhatsApp channels are treated as updates, not customers',()=>{
 const result=nonCustomerSignal({sender:'120363197493914012@newsletter',subject:'',body:'hello'});
 assert.equal(result.classification,'automated');
 assert.equal(result.confidence,1);
 assert.equal(nonCustomerSignal({sender:'972501234567@s.whatsapp.net',body:'אשמח לקבל הצעת מחיר'}),null);
});
test('authentication and status notifications are classified as system messages',()=>{
 for(const subject of ['Your temporary ChatGPT login code','New login from Chrome on Android','Reset your password for ElevenLabs','OAuth Application Approval','Summary of failures for Google Apps Script: Untitled project']){
  assert.equal(nonCustomerSignal({subject})?.classification,'system',subject);
 }
});
test('marketing is separated from real leads without marking spam',()=>{
 assert.equal(nonCustomerSignal({subject:'Get 50% off your Manus plan'})?.classification,'marketing');
 assert.equal(nonCustomerSignal({subject:'בירור על מספרים וירטואליים לקבלת SMS',sender:'customer@gmail.com'}),null);
 assert.equal(nonCustomerSignal({subject:'Re: דרוש 100 מספרי SMS',sender:'customer@gmail.com'}),null);
});
test('403 error reasons are not collapsed into incorrect permission diagnostics',()=>{
 assert.equal(syncFailure({response:{status:403,data:{error:{errors:[{reason:'accessNotConfigured'}]}}}}),'gmail_api_disabled');
 assert.equal(syncFailure({response:{status:403,data:{error:{details:[{reason:'SERVICE_DISABLED'}]}}}}),'gmail_api_disabled');
 assert.equal(syncFailure({response:{status:403,data:{error:{errors:[{reason:'insufficientPermissions'}]}}}}),'gmail_scope_missing');
 assert.equal(syncFailure({response:{status:403,data:{error:{errors:[{reason:'rateLimitExceeded'}]}}}}),'rate_limited');
 assert.equal(syncFailure({response:{status:403,data:{error:{errors:[{reason:'domainPolicy'}]}}}}),'permission_denied');
});
