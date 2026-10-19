import test from 'node:test';
import assert from 'node:assert/strict';
import {applyGmailMessageAction} from '../src/gmail-message-actions.js';
const input={conversationId:'conv_a',messageId:'msg_a',action:'read',confirmed:true,enabled:true};
test('Gmail message actions require confirmation, feature flag and known action before lookup',async()=>{
 const db={execute:()=>assert.fail()};
 for(const [change,error] of [[{confirmed:false},'explicit_confirmation_required'],[{enabled:false},'gmail_writes_disabled'],[{action:'delete'},'invalid_gmail_action'],[{action:'__proto__'},'invalid_gmail_action']])
  await assert.rejects(applyGmailMessageAction({...input,...change,db}),new RegExp(error));
});
test('message action resolves account from scoped message, audits intent then modifies only requested labels',async()=>{
 const calls=[],db={execute:async(sql,args)=>{assert.deepEqual(args,['msg_a','conv_a']);return [[{external_id:'provider-message',integration_key:'google:provider-account'}]];}};
 const google={permittedAccount:async(a,p)=>{assert.equal(a,'provider-account');assert.equal(p,'gmail_modify');},gmailModifyLabels:async req=>{calls.push('provider');assert.deepEqual(req,{account_id:'provider-account',message_id:'provider-message',confirmed:true,add:[],remove:['UNREAD']});return {ok:true};}};
 const result=await applyGmailMessageAction({...input,db,google,audit:async e=>calls.push(e.after.state)});
 assert.deepEqual(calls,['requested','provider','provider_accepted']);assert.equal(result.local_sync_pending,true);
});
test('missing source, denied scope or failed audit never perform a provider mutation',async()=>{
 const base={...input,db:{execute:async()=>[[{external_id:'m',integration_key:'google:a'}]]},google:{permittedAccount:async()=>{},gmailModifyLabels:()=>assert.fail()},audit:async()=>{throw Error('audit unavailable');}};
 await assert.rejects(applyGmailMessageAction(base),/audit unavailable/);
 await assert.rejects(applyGmailMessageAction({...base,db:{execute:async()=>[[]]}}),/gmail_message_unavailable/);
 await assert.rejects(applyGmailMessageAction({...base,google:{...base.google,permittedAccount:async()=>{throw Error('scope denied');}}}),/scope denied/);
});
