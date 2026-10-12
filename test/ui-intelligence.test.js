import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {appHtml} from '../src/ui.js';
const source=(await readFile(new URL('../src/browser.js',import.meta.url),'utf8')).replace(/void render\(location\.hash\.slice\(1\)\|\|'home'\)\.catch\(e=>\$\('#error'\)\.textContent=e\.message\);void realtime\(\);/,'').replace("void navigateHash().catch(e=>$('#error').textContent=e.message);void realtime();",'');
function harness(responses={}){
 const elements=new Map(),calls=[],listeners={};
 const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',value:'',dataset:{},classList:{toggle(){}},scrollHeight:10,reset(){},insertAdjacentHTML(_position,html){this.innerHTML+=html;} ,closest(){return {querySelectorAll:()=>[]}}});return elements.get(key);};
 const context=vm.createContext({document:{querySelector:element,querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners[type]=fn},window:{addEventListener(){}},location:{hash:'',href:'https://crm.example/'},crypto:{randomUUID:()=> 'request-id'},URL,URLSearchParams,console,setTimeout:()=>0,clearTimeout(){},confirm:()=>true,alert(){},prompt:()=>null,FormData:class {},fetch:async(url,opt={})=>{calls.push({url,...opt});const value=responses[url]??(url.startsWith('/api/inbox/work/')?{ok:true,item:{handling_state:'review',message_type:'unknown',revision:0}}:{ok:true,items:[]});return {ok:true,status:200,json:async()=>value};}});
 vm.runInContext(source,context);return {run:code=>vm.runInContext(code,context),element,calls,context,listeners};
}
test('Hebrew RTL navigation reaches all intelligence and CRM screens',()=>{const html=appHtml();assert.match(html,/lang="he" dir="rtl"/);for(const page of ['assistant','spam','suggestions','reminders','notifications','settings','files','followups','knowledge'])assert.ok(html.includes('data-view="'+page+'"'));assert.match(html,/bi bi-/);});
test('untrusted assistant reply and action arguments are escaped, confirmation includes server token',async()=>{
 const h=harness({'/api/assistant/actions/a1/confirm':{ok:true,status:'completed'}});h.run(`assistantMessages=[{role:'assistant',text:'<img src=x onerror=alert(1)>',actions:[{id:'a1',summary:'שליחה',args:{body:'<script>bad()</script>'},status:'pending',confirmation_token:'server-issued'}]}];renderChat();`);
 assert.ok(h.element('#chatLog').innerHTML.includes('&lt;script&gt;'));assert.ok(!h.element('#chatLog').innerHTML.includes('<img'));
 await h.run(`intelligenceAction('assistant-confirm',{dataset:{id:'a1'}})`);assert.deepEqual(JSON.parse(h.calls[0].body),{confirmed:true,confirmation_token:'server-issued'});
 await h.run(`intelligenceAction('assistant-confirm',{dataset:{id:'a1'}})`);assert.equal(h.calls.length,1);assert.equal(h.run('assistantMessages[0].actions[0].confirmation_token'),undefined);
});
test('cancelled lifecycle confirmation reads relations and never mutates',async()=>{
 const h=harness({'/api/projects/p1/relations':{ok:true,relations:{tasks:3}}});h.context.confirm=()=>false;h.run(`view='projects'`);
 await h.run(`intelligenceAction('delete',{dataset:{id:'p1'}})`);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/projects/p1/relations');assert.equal(h.calls[0].method,undefined);
});
test('hard delete requires second explicit relation-detachment confirmation',async()=>{
 const h=harness({'/api/systems/077/relations':{ok:true,relations:{tasks:2}},'/api/systems':{items:[]}});h.run(`view='systems'`);await h.run(`intelligenceAction('hard_delete',{dataset:{id:'077'}})`);
 const call=h.calls.find(x=>x.url.endsWith('/lifecycle'));assert.deepEqual(JSON.parse(call.body),{action:'hard_delete',confirmed:true,detachRelations:true});
});
test('notifications respect is_read and escape server text',async()=>{
 const h=harness({'/api/notifications':{items:[{id:'a',title:'<script>x</script>',body:'<img>',is_read:1},{id:'b',title:'חדש',is_read:0}]}});await h.run(`renderIntelligence('notifications')`);
 const html=h.element('#content').innerHTML;assert.ok(!html.includes('<script>'));assert.equal((html.match(/data-action="notification-read"/g)||[]).length,1);
});
test('settings use validated schema names, typed values, and a trimmed trusted contact list',async()=>{
 const h=harness();await h.run(`saveSettings({provider:'auto',model:'model',temperature:'0.3',contextSize:'18000',fallback:'true',clients:'suggest',projects:'off',tasks:'automatic',drafts:'automatic',spam:'automatic',classification:'suggest',policy:'always_confirm',defaultAccountId:'a',signature:'שלום',trustedClientIds:' c1, c2, '})`);
 const data=JSON.parse(h.calls[0].body);assert.equal(data.ai.contextSize,18000);assert.equal(data.ai.fallback,true);assert.deepEqual(data.messaging.trustedClientIds,['c1','c2']);assert.equal(data.automation.projects,'off');
});
test('file deletion is explicitly confirmed and all identifiers are path encoded',async()=>{
 const h=harness();h.context.confirm=()=>false;await h.run(`intelligenceAction('file-delete',{dataset:{id:'../private'}})`);assert.equal(h.calls.length,0);
 await h.run(`intelligenceAction('file-read',{dataset:{id:'../private'}})`);assert.equal(h.calls[0].url,'/api/files/..%2Fprivate/content');
});
test('send confirmation displays resolved recipient, sender and body but not integration keys',()=>{
 const h=harness();h.run(`assistantMessages=[{role:'assistant',text:'פרטי שליחה',actions:[{id:'a1',tool:'send_whatsapp',args:{client_id:'opaque-client-id'},preview:{recipient:'972501234567',client:'דוד',account:'החשבון שלי',account_key:'private:internal-key',body:'היי מה איתך'},status:'pending',confirmation_token:'secret'}]}];renderChat();`);
 const html=h.element('#chatLog').innerHTML;for(const value of ['972501234567','דוד','החשבון שלי','היי מה איתך'])assert.ok(html.includes(value));assert.ok(!html.includes('private:internal-key'));assert.ok(!html.includes('opaque-client-id'));assert.ok(!html.includes('secret'));
});
test('connector controls render distinct lifecycle actions and call matching routes',async()=>{
 const h=harness({'/api/connectors':{connectors:[{key:'google',configured:true,accounts:[{id:'a/1',email:'<unsafe@example.test>'}]},{key:'hostinger-mail',configured:true,account:'me@example.test'}]},'/api/whatsapp/status':{sessions:[{id:'s1',status:'connected',label:'בדיקה'}]}});
 await h.run(`render('connectors')`);
 const html=h.element('#content').innerHTML;assert.ok(html.includes('&lt;unsafe@example.test&gt;'));assert.ok(!html.includes('<unsafe'));
 const actions=[['wa-reconnect','/api/whatsapp/reconnect','POST'],['wa-disconnect','/api/whatsapp/disconnect','POST'],['wa-delete-session','/api/whatsapp/session','DELETE'],['google-disconnect','/api/google/accounts/a%2F1','DELETE'],['hostinger-disconnect','/api/hostinger/disconnect','POST']];
 for(const [action,url,method] of actions){assert.ok((html+h.element('#wa').innerHTML).includes('data-action="'+action+'"'));const b={dataset:{action,id:'a/1'}};await h.listeners.click({target:{closest:()=>b}});assert.ok(h.calls.some(x=>x.url===url&&x.method===method));assert.equal(b.disabled,false);}
});
test('cancelling connector disconnect or session deletion never calls a mutation',async()=>{
 const h=harness();h.context.confirm=()=>false;
 for(const action of ['wa-disconnect','wa-delete-session','google-disconnect','hostinger-disconnect'])await h.listeners.click({target:{closest:()=>({dataset:{action,id:'a'}})}});
 assert.equal(h.calls.length,0);
});
test('archived file search remains available after restore and uses lifecycle flags',async()=>{
 const url='/api/files?q=invoice&include_archived=1';const h=harness({[url]:{items:[{id:'f/1',name:'invoice.txt',deleted_at:'2026-09-27',size_bytes:10}]}});
 h.run(`fileQuery='invoice'`);await h.run(`intelligenceAction('toggle-file-archive',{dataset:{}})`);
 assert.ok(h.element('#content').innerHTML.includes('בסל המחזור'));assert.ok(h.element('#content').innerHTML.includes('data-action="file-restore"'));assert.ok(!h.element('#content').innerHTML.includes('data-action="file-delete"'));
 await h.run(`intelligenceAction('file-restore',{dataset:{id:'f/1'}})`);
 const call=h.calls.find(x=>x.url==='/api/files/f%2F1/lifecycle');assert.deepEqual(JSON.parse(call.body),{action:'restore',confirmed:true});assert.equal(h.calls.filter(x=>x.url===url).length,2);
});
test('read state is independent of explicit handling state',async()=>{
 const h=harness();const html=h.run("inboxState({unread_count:0,handling_state:'needs_reply'})+inboxState({unread_count:2,handling_state:'waiting_customer'})");
 assert.match(html,/נקרא/);assert.match(html,/2 לא נקראו/);assert.match(html,/דורש טיפול/);assert.match(html,/ממתין ללקוח/);
 assert.doesNotMatch(h.run("inboxState({last_message_direction:'in'})"),/ממתין לתשובה שלך/);
});
test('settings renders real processing and login security status and escapes errors',async()=>{
 const h=harness({'/api/settings':{settings:{ai:{},automation:{},messaging:{trustedClientIds:[]}}},'/api/background/status':{enabled:true,running:false,queued:4,failed:2,last_error:'<script>bad()</script>'},'/api/security/status':{failed_attempts:3,blocked_ips:['192.0.2.1'],locked:false}});
 await h.run(`render('settings')`);const html=h.element('#content').innerHTML;assert.match(html,/ממתינות: 4 · נכשלו: 2/);assert.match(html,/ניסיונות כניסה שנכשלו: 3/);assert.match(html,/192\.0\.2\.1/);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});

