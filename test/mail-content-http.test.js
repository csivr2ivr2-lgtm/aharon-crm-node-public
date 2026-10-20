import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DB_NAME='crm_test';process.env.DB_USER='crm_test';
process.env.SESSION_SECRET=randomBytes(32).toString('hex');process.env.DASHBOARD_PASSWORD=randomBytes(32).toString('hex');
process.env.GMAIL_WRITES_ENABLED='true';process.env.MAIL_ATTACHMENT_DOWNLOADS='true';process.env.MAIL_HTML_PREVIEW='true';
const {buildApp}=await import('../src/server.js');
const {db}=await import('../src/db.js');
const {googleConnector}=await import('../src/clients/connectors.js');
test.after(()=>db.end());
async function login(app){const r=await app.inject({method:'POST',url:'/login',payload:{password:process.env.DASHBOARD_PASSWORD}});return r.headers['set-cookie'].split(';')[0];}
test('HTTP downloads require login, enforce conversation ownership and set safe headers',async t=>{
 let providerCalls=0;
 const raw=Buffer.from(['MIME-Version: 1.0','Message-ID: <m@example.test>','Content-Type: multipart/mixed; boundary=B','','--B','Content-Type: application/pdf','Content-Disposition: attachment; filename=report.pdf','Content-Transfer-Encoding: base64','','cGRm','--B--',''].join('\r\n'));
 t.mock.method(db,'execute',async(sql,params)=>{
  if(!sql.includes('message_attachment_metadata'))return [[]];
  if(params[0]!=='conv_a')return [[]];
  return [[{ordinal:0,filename:'report.pdf',mime_type:'application/pdf',size_bytes:3,source:'google.gmail',integration_key:'google:account-a',external_id:'m',rfc_message_id:'<m@example.test>'}]];
 });
 t.mock.method(googleConnector,'downloadMessageRaw',async args=>{providerCalls++;assert.equal(args.account_id,'account-a');return raw;});
 const app=await buildApp({initializeDatabase:false,startBackground:false});
 try{
  const url='/api/conversations/conv_a/attachments/msg_a/0/download';
  assert.equal((await app.inject({url})).statusCode,401);assert.equal(providerCalls,0);
  const cookie=await login(app);
  const missing=await app.inject({url:url.replace('conv_a','conv_b'),headers:{cookie}});
  assert.equal(missing.statusCode,400);assert.equal(providerCalls,0);
  const response=await app.inject({url,headers:{cookie}});
  assert.equal(response.statusCode,200);assert.equal(response.body,'pdf');assert.equal(providerCalls,1);
  assert.match(response.headers['content-type'],/application\/octet-stream/);
  assert.match(response.headers['content-disposition'],/^attachment;/);assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(response.headers['cache-control'],'private, no-store');
 }finally{await app.close();}
});
test('HTTP mail preview is scoped and sanitizes stored content again before serving',async t=>{
 t.mock.method(db,'execute',async(sql,params)=>{
  if(!sql.includes('SELECT body_html'))return [[]];
  assert.match(sql,/id=\? AND conversation_id=\?/);
  return params[1]==='conv_a'?[[{body_html:'<p>שלום</p><script>evil()</script><img src=https://tracker>'}]]:[[]];
 });
 const app=await buildApp({initializeDatabase:false,startBackground:false});
 try{
  const url='/api/conversations/conv_a/messages/msg_a/html';
  assert.equal((await app.inject({url})).statusCode,401);
  const cookie=await login(app),r=await app.inject({url,headers:{cookie}});
  assert.equal(r.statusCode,200);assert.match(r.json().document,/<p>שלום<\/p>/);
  assert.doesNotMatch(r.json().document,/evil|tracker|<script|<img/);
  assert.equal((await app.inject({url:url.replace('conv_a','conv_b'),headers:{cookie}})).statusCode,400);
 }finally{await app.close();}
});

