import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {AssistantChatHistory,migrateAssistantChats} from '../src/assistant-chat-history.js';
import {backfillInboxHistory} from '../src/ai/historical-triage.js';

function historyFixture(){
 const sessions=new Map(),turns=[],links=[],actions=new Map(),statements=[];
 const database={
  query:async q=>{statements.push(q);return [];},
  execute:async(sql,p=[])=>{
   statements.push(sql);
   if(sql.startsWith('INSERT INTO assistant_chat_sessions')){sessions.set(p[0],{id:p[0],actor:p[1],title:p[2],created_at:p[3],updated_at:p[4],archived_at:null});return [{affectedRows:1}]}
   if(sql.startsWith('SELECT id FROM assistant_chat_sessions WHERE id'))return [[...sessions.values()].filter(s=>s.id===p[0]&&s.actor===p[1]&&!s.archived_at).map(({id})=>({id}))];
   if(sql.startsWith('SELECT id,title,created_at'))return [[...sessions.values()].filter(s=>s.actor===p[0]&&!s.archived_at)];
   if(sql.startsWith('INSERT INTO assistant_chat_turns')){turns.push({id:p[0],session_id:p[1],role:p[2],body:p[3],request_id:p[4],created_at:p[5]});return [{affectedRows:1}]}
   if(sql.startsWith('SELECT id FROM assistant_chat_turns'))return [turns.filter(t=>t.session_id===p[0]&&t.request_id===p[1]&&t.role==='user').map(t=>({id:t.id}))];
   if(sql.startsWith('SELECT role,body,('))return [turns.filter(t=>t.session_id===p.at(-2)&&t.request_id!==p.at(-1)).filter(t=>p.slice(0,-2).some(term=>t.body.includes(term))).slice(0,6)];
   if(sql.startsWith('SELECT role,body FROM assistant_chat_turns'))return [turns.filter(t=>t.session_id===p[0]&&t.request_id!==p[1]).slice(-12).map(t=>({role:t.role,body:t.body})).reverse()];
   if(sql.startsWith('SELECT id,role,body'))return [turns.filter(t=>t.session_id===p[0]).slice(-400).reverse()];
   if(sql.startsWith('INSERT INTO assistant_chat_actions')){links.push({action_id:p[0],session_id:p[1],turn_id:p[2],tool:p[3],args_json:p[4],preview_json:p[5],dismissed_at:null});return [{affectedRows:1}]}
   if(sql.startsWith('SELECT l.action_id'))return [links.filter(l=>l.session_id===p[0]).map(l=>({...l,state:actions.get(l.action_id)||'pending',expires_at:'2099-01-01'}))];
   if(sql.startsWith('SELECT action_id FROM assistant_chat_actions'))return [links.filter(l=>l.action_id===p[0]&&l.session_id===p[1]&&!l.dismissed_at).map(l=>({action_id:l.action_id}))];
   if(sql.startsWith('UPDATE assistant_chat_sessions SET title')){const s=sessions.get(p[3]);if(s&&s.title===p[0])s.title=p[1];return [{affectedRows:1}]}
   if(sql.startsWith('UPDATE assistant_chat_sessions SET archived_at')){const s=sessions.get(p[2]);s.archived_at=p[0];return [{affectedRows:1}]}
   if(sql.startsWith('UPDATE assistant_chat_actions SET dismissed_at')){const l=links.find(x=>x.action_id===p[1]);l.dismissed_at=p[0];return [{affectedRows:1}]}
   throw Error('Unexpected sql '+sql);
  },
  getConnection:async()=>({beginTransaction:async()=>{},execute:(...x)=>database.execute(...x),commit:async()=>{},rollback:async()=>{},release:()=>{}})
 };
 const engine={
  reissuePendingToken:async()=> 'ROTATED_TEST_TOKEN',
  dismissPending:async(id)=>{actions.set(id,'dismissed');return {ok:true}}
 };
 return {database,engine,sessions,turns,links,statements,actions};
}
test('history schema contains distinct sessions, turns and action bindings',async()=>{
 const f=historyFixture();await migrateAssistantChats(f.database);
 assert.equal(f.statements.filter(x=>x.startsWith('CREATE TABLE')).length,3);
});
test('assistant actions are anchored in their assistant turn and reload after later messages',async()=>{
 const f=historyFixture();let calls=0;
 const assistant={chat:async()=>{calls++;return calls===1?{reply:'צריך אישור',actions:[{id:'act_test_task_123456789012',tool:'create_task',args:{title:'בדיקת AI'},status:'pending',confirmation_token:'SECRET_TEST'}]}:{reply:'הנה התשובה השנייה',actions:[]};}};
 const svc=new AssistantChatHistory({database:f.database,engine:f.engine,assistant,clock:()=>new Date(Date.now()+calls*1000).toISOString()});
 const first=await svc.create();const sessionId=first.id;
 await svc.send({sessionId,message:'צור משימה בשם "בדיקת AI"',requestId:'request_test_one',context:{},actor:'dashboard'});
 await svc.send({sessionId,message:'מה שלום הלקוח?',requestId:'request_test_two',context:{},actor:'dashboard'});
 const loaded=await svc.load(sessionId);
 assert.equal(loaded.messages.length,4);
 assert.equal(loaded.messages[1].actions[0].id,'act_test_task_123456789012');
 assert.equal(loaded.messages[1].actions[0].confirmation_token,'ROTATED_TEST_TOKEN');
 assert.equal(loaded.messages[3].actions.length,0);
 assert.ok(!f.links[0].args_json.includes('SECRET_TEST'));
 assert.equal((await svc.list()).items[0].title,'צור משימה בשם "בדיקת AI"');
});
test('chat/action ownership checks cannot cross sessions and archive is reversible in storage',async()=>{
 const f=historyFixture();const svc=new AssistantChatHistory({database:f.database,engine:f.engine,assistant:{chat:async()=>({reply:'',actions:[]})}});
 const a=(await svc.create()).id,b=(await svc.create()).id;
 await assert.rejects(()=>svc.actionBelongs(b,'act_unknown'),/assistant_action_not_in_chat/);
 await svc.archive(a);await assert.rejects(()=>svc.load(a),/assistant_chat_not_found/);
 assert.equal((await svc.list()).items.length,1);
});

