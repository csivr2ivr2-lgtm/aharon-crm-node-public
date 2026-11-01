import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reconnectDelayMs} from '../src/connectors/whatsapp-retry.js';

test('reconnection jitter is bounded and increases on repeated transient failures',()=>{
 assert.equal(reconnectDelayMs(1,()=>0),4000);
 assert.equal(reconnectDelayMs(1,()=>0.5),5000);
 assert.equal(reconnectDelayMs(1,()=>1),6000);
 assert.equal(reconnectDelayMs(2,()=>0.5),10000);
 assert.equal(reconnectDelayMs(3,()=>0.5),20000);
 assert.ok(reconnectDelayMs(8,()=>1)<=120000);
 assert.ok(reconnectDelayMs(1,()=>2)<=6000);
 assert.ok(reconnectDelayMs(1,()=>-1)>=4000);
 assert.equal(reconnectDelayMs(-42,()=>0.5),5000);
});
test('connector uses jitter only on transient close and never impersonates a person',async()=>{
 const connector=await readFile(new URL('../src/connectors/whatsapp.js',import.meta.url),'utf8');
 assert.match(connector,/if\(decision\.needsReview\)\{this\.lastError='whatsapp_relink_required';return;\}/);
 assert.match(connector,/const pause=reconnectDelayMs\(this\.reconnectAttempts\)/);
 assert.doesNotMatch(connector,/backupAuthState|holdSession|reserveSingleRecoveryProbe|readRecoveryHold|clearHoldOnConnected/);
 assert.doesNotMatch(connector,/browser:\s*Browsers|humanEmulation|presenceSubscribe/);
});
test('obsolete recovery routes and misleading buttons are gone',async()=>{
 const browser=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
 assert.doesNotMatch(server,/\/api\/whatsapp\/recovery\//);
 assert.doesNotMatch(browser,/wa-recovery-probe|wa-recovery-status/);
 assert.match(browser,/whatsapp_relink_required/);
});
