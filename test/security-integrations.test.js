import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
process.env.NODE_ENV='test';
const privatePassword=randomBytes(24).toString('hex'), privateToken=randomBytes(24).toString('hex'), privateRefresh=randomBytes(24).toString('hex');
process.env.OAUTH_STATE_SECRET=randomBytes(32).toString('hex');
const {HostingerMailConnector}=await import('../src/connectors/hostinger-mail.js');
const {WhatsAppConnector,whatsappDestination}=await import('../src/connectors/whatsapp.js');
const {GoogleConnector}=await import('../src/connectors/google.js');
const {createOauthState,verifyOauthState}=await import('../src/connectors/security.js');
function memoryVault(initial={}){const data=new Map(Object.entries(initial));return {data,get:async key=>data.get(key)||null,set:async(key,value)=>data.set(key,value),delete:async key=>data.delete(key),entries:async prefix=>[...data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>({key,value}))};}
function mailFixture(fail=''){
 const calls=[],vault=memoryVault();
 const connector=new HostingerMailConnector({vault,imapFactory:options=>({connect:async()=>{calls.push(['imap',options]);if(fail==='imap')throw Error('secret password in upstream error');},logout:async()=>calls.push(['imap.close'])}),smtpFactory:options=>({verify:async()=>{calls.push(['smtp',options]);if(fail==='smtp')throw Error('secret password in upstream error');},close:()=>calls.push(['smtp.close'])})});
 return {calls,vault,connector};
}
test('Hostinger verifies IMAP and SMTP before persisting and returns no password',async()=>{
 const {connector,vault,calls}=mailFixture();
 const result=await connector.configure({email:'Owner@Example.test',password:privatePassword,host:'127.0.0.1'});
 assert.equal(result.account,'owner@example.test');assert.equal(result.status,'connected');
 assert.equal(JSON.stringify(result).includes(privatePassword),false);
 assert.deepEqual(calls.map(c=>c[0]),['imap','smtp','imap.close','smtp.close']);
 assert.equal(calls[0][1].host,'imap.hostinger.com');assert.equal(calls[1][1].host,'smtp.hostinger.com');assert.equal(calls[0][1].secure,true);assert.equal(calls[1][1].disableFileAccess,true);assert.equal(calls[1][1].disableUrlAccess,true);
 assert.equal((await vault.get('hostinger:account')).password,privatePassword);
 await connector.disconnect();assert.equal(connector.status().account,null);assert.equal(connector.configured(),false);
 const restarted=new HostingerMailConnector({vault});await restarted.initialize();assert.equal(restarted.configured(),false);assert.equal(JSON.stringify([...vault.data]).includes(privatePassword),false);
});
for(const failure of ['imap','smtp'])test(`Hostinger ${failure} failure never saves or exposes upstream secrets`,async()=>{
 const {connector,vault,calls}=mailFixture(failure);
 await assert.rejects(()=>connector.configure({email:'owner@example.test',password:privatePassword}),/^Error: mail_connection_failed$/);
 assert.equal(vault.data.size,0);assert.ok(calls.some(c=>c[0]==='imap.close'));assert.ok(calls.some(c=>c[0]==='smtp.close'));
});
test('Hostinger rejects header injection and old-account sends before contacting provider',async()=>{
 const {connector,calls}=mailFixture();await connector.configure({email:'owner@example.test',password:privatePassword});calls.length=0;
 await assert.rejects(()=>connector.send({account_id:'old@example.test',to:'client@example.test',body:'hello'}),/mail_account_mismatch/);
 await assert.rejects(()=>connector.send({to:'client@example.test\r\nBcc: other@example.test',body:'hello'}),/invalid_mail_header/);
 await assert.rejects(()=>connector.configure({email:'owner@example.test\r\nother',password:privatePassword}),/invalid_email/);
 assert.equal(calls.length,0);
});
test('WhatsApp destinations reject broadcasts, arbitrary domains and text disguised as phone numbers',()=>{
 assert.equal(whatsappDestination('+972 (50) 123-4567'),'972501234567@s.whatsapp.net');
 assert.equal(whatsappDestination('123456789-123456@g.us'),'123456789-123456@g.us');
 for(const value of ['status@broadcast','972501234567@evil.test','call 972501234567','123','@s.whatsapp.net',''])assert.throws(()=>whatsappDestination(value),/invalid_whatsapp_recipient/);
});
test('WhatsApp disconnect clears QR and blocks send even when a socket was connected',async()=>{
 const connector=new WhatsAppConnector();let stopped=0,sent=0;
 connector.sock={end:()=>{stopped++},sendMessage:async()=>{sent++;}};connector.statusValue='connected';connector.qrDataUrl='sensitive-qr';
 await connector.disconnect();assert.equal(stopped,1);assert.equal(connector.status().status,'disconnected');assert.equal(connector.status().qr,null);
 await assert.rejects(()=>connector.send({to:'972501234567',body:'hello'}),/not connected/);assert.equal(sent,0);
});
test('Google account responses omit tokens and disconnect removes only the selected account',async()=>{
 const vault=memoryVault({'google:one':{id:'one',email:'one@example.test',tokens:{access_token:privateToken}},'google:two':{id:'two',email:'two@example.test',tokens:{refresh_token:privateRefresh}}}),google=new GoogleConnector(vault);
 assert.equal(JSON.stringify(await google.accounts()).includes(privateToken),false);assert.equal(JSON.stringify(await google.accounts()).includes(privateRefresh),false);
 await assert.rejects(()=>google.accountRecord(),/account_id is required/);
 await google.disconnect('one');assert.equal(await vault.get('google:one'),null);assert.equal((await google.accounts()).length,1);
});
test('Google token refresh after disconnect cannot resurrect credentials',async()=>{
 const record={id:'one',email:'one@example.test',tokens:{access_token:privateToken}},vault=memoryVault({'google:one':record}),google=new GoogleConnector(vault);
 let refresh;google.oauthClient=(_tokens,onTokens)=>{refresh=onTokens;return {};};await google.clientFor(record);await google.disconnect('one');await refresh({access_token:randomBytes(24).toString('hex')});
 assert.equal(await vault.get('google:one'),null);
});
test('OAuth signed state rejects appended segments and tampering',()=>{
 const state=createOauthState({account_hint:'owner@example.test'});assert.equal(verifyOauthState(state).account_hint,'owner@example.test');
 assert.throws(()=>verifyOauthState(state+'.ignored'),/Invalid OAuth state/);
 assert.throws(()=>verifyOauthState(state.replace(/^./,state[0]==='x'?'y':'x')),/Invalid OAuth state/);
});
