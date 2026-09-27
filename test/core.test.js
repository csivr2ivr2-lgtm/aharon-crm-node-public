import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DB_NAME='crm_test';process.env.DB_USER='crm_test';
process.env.SESSION_SECRET=randomBytes(32).toString('hex');process.env.DASHBOARD_PASSWORD=randomBytes(32).toString('hex');
process.env.MCP_API_TOKEN=randomBytes(32).toString('hex');process.env.OAUTH_STATE_SECRET=randomBytes(32).toString('hex');
const {db}=await import('../src/db.js');
const {emailOf,phoneOf}=await import('../src/message-format.js');
const {serializeContext,findClient}=await import('../src/ai/context.js');
const {WorkspaceService,ingestMessage}=await import('../src/workspace-service.js');
const {mimeMessage}=await import('../src/connectors/google.js');
const {simpleParser}=await import('mailparser');
const {createMcpServer}=await import('../src/mcp.js');
const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
const {buildApp}=await import('../src/server.js');
const {sendConversationReply}=await import('../src/inbox.js');
const {LoginSecurity}=await import('../src/login-security.js');
const {loginHtml}=await import('../src/ui.js');


test('login page is product-facing and uses Bootstrap Icons password toggle',()=>{
 const html=loginHtml();assert.ok(html.includes('bootstrap-icons@1.13.1'));assert.ok(html.includes('bi-eye'));assert.ok(!html.includes('CRM Node מלא'));
});
test('login security locks globally and persists the triggering IP after three failures',async()=>{
 const {mkdtemp,rm,unlink,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'aharon-crm-login-')),guard=new LoginSecurity({dataDir:dir,maxAttempts:3});
 try{
  await guard.initialize();assert.equal((await guard.failed('::ffff:203.0.113.7')).locked,false);assert.equal((await guard.failed('203.0.113.7')).locked,false);const third=await guard.failed('203.0.113.7');assert.equal(third.locked,true);assert.equal(await guard.isLocked(),true);assert.equal(await guard.isBlacklisted('203.0.113.7'),true);
  const lock=JSON.parse(await readFile(guard.paths().lockFile,'utf8'));assert.equal(lock.trigger_ip,'203.0.113.7');await unlink(guard.paths().lockFile);assert.equal(await guard.isLocked(),false);assert.equal(await guard.isBlacklisted('203.0.113.7'),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('email text never turns into a wildcard phone lookup',()=>{
 assert.equal(phoneOf('alice@example.test'),'');assert.equal(phoneOf('123456@g.us'),'');
 assert.equal(phoneOf('972501234567@s.whatsapp.net'),'972501234567');
 assert.equal(emailOf('Alice <alice@example.test>'),'alice@example.test');
});
test('client lookup rejects ambiguous matches and uses only incoming senders',async t=>{
 const calls=[];t.mock.method(db,'execute',async(sql,args)=>{calls.push({sql,args});return [[{id:'a'},{id:'b'}]];});
 assert.equal(await findClient([{direction:'out',sender:'owner@example.test'},{direction:'in',sender:'client@example.test'}]),null);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].args,['client@example.test']);assert.ok(!calls[0].sql.includes('LIKE'));
});
test('context truncation retains valid JSON and every category',()=>{
 const data={latest_message:{body:'latest text'},client:{name:'Client'},projects:[{description:'x'.repeat(30000)}],notes:[{body:'important note'}],messages:Array.from({length:300},()=>({body:'m'.repeat(1000)}))};
 const result=serializeContext(data,4000);assert.ok(result.length<=4000);const parsed=JSON.parse(result);assert.equal(parsed.latest_message.body,'latest text');assert.ok(parsed.notes.length);assert.equal(parsed.truncated,true);
});
test('partial task update preserves notes, automation and project relations',async t=>{
 const calls=[];t.mock.method(db,'execute',async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT * FROM tasks'))return [[{id:'t1',title:'Original',notes:'Keep notes',automation_mode:'ai_draft',worker_state:'done',worker_result:'Keep result',status:'open'}]];if(sql.startsWith('SELECT to_id'))return [[{to_id:'p1'}]];if(sql.startsWith('SELECT id FROM projects'))return [[{id:'p1'}]];if(sql.startsWith('SELECT created_at'))return [[{created_at:'date'}]];return [{affectedRows:1}];});
 t.mock.method(db,'getConnection',async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,args)=>{calls.push({sql,args});return [{affectedRows:1}];}}));
 await new WorkspaceService().call('task.update',{id:'t1',status:'done'});
 const write=calls.find(x=>x.sql.startsWith('INSERT INTO tasks'));assert.equal(write.args[1],'Original');assert.equal(write.args[5],'Keep notes');assert.equal(write.args[6],'ai_draft');assert.equal(write.args[8],'Keep result');assert.ok(calls.some(x=>x.sql.startsWith('INSERT IGNORE INTO entity_relations')&&x.args[3]==='p1'));
});
test('MIME preserves Hebrew body and reply headers and blocks header injection',async()=>{
 const raw=mimeMessage({to:'a@example.test',from:'b@example.test',subject:'שלום',body:'תשובה בעברית',in_reply_to:'<original@example.test>',references:['<original@example.test>']});
 const mail=await simpleParser(Buffer.from(raw,'base64url'));assert.equal(mail.subject,'שלום');assert.equal(mail.text.trim(),'תשובה בעברית');assert.equal(mail.inReplyTo,'<original@example.test>');
 assert.throws(()=>mimeMessage({to:'a@example.test\r\nBcc: b@example.test',subject:'x',body:'x'}),/invalid_mail_header/);
});
async function mcpTools(settings){const server=createMcpServer({settings,workspace:{call:async()=>({ok:true})},connectors:{status:async()=>({ok:true})}});const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);const list=await client.listTools();await client.close();await server.close();return list.tools.map(x=>x.name);}
test('MCP read-only default has conversation and drafts but no sends or writes',async()=>{
 const names=await mcpTools({mcpAllowWrites:false,mcpAllowSensitiveWrites:false});for(const name of ['get_conversation','list_systems','list_connectors','create_reply_draft','search_crm'])assert.ok(names.includes(name));assert.ok(!names.includes('create_task'));assert.ok(!names.includes('send_email'));
});
test('MCP general write flag does not enable sensitive sends',async()=>{
 const names=await mcpTools({mcpAllowWrites:true,mcpAllowSensitiveWrites:false});assert.ok(names.includes('create_task'));assert.ok(names.includes('update_client'));assert.ok(!names.includes('send_whatsapp'));
});
test('HTTP auth, assets, ticket issuance, origin rejection and MCP initialize',async()=>{
 const app=await buildApp({initializeDatabase:false,startBackground:false});
 try{
  assert.equal((await app.inject('/health')).statusCode,200);
  assert.equal((await app.inject('/api/connectors')).statusCode,401);
  const login=await app.inject({method:'POST',url:'/login',payload:{password:process.env.DASHBOARD_PASSWORD}});assert.equal(login.statusCode,302);const cookie=login.headers['set-cookie'].split(';')[0];
  assert.equal((await app.inject({url:'/api/ai/status',headers:{cookie}})).statusCode,200);
  const ticket=await app.inject({method:'POST',url:'/api/ws-ticket',headers:{cookie},payload:{}});assert.ok(ticket.json().ticket);
  assert.equal((await app.inject({method:'POST',url:'/api/sync',headers:{cookie,origin:'https://untrusted.example.test'},payload:{}})).statusCode,403);
  assert.equal((await app.inject({url:'/assets/app.js'})).statusCode,200);
  const mcp=await app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+process.env.MCP_API_TOKEN,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}}});assert.equal(mcp.statusCode,200);assert.ok(mcp.body.includes('protocolVersion'));
 }finally{await app.close();}
});
test('sending rejects foreign draft before calling any provider',async()=>{
 let sent=false;const fake={execute:async sql=>{
  if(sql.includes('FROM conversations'))return [[{id:'c',account_id:'a'}]];
  if(sql.includes('FROM accounts'))return [[{integration_key:'google:g'}]];
  if(sql.includes('FROM messages'))return [[{sender:'a@example.test'}]];
  return [[]];
 }};
 await assert.rejects(sendConversationReply({conversationId:'c',body:'hello',draftId:'foreign',requestId:'request_1234567890'},{db:fake,send:async()=>{sent=true;}}),/invalid_draft/);assert.equal(sent,false);
});
test('a repeated uncertain send never calls the provider a second time',async()=>{
 let sends=0;const fake={execute:async sql=>{
  if(sql.includes('FROM conversations'))return [[{id:'c',account_id:'a',external_id:'thread',channel:'email'}]];
  if(sql.includes('FROM accounts'))return [[{integration_key:'google:g'}]];
  if(sql.includes('FROM messages'))return [[{sender:'a@example.test'}]];
  if(sql.startsWith('INSERT IGNORE'))return [{affectedRows:0}];
  if(sql.includes('FROM outgoing_sends'))return [[{conversation_id:'c',status:'uncertain'}]];
  throw Error('Unexpected SQL');
 }};
 await assert.rejects(sendConversationReply({conversationId:'c',body:'hello',requestId:'request_1234567890'},{db:fake,send:async()=>{sends++;}}),/send_pending_or_uncertain/);assert.equal(sends,0);
});
test.after(async()=>{await db.end();});