test('history classifier updates only high confidence old marketing/system/spam messages',async()=>{
 const initial=[
  {id:'a',sender:'feed@example.com',subject:'Welcome to Supabase',body:'Welcome',classification:'normal',spam_disposition:'inbox',channel:'email'},
  {id:'b',sender:'customer@example.com',subject:'בירור לגבי 10 מספרים',body:'אני צריך מספרים לקבלת SMS',classification:'normal',spam_disposition:'inbox',channel:'email'},
  {id:'c',sender:'owner@example.com',subject:'Your temporary ChatGPT login code',body:'code',classification:'normal',spam_disposition:'inbox',classification_reason:'סיווג ידני של המשתמש'},
  {id:'d',sender:'x@example.com',subject:'You have won lottery winner!',body:'Prize',classification:'unknown',spam_disposition:'inbox',channel:'email'}
 ];
 const changed=[];
 const database={execute:async(sql,p)=>{
  if(sql.startsWith('SELECT m.id'))return [initial.filter(m=>m.id>p[0])];
  if(sql.startsWith('INSERT INTO message_intelligence'))return [{affectedRows:1}];
  if(sql.startsWith('UPDATE messages SET')){changed.push({id:p[4],classification:p[0],folder:p[3]});return [{affectedRows:1}];}
  throw Error(sql);
 }};
 const report=await backfillInboxHistory({cursor:'',limit:200},database);
 assert.equal(report.scanned,4);assert.equal(report.done,true);
 assert.ok(changed.some(c=>c.id==='a'&&c.folder==='updates'));
 assert.ok(changed.some(c=>c.id==='d'&&c.folder==='spam'));
 assert.ok(!changed.some(c=>c.id==='b'||c.id==='c'));
});

test('UI keeps approvals by the original assistant turn, not the bottom',async()=>{
 const source=(await readFile(new URL('../src/browser.js',import.meta.url),'utf8')).replace(/void render\(location\.hash\.slice\(1\)\|\|'home'\)\.catch\(e=>\$\('#error'\)\.textContent=e\.message\);void realtime\(\);/,'').replace("void navigateHash().catch(e=>$('#error').textContent=e.message);void realtime();",'');
 const elements=new Map();
 const el=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',scrollTop:0,scrollHeight:100,dataset:{},classList:{toggle(){}},insertAdjacentHTML(){}});return elements.get(key)};
 const context=vm.createContext({document:{querySelector:el,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},location:{hash:''},crypto:{randomUUID:()=> 'request-uuid'},URL,console,FormData:class{},fetch:async()=>({ok:true,status:200,json:async()=>({ok:true})})});
 vm.runInContext(source,context);
 vm.runInContext("assistantMessages=[{role:'user',text:'תכין משימה'},{role:'assistant',text:'ממתין לאישור',actions:[{id:'act-1',tool:'create_task',status:'pending',args:{title:'בדיקת AI'},confirmation_token:'SECRET'}]},{role:'user',text:'מה התאריך?'},{role:'assistant',text:'היום'}];renderChat();",context);
 const html=el('#chatLog').innerHTML;
 assert.ok(html.indexOf('ממתין לאישור')<html.indexOf('data-action="assistant-confirm"'));
 assert.ok(html.indexOf('data-action="assistant-confirm"')<html.indexOf('מה התאריך?'));
 assert.ok(!html.includes('SECRET'));
});



test('long chats load the newest 400 turns and recall old relevant turns only within that session',async()=>{
 const f=historyFixture();let captured;
 const svc=new AssistantChatHistory({database:f.database,engine:f.engine,assistant:{chat:async input=>{captured=input;return {reply:'בדקתי',actions:[]};}}});
 const a=(await svc.create()).id,b=(await svc.create()).id;
 f.turns.push({id:'old',session_id:a,role:'user',body:'מחירון אוריון נקבע לתשעה שקלים',request_id:'old_request',created_at:'2020-01-01'});
 f.turns.push({id:'private',session_id:b,role:'user',body:'מחירון אוריון של לקוח אחר',request_id:'private_request',created_at:'2020-01-01'});
 for(let i=0;i<410;i++)f.turns.push({id:'turn'+i,session_id:a,role:i%2?'assistant':'user',body:'שיחה אחרת '+i,request_id:'r'+i,created_at:new Date(1700000000000+i*1000).toISOString()});
 const loaded=await svc.load(a);assert.equal(loaded.messages.length,400);assert.equal(loaded.messages.at(-1).id,'turn409');
 await svc.send({sessionId:a,message:'מה מחירון אוריון?',requestId:'recall_request',context:{}});
 assert.ok(captured.recalledHistory.some(x=>x.text.includes('תשעה')));
 assert.ok(!captured.recalledHistory.some(x=>x.text.includes('לקוח אחר')));
});