test('Gmail HTTP actions require login, same origin, confirmation, scoped identity and audit',async t=>{
 let calls=0,scopeAllowed=true;const audits=[];
 t.mock.method(db,'execute',async(sql,params)=>{
  if(sql.includes('INSERT INTO ai_audit')){audits.push(params);return [{affectedRows:1}];}
  if(sql.includes('SELECT m.external_id')){
   assert.deepEqual(params[0],'msg_a');
   return params[1]==='conv_a'?[[{external_id:'provider-a',integration_key:'google:account-a'}]]:[[]];
  }
  return [[]];
 });
 t.mock.method(googleConnector,'permittedAccount',async(account,capability)=>{
  assert.equal(account,'account-a');assert.equal(capability,'gmail_modify');
  if(!scopeAllowed)throw Error('google_permission_required');
  return {};
 });
 t.mock.method(googleConnector,'gmailModifyLabels',async args=>{
  calls++;assert.equal(audits.length,1);
  assert.deepEqual(args,{account_id:'account-a',message_id:'provider-a',confirmed:true,add:[],remove:['INBOX']});
  return {ok:true};
 });
 const app=await buildApp({initializeDatabase:false,startBackground:false});
 try{
  const url='/api/conversations/conv_a/messages/msg_a/gmail-state',payload={action:'archive',confirmed:true};
  assert.equal((await app.inject({method:'POST',url,payload})).statusCode,401);
  const cookie=await login(app);
  assert.equal((await app.inject({method:'POST',url,payload,headers:{cookie,origin:'https://untrusted.example'}})).statusCode,403);
  for(const confirmed of [undefined,false,'true']){
   assert.equal((await app.inject({method:'POST',url,payload:{action:'archive',confirmed},headers:{cookie}})).statusCode,400);
  }
  assert.equal((await app.inject({method:'POST',url:url.replace('conv_a','conv_b'),payload,headers:{cookie}})).statusCode,400);
  scopeAllowed=false;
  assert.equal((await app.inject({method:'POST',url,payload,headers:{cookie}})).statusCode,400);
  assert.equal(calls,0);assert.equal(audits.length,0);
  scopeAllowed=true;
  const response=await app.inject({method:'POST',url,payload:{...payload,account_id:'attacker-account'},headers:{cookie}});
  assert.equal(response.statusCode,200);assert.equal(response.json().local_sync_pending,true);
  assert.equal(calls,1);assert.equal(audits.length,2);
 }finally{await app.close();}
});

test('client resource HTTP routes enforce authentication, confirmation and current provider permission',async t=>{
 let authorized=0,reads=0;
 t.mock.method(db,'execute',async(sql,args)=>{
  reads++;
  if(sql.includes('FROM client_resource_links'))return [[{id:'a'.repeat(64),client_id:'client_a',provider:'google.drive',account_id:'account-a',external_id:'private-file'}]];
  assert.fail('No provider payload may be read after permission rejection');
 });
 t.mock.method(googleConnector,'driveApi',async account=>{authorized++;assert.equal(account,'account-a');throw Error('drive_metadata_permission_required');});
 const app=await buildApp({initializeDatabase:false,startBackground:false});
 try{
  const url='/api/clients/client_a/resources';
  for(const method of ['GET','POST'])assert.equal((await app.inject({method,url})).statusCode,401);
  const cookie=await login(app);
  const input={provider:'google.drive',account_id:'account-a',external_id:'private-file'};
  assert.equal((await app.inject({method:'POST',url,payload:input,headers:{cookie}})).statusCode,400);
  assert.equal(authorized,0);assert.equal(reads,0);
  assert.equal((await app.inject({method:'POST',url,payload:{...input,confirmed:true},headers:{cookie}})).statusCode,400);
  assert.equal(authorized,1);assert.equal(reads,0);
  const list=await app.inject({url,headers:{cookie}});
  assert.equal(list.statusCode,200);
  assert.deepEqual(list.json().items,[{id:'a'.repeat(64),client_id:'client_a',provider:'google.drive',available:false}]);
  const unlink=url+'/'+ 'a'.repeat(64)+'/unlink';
  assert.equal((await app.inject({method:'POST',url:unlink,payload:{confirmed:true}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:unlink,payload:{},headers:{cookie}})).statusCode,400);
 }finally{await app.close();}
});
