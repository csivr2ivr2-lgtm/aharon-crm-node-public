import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DB_NAME='crm_test';process.env.DB_USER='crm_test';
process.env.SESSION_SECRET=randomBytes(32).toString('hex');process.env.DASHBOARD_PASSWORD=randomBytes(32).toString('hex');
process.env.MAIL_ATTACHMENT_DOWNLOADS='true';process.env.MAIL_HTML_PREVIEW='true';
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
