import test from 'node:test';
import assert from 'node:assert/strict';
import {googlePermissions,gmailLabelRequest,GMAIL_MODIFY} from '../src/google-permissions.js';
import {GoogleConnector} from '../src/connectors/google.js';
import {execFileSync} from 'node:child_process';
import {verifyOauthState} from '../src/connectors/security.js';
test('new Gmail operations fail closed for absent and read-only scopes',()=>{
 assert.equal(googlePermissions().gmail_modify,false);
 assert.equal(googlePermissions({scope:'https://www.googleapis.com/auth/gmail.readonly'}).gmail_modify,false);
 assert.equal(googlePermissions({scope:GMAIL_MODIFY}).gmail_modify,true);
 assert.equal(googlePermissions({scope:'https://mail.google.com/'}).gmail_modify,true);
 assert.throws(()=>gmailLabelRequest({add:['INBOX']}),/explicit_confirmation_required/);
 assert.throws(()=>gmailLabelRequest({confirmed:true,add:['INBOX'],remove:['INBOX']}),/gmail_label_conflict/);
 assert.throws(()=>gmailLabelRequest({confirmed:true,add:['INBOX',{}]}),/invalid_gmail_labels/);
 assert.deepEqual(gmailLabelRequest({confirmed:true,add:['INBOX','INBOX']}),{addLabelIds:['INBOX'],removeLabelIds:[]});
});
test('Google consent is explicit, signed and bound to the selected account',async()=>{
 const connector=new GoogleConnector({get:async k=>k==='google:a'?{id:'a',email:'a@example.test',tokens:{}}:null});
 connector.configured=()=>true;
 connector.oauthClient=()=>({generateAuthUrl:p=>p});
 await assert.rejects(connector.permissionUrl({account_id:'a'}),/explicit_confirmation_required/);
 const request=await connector.permissionUrl({account_id:'a',confirmed:true});
 assert.equal(request.login_hint,'a@example.test');
 assert.ok(request.scope.includes(GMAIL_MODIFY));
 assert.equal(verifyOauthState(request.state).account_id,'a');
 await assert.rejects(connector.gmailModifyLabels({account_id:'a',message_id:'m',confirmed:true,add:['INBOX']}),/gmail_writes_disabled/);
 const check=`import assert from 'node:assert/strict';
 import {GoogleConnector} from './src/connectors/google.js';
 const c=new GoogleConnector({get:async()=>({id:'a',tokens:{scope:'https://www.googleapis.com/auth/gmail.readonly'}})});
 await assert.rejects(c.gmailModifyLabels({account_id:'a',message_id:'m',confirmed:true,add:['INBOX']}),/gmail_modify_permission_required/);`;
 execFileSync(process.execPath,['--input-type=module','-e',check],{cwd:new URL('..',import.meta.url),env:{...process.env,GMAIL_WRITES_ENABLED:'true'},stdio:'pipe'});
});
test('sync status exposes no OAuth tokens, raw cursor or message body',async()=>{
 const connector=new GoogleConnector({get:async k=>k==='google:a'?{id:'a',email:'a@example.test',tokens:{access_token:'private',scope:GMAIL_MODIFY}}:{anchor:'private-cursor',page:'private-page',mode:'delta',checked_at:'2026-01-01T00:00:00Z'}});
 const status=await connector.gmailStatus({account_id:'a'});
 assert.equal(status.sync.has_cursor,true);
 assert.doesNotMatch(JSON.stringify(status),/private|access_token/);
});
