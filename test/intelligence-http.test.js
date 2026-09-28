import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DB_NAME='crm_test';process.env.DB_USER='crm_test';
process.env.SESSION_SECRET=randomBytes(32).toString('hex');process.env.DASHBOARD_PASSWORD=randomBytes(32).toString('hex');
const {buildApp}=await import('../src/server.js');
const {db}=await import('../src/db.js');
const {ingestMessage}=await import('../src/workspace-service.js');
const {DEFAULT_SETTINGS}=await import('../src/platform/settings.js');
const {assistant}=await import('../src/ai/assistant.js');
const {actionEngine}=await import('../src/ai/actions.js');
test.after(()=>db.end());
async function login(app){const r=await app.inject({method:'POST',url:'/login',payload:{password:process.env.DASHBOARD_PASSWORD}});return r.headers['set-cookie'].split(';')[0];}
test('all intelligence mutations and reads require dashboard authentication',async()=>{
 const app=await buildApp({initializeDatabase:false,startBackground:false});try{
  for(const [method,url] of [['GET','/api/followups'],['POST','/api/followups/f/remind'],['GET','/api/knowledge'],['GET','/api/knowledge/candidates'],['POST','/api/knowledge/candidates'],['POST','/api/knowledge/candidates/k/approve'],['PATCH','/api/knowledge/k'],['GET','/api/settings'],['PATCH','/api/settings'],['GET','/api/jobs'],['POST','/api/jobs/j/retry'],['GET','/api/audit'],['POST','/api/assistant/chat'],['POST','/api/assistant/actions/a/confirm'],['GET','/api/suggestions'],['POST','/api/suggestions/s/resolve'],['POST','/api/messages/m/feedback'],['PATCH','/api/drafts/d'],['GET','/api/reminders'],['POST','/api/reminders'],['POST','/api/projects/p/lifecycle'],['GET','/api/systems/s/relations'],['POST','/api/files/text'],['GET','/api/files/f/content'],['PATCH','/api/files/f'],['POST','/api/hostinger/accounts']])assert.equal((await app.inject({method,url})).statusCode,401,method+' '+url);
 }finally{await app.close();}
});
test('dashboard intelligence reads expose expected UI shapes',async t=>{
 t.mock.method(db,'execute',async sql=>{
  if(sql.includes('FROM app_settings'))return [[]];
  if(sql.includes('FROM ai_suggestions'))return [[{id:'s',status:'pending',payload_json:'{"name":"אתר"}'}]];
  if(sql.includes('FROM notifications'))return [[{id:'n',is_read:0,title:'מוכן'}]];
  return [[]];
 });
 const app=await buildApp({initializeDatabase:false,startBackground:false});try{const cookie=await login(app);
  for(const url of ['/api/followups','/api/knowledge','/api/knowledge/candidates','/api/settings','/api/jobs','/api/audit','/api/suggestions','/api/notifications','/api/reminders']){
   const response=await app.inject({url,headers:{cookie}});assert.equal(response.statusCode,200,url);assert.equal(response.json().ok,true);
   if(url==='/api/settings')assert.deepEqual(response.json().settings,DEFAULT_SETTINGS);
   if(url==='/api/suggestions')assert.equal(response.json().items[0].payload.name,'אתר');
  }
 }finally{await app.close();}
});
test('chat actor and permissions come from server, confirmation requires explicit click and token',async t=>{
 let received,confirmed;
 t.mock.method(assistant,'chat',async data=>{received=data;return {ok:true,reply:'שלום',actions:[]};});
 t.mock.method(actionEngine,'confirm',async(...args)=>{confirmed=args;return {ok:true,status:'completed'};});
 const app=await buildApp({initializeDatabase:false,startBackground:false});try{const cookie=await login(app);
  const r=await app.inject({method:'POST',url:'/api/assistant/chat',headers:{cookie},payload:{message:'מה חדש?',context:{actor:'attacker',permissions:['admin']}}});assert.equal(r.statusCode,200);assert.equal(received.context.actor,'dashboard');assert.deepEqual(received.context.permissions,['read','write','send']);
  const denied=await app.inject({method:'POST',url:'/api/assistant/actions/a/confirm',headers:{cookie},payload:{confirmation_token:'token'}});assert.equal(denied.statusCode,400);assert.equal(confirmed,undefined);
  const accepted=await app.inject({method:'POST',url:'/api/assistant/actions/a/confirm',headers:{cookie},payload:{confirmed:true,confirmation_token:'token'}});assert.equal(accepted.statusCode,200);assert.equal(confirmed[1],'token');
 }finally{await app.close();}
});
test('knowledge HTTP mutations use authenticated owner and enforce explicit review',async t=>{
 const writes=[];
 t.mock.method(db,'execute',async(sql,args)=>{if(sql.startsWith('SELECT'))return [[]];writes.push({sql,args});return [{affectedRows:1}];});
 const app=await buildApp({initializeDatabase:false,startBackground:false});try{
  const cookie=await login(app);
  const proposal=await app.inject({method:'POST',url:'/api/knowledge/candidates',headers:{cookie},payload:{title:'נוהל כללי',body:'יש לסכם את הבקשה לפני הכנת ההצעה.',actor:'attacker'}});
  assert.equal(proposal.statusCode,200);assert.equal(proposal.json().status,'pending');
  assert.ok(writes.some(w=>w.sql.startsWith('INSERT INTO knowledge_candidates')));
  assert.equal(writes.find(w=>w.sql.startsWith('INSERT INTO ai_audit')).args[3],'owner');
  const rejected=await app.inject({method:'POST',url:'/api/knowledge/candidates/k/approve',headers:{cookie},payload:{reviewed:false}});
  assert.equal(rejected.statusCode,400);assert.equal(rejected.json().error,'knowledge_review_required');
 }finally{await app.close();}
});
test('incoming message and processing job commit atomically, queue failure rolls both back',async t=>{
 const calls=[];let rollback=false,commit=false;
 const c={beginTransaction:async()=>{},commit:async()=>{commit=true;},rollback:async()=>{rollback=true;},release(){},execute:async(sql,args)=>{
  calls.push({sql,args});if(sql.startsWith('SELECT id FROM accounts'))return [[{id:'account'}]];if(sql.startsWith('SELECT m.id'))return [[]];if(sql.startsWith('INSERT INTO jobs'))throw Error('queue_failed');return [{affectedRows:1}];
 }};t.mock.method(db,'getConnection',async()=>c);
 await assert.rejects(ingestMessage({account:{provider:'google'},account_id:'g',external_id:'m',conversation_external_id:'t',body:'שלום'}),/queue_failed/);
 assert.equal(commit,false);assert.equal(rollback,true);assert.ok(calls.some(x=>x.sql.startsWith('INSERT INTO messages')));
});