test('message ingestion rolls back when storing a body fails',async t=>{
 let rollback=false,commit=false,released=false;
 const c={beginTransaction:async()=>{},commit:async()=>{commit=true;},rollback:async()=>{rollback=true;},release(){released=true;},execute:async sql=>{
  if(sql.startsWith('SELECT id FROM accounts'))return [[{id:'account'}]];
  if(sql.startsWith('SELECT m.id'))return [[]];
  if(sql.startsWith('INSERT INTO messages'))throw Error('write_failure');return [{affectedRows:1}];
 }};t.mock.method(db,'getConnection',async()=>c);
 await assert.rejects(ingestMessage({account:{provider:'google'},account_id:'g',external_id:'m',conversation_external_id:'thread',body:'hello'}),/write_failure/);
 assert.ok(rollback&&released);assert.equal(commit,false);
});
test('worker failure stops retrying after third claim and never calls external sending',async()=>{
 const {SmartTaskWorker}=await import('../src/worker.js');const calls=[];
 const worker=new SmartTaskWorker({database:{execute:async(sql,args)=>{calls.push({sql,args});return [{affectedRows:1}];}},execute:async()=>{throw Error('model failure');}});
 worker.claim=async()=>({id:'task',title:'draft email',worker_attempts:3,worker_claim:'claim'});
 const r=await worker.runOnce();assert.equal(r.ok,false);assert.equal(calls[0].args[0],'failed');assert.equal(worker.running,false);
});
test('duplicate message does not increment unread count or create activity',async t=>{
 const calls=[];t.mock.method(db,'getConnection',async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,args)=>{
  calls.push({sql,args});if(sql.startsWith('SELECT id FROM accounts'))return [[{id:'a'}]];if(sql.startsWith('SELECT m.id'))return [[{id:'existing'}]];return [{affectedRows:1}];
 }}));
 const r=await ingestMessage({account:{provider:'google'},account_id:'g',external_id:'m',conversation_external_id:'thread',body:'hello'});assert.equal(r.inserted,false);assert.ok(!calls.some(x=>x.sql.startsWith('INSERT INTO messages')));assert.ok(!calls.some(x=>x.sql.includes('unread_count=unread_count+')));
});

test('file upload records byte count and uses an opaque storage name',async t=>{
 const {unlink}=await import('node:fs/promises');let stored;
 t.mock.method(db,'execute',async(sql,args)=>{if(sql.startsWith('INSERT INTO files'))stored=args;return [{affectedRows:1}];});
 t.mock.method(db,'getConnection',async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,args)=>{if(sql.startsWith('INSERT INTO files'))stored=args;return sql.startsWith('SELECT')?[[]]:[{affectedRows:1}];}}));
 const app=await buildApp({initializeDatabase:false,startBackground:false});
 try{
  const login=await app.inject({method:'POST',url:'/login',payload:{password:process.env.DASHBOARD_PASSWORD}});const cookie=login.headers['set-cookie'].split(';')[0];
  const response=await app.inject({method:'POST',url:'/api/files',headers:{cookie,'content-type':'multipart/form-data; boundary=uploadBoundary'},payload:Buffer.from('--uploadBoundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--uploadBoundary--\r\n')});
  assert.equal(response.statusCode,200);assert.equal(stored[3],5);assert.match(stored[4],/^file_[a-f0-9]{32}$/);
 }finally{await app.close();if(stored)await unlink('runtime/uploads/'+stored[4]);}
});