test('followup screen escapes content and action modes only schedule reminders or drafts',async()=>{
 const h=harness({'/api/followups':{items:[{id:'wait/1',title:'<script>x</script>',reason:'<img>',conversation_id:'c1',due_at:'2026-09-28'},{id:'task1',title:'משימה באיחור'}]}});await h.run(`render('followups')`);
 const html=h.element('#content').innerHTML;assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img>'));assert.equal((html.match(/data-action="followup-draft"/g)||[]).length,1);
 await h.run(`intelligenceAction('followup-remind',{dataset:{id:'wait/1'}})`);await h.run(`intelligenceAction('followup-draft',{dataset:{id:'wait/1'}})`);
 const mutations=h.calls.filter(x=>x.method==='POST');assert.equal(mutations.length,2);assert.equal(mutations[0].url,'/api/followups/wait%2F1/remind');assert.deepEqual(JSON.parse(mutations[0].body),{mode:'remind'});assert.deepEqual(JSON.parse(mutations[1].body),{mode:'draft_follow_up'});assert.ok(!mutations.some(x=>x.url.includes('/send')));
});
test('knowledge generation remains pending and review renders editable escaped fields without source CRM data',async()=>{
 const candidate={id:'k/1',title:'<script>title</script>',body:'<img> procedure',status:'pending',source_message_id:'private-customer-id'};
 const h=harness({'/api/knowledge':{items:[]},'/api/knowledge/candidates':{items:[candidate,{id:'approved',title:'already approved',status:'approved'}]}});
 await h.run(`intelligenceAction('knowledge-propose',{dataset:{id:'m/1'}})`);
 const mutations=h.calls.filter(x=>x.method==='POST');assert.equal(mutations.length,1);assert.equal(mutations[0].url,'/api/knowledge/candidates');assert.deepEqual(JSON.parse(mutations[0].body),{sourceMessageId:'m/1'});
 assert.ok(!h.element('#content').innerHTML.includes('private-customer-id'));assert.ok(!h.element('#content').innerHTML.includes('already approved'));
 await h.run(`intelligenceAction('knowledge-review',{dataset:{id:'k/1'}})`);const html=h.element('#knowledgeEditor').innerHTML;assert.ok(html.includes('name="body"'));assert.ok(html.includes('&lt;img&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('name="reviewed" required'));assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
 await assert.rejects(h.run(`saveKnowledge({title:'ערוך',body:'נוהל כללי'})`));assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
 h.context.confirm=()=>false;await h.run(`saveKnowledge({title:'ערוך',body:'נוהל כללי',reviewed:'on'})`);assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
 h.context.confirm=()=>true;await h.run(`saveKnowledge({title:'ערוך',body:'נוהל כללי',reviewed:'on'})`);const approval=h.calls.find(x=>x.url.endsWith('/approve'));assert.equal(approval.url,'/api/knowledge/candidates/k%2F1/approve');assert.deepEqual(JSON.parse(approval.body),{title:'ערוך',body:'נוהל כללי',reviewed:true});
});
test('approved knowledge edits require review and archive cancellation never mutates',async()=>{
 const h=harness({'/api/knowledge':{items:[{id:'a/1',title:'נוהל',body:'תוכן',status:'approved'}]},'/api/knowledge/candidates':{items:[]}});await h.run(`render('knowledge')`);await h.run(`intelligenceAction('knowledge-edit',{dataset:{id:'a/1'}})`);
 await h.run(`saveKnowledge({title:'נוהל מתוקן',body:'תוכן כללי',reviewed:'on'})`);const change=h.calls.find(x=>x.method==='PATCH');assert.equal(change.url,'/api/knowledge/a%2F1');assert.equal(JSON.parse(change.body).reviewed,true);
 h.context.confirm=()=>false;await h.run(`intelligenceAction('knowledge-archive',{dataset:{id:'a/1'}})`);assert.equal(h.calls.filter(x=>x.method==='PATCH').length,1);
 h.context.confirm=()=>true;await h.run(`intelligenceAction('knowledge-archive',{dataset:{id:'a/1'}})`);assert.deepEqual(JSON.parse(h.calls.filter(x=>x.method==='PATCH')[1].body),{archived:true});
});
test('followup settings use typed hours and separate automation and followup modes',async()=>{
 const h=harness();await h.run(`saveSettings({trustedClientIds:'',followups:'automatic',waitingHours:'72',overdueHours:'12',followupMode:'draft_follow_up'})`);const data=JSON.parse(h.calls[0].body);assert.equal(data.automation.followups,'automatic');assert.deepEqual(data.followups,{waitingHours:72,overdueHours:12,mode:'draft_follow_up'});
});
test('both incoming and outgoing messages offer generic knowledge proposals',async()=>{
 const h=harness({'/api/conversations/c1':{item:{title:'שיחה'},messages:[{id:'in1',direction:'in',body:'הודעה'},{id:'out1',direction:'out',body:'תשובה'}]}});await h.run(`openConversation('c1')`);const html=h.element('#content').innerHTML;assert.equal((html.match(/data-action="knowledge-propose"/g)||[]).length,2);assert.ok(html.includes('data-id="in1"'));assert.ok(html.includes('data-id="out1"'));
});

test('local model screen shows safe failure, timing, both memory snapshots and test control',async()=>{
 const h=harness({'/api/ai/status':{enabled:true,model:'org/model',tokenizer_source:'org/tokenizer',attempted_model:'org/tried',attempted_tokenizer:'org/tried-tokenizer',dtype:'q4',state:'failed',load_duration_ms:1250,error:{code:'network',message:'<error>'},memory_before:{rss:1048576},memory_after:{rss:2097152}}});
 await h.run("render('ai')");const html=h.element('#content').innerHTML;assert.ok(html.includes('org/tried'));assert.ok(html.includes('org/tokenizer'));assert.ok(html.includes('org/tried-tokenizer'));assert.ok(html.includes('q4'));assert.ok(html.includes('נכשל'));assert.ok(html.includes('1.3 שניות'));assert.ok(html.includes('2.0 MB'));assert.ok(html.includes('&lt;error&gt;'));assert.ok(html.includes('Test Local AI'));
 await h.run("intelligenceAction('local-ai-test',{dataset:{}})");assert.ok(h.calls.some(c=>c.method==='POST'&&c.url==='/api/ai/test'));
});

test('settings save separate local and generative model names',async()=>{
 const h=harness();await h.run(`saveSettings({localModel:'org/tiny',externalModel:'external-text',generativeProvider:'external',trustedClientIds:''})`);
 const data=JSON.parse(h.calls[0].body);assert.equal(data.ai.localModel,'org/tiny');assert.equal(data.ai.externalModel,'external-text');assert.equal(data.ai.generativeProvider,'external');assert.ok(!('model' in data.ai));
});
test('benchmark UI shows expected/predicted labels, margin and aggregate quality without generated text',async()=>{
 const h=harness({'/api/ai/status':{enabled:true,state:'loaded',test_result:{cases:[{id:'en_1',language:'en',decisions:[{workload:'intent',expected:'support',label:'support',matched:true,margin:0.42,inference_ms:150}]}],summary:{languages:{en:{correct:18,total:20,accuracy:90,uncertain:2}},overall:{correct:18,total:20,accuracy:90,uncertain:2},workloads:{},average_inference_ms:150}}}});
 await h.run("render('ai')");const html=h.element('#content').innerHTML;for(const text of ['18/20','90.0%','expected support','predicted support','margin: 0.42'])assert.ok(html.includes(text));assert.ok(!html.includes('Test raw output'));
});


test('previous assistant session loads actions in-place and confirms via session-owned route',async()=>{
 const history='/api/assistant/sessions/chat_12345678-1234-1234-1234-123456789abc';
 const h=harness({
  '/api/assistant/sessions':{ok:true,items:[{id:'chat_12345678-1234-1234-1234-123456789abc',title:'שיחת בדיקה'}]},
  [history]:{ok:true,messages:[
   {role:'user',text:'צור משימה בשם "בדיקה"'},
   {role:'assistant',text:'פעולה ממתינה',actions:[{id:'act_123456789012',tool:'create_task',args:{title:'בדיקה'},status:'pending',confirmation_token:'TEST_NON_SECRET'}]},
   {role:'user',text:'מה עם הלקוח?'},
   {role:'assistant',text:'צריך לבדוק את פרטי הלקוח.',actions:[]}
  ]},
  [history+'/actions/act_123456789012/confirm']:{ok:true,status:'completed',result:{ok:true}}
 });
 await h.run("renderIntelligence('assistant')");
 assert.ok(h.element('#assistantSessions').innerHTML.includes('שיחת בדיקה'));
 let html=h.element('#chatLog').innerHTML;
 assert.ok(html.indexOf('data-action="assistant-confirm"')<html.indexOf('מה עם הלקוח?'));
 await h.run("intelligenceAction('assistant-confirm',{dataset:{id:'act_123456789012'}})");
 const call=h.calls.find(x=>x.url.endsWith('/actions/act_123456789012/confirm'));
 assert.ok(call);assert.deepEqual(JSON.parse(call.body),{confirmed:true,confirmation_token:'TEST_NON_SECRET'});
 html=h.element('#chatLog').innerHTML;
 assert.ok(html.indexOf('הושלם')<html.indexOf('מה עם הלקוח?'));
});
test('historical inbox triage respects explicit consent and never deletes anything',async()=>{
 const h=harness({'/api/inbox/history/triage':{ok:true,scanned:2,updated:1,proposed:1,preview:[],next_cursor:'m2',done:true},'/api/inbox':{items:[]}});
 h.run("view='inbox'");
 h.context.confirm=()=>false;
 await h.listeners.click({target:{closest:()=>({dataset:{action:'historical-triage',id:''}})}});
 assert.equal(h.calls.filter(x=>JSON.parse(x.body||'{}').dry_run===false).length,0);
 h.calls.length=0;h.context.confirm=()=>true;
 await h.listeners.click({target:{closest:()=>({dataset:{action:'historical-triage',id:''}})}});
 const requests=h.calls.filter(x=>x.url==='/api/inbox/history/triage');
 assert.equal(requests.length,2);
 assert.equal(JSON.parse(requests[0].body).dry_run,true);
 assert.equal(JSON.parse(requests[1].body).confirmed,true);
 assert.ok(!h.calls.some(x=>/DELETE|\/delete/.test(x.method||'')||/\/delete/.test(x.url)));
});
test('reply variants use existing CRM-grounded draft route and never send',async()=>{
 const h=harness({
  '/api/conversations/c1':{ok:true,item:{title:'פנייה עסקית',client_id:'',project_id:''},messages:[{id:'m1',direction:'in',classification:'normal',body:'אשמח להצעת מחיר'}]},
  '/api/clients':{items:[]},'/api/projects':{items:[]},
  '/api/conversations/c1/drafts':{items:[]},'/api/conversations/c1/read':{ok:true},
  '/api/conversations/c1/draft':{ok:true,id:'draft_1',draft:'שלום, אשמח לשלוח הצעת מחיר.'}
 });
 await h.run("openConversation('c1')");
 await h.listeners.click({target:{closest:()=>({dataset:{action:'reply-suggestion',id:'short'}})}});
 const calls=h.calls.filter(x=>x.url==='/api/conversations/c1/draft'&&x.method==='POST');
 assert.equal(calls.length,1);assert.match(JSON.parse(calls[0].body).instruction,/תשובה קצרה/);
 assert.equal(h.element('#reply').value,'שלום, אשמח לשלוח הצעת מחיר.');
 assert.ok(!h.calls.some(x=>x.url.endsWith('/send')));
});

