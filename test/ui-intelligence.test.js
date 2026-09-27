import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {appHtml} from '../src/ui.js';
const source=(await readFile(new URL('../src/browser.js',import.meta.url),'utf8')).replace(/void render\(location\.hash\.slice\(1\)\|\|'home'\)\.catch\(e=>\$\('#error'\)\.textContent=e\.message\);void realtime\(\);/,'');
function harness(responses={}){
 const elements=new Map(),calls=[],listeners={};
 const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',value:'',dataset:{},classList:{toggle(){}},scrollHeight:10,reset(){},insertAdjacentHTML(_position,html){this.innerHTML+=html;}});return elements.get(key);};
 const context=vm.createContext({document:{querySelector:element,querySelectorAll:()=>[],addEventListener:(type,fn)=>listeners[type]=fn},window:{addEventListener(){}},location:{hash:'',href:'https://crm.example/'},crypto:{randomUUID:()=> 'request-id'},URL,console,confirm:()=>true,alert(){},prompt:()=>null,FormData:class {},fetch:async(url,opt={})=>{calls.push({url,...opt});const value=responses[url]??{ok:true,items:[]};return {ok:true,status:200,json:async()=>value};}});
 vm.runInContext(source,context);return {run:code=>vm.runInContext(code,context),element,calls,context,listeners};
}
test('Hebrew RTL navigation reaches all intelligence and CRM screens',()=>{const html=appHtml();assert.match(html,/lang="he" dir="rtl"/);for(const page of ['assistant','spam','suggestions','reminders','notifications','settings','files'])assert.ok(html.includes('data-view="'+page+'"'));assert.match(html,/bi bi-/);});
test('untrusted assistant reply and action arguments are escaped, confirmation includes server token',async()=>{
 const h=harness();h.run(`assistantMessages=[{role:'assistant',text:'<img src=x onerror=alert(1)>'}];pendingActions=[{id:'a1',summary:'שליחה',args:{body:'<script>bad()</script>'},status:'pending',confirmation_token:'server-issued'}];renderChat();`);
 assert.ok(h.element('#chatLog').innerHTML.includes('&lt;script&gt;'));assert.ok(!h.element('#chatLog').innerHTML.includes('<img'));
 await h.run(`intelligenceAction('assistant-confirm',{dataset:{id:'a1'}})`);assert.deepEqual(JSON.parse(h.calls[0].body),{confirmed:true,confirmation_token:'server-issued'});
 await h.run(`intelligenceAction('assistant-confirm',{dataset:{id:'a1'}})`);assert.equal(h.calls.length,1);assert.equal(h.run('pendingActions[0].confirmation_token'),undefined);
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
 const h=harness();h.run(`pendingActions=[{id:'a1',tool:'send_whatsapp',args:{client_id:'opaque-client-id'},preview:{recipient:'972501234567',client:'דוד',account:'החשבון שלי',account_key:'private:internal-key',body:'היי מה איתך'},status:'pending',confirmation_token:'secret'}];renderChat();`);
 const html=h.element('#chatLog').innerHTML;for(const value of ['972501234567','דוד','החשבון שלי','היי מה איתך'])assert.ok(html.includes(value));assert.ok(!html.includes('private:internal-key'));assert.ok(!html.includes('opaque-client-id'));assert.ok(!html.includes('secret'));
});
test('connector controls render distinct lifecycle actions and call matching routes',async()=>{
 const h=harness({'/api/connectors':{connectors:[{key:'google',configured:true,accounts:[{id:'a/1',email:'<unsafe@example.test>'}]},{key:'hostinger-mail',configured:true,account:'me@example.test'}]},'/api/whatsapp/status':{status:'connected'}});
 await h.run(`render('connectors')`);
 const html=h.element('#content').innerHTML;assert.ok(html.includes('&lt;unsafe@example.test&gt;'));assert.ok(!html.includes('<unsafe'));
 const actions=[['wa-reconnect','/api/whatsapp/reconnect','POST'],['wa-disconnect','/api/whatsapp/disconnect','POST'],['wa-delete-session','/api/whatsapp/session','DELETE'],['google-disconnect','/api/google/accounts/a%2F1','DELETE'],['hostinger-disconnect','/api/hostinger/disconnect','POST']];
 for(const [action,url,method] of actions){assert.ok(html.includes('data-action="'+action+'"'));const b={dataset:{action,id:'a/1'}};await h.listeners.click({target:{closest:()=>b}});assert.ok(h.calls.some(x=>x.url===url&&x.method===method));assert.equal(b.disabled,false);}
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
test('read messages may still wait for a reply and outgoing unread messages do not wait for us',async()=>{
 const h=harness({'/api/inbox':{items:[{id:'c1',title:'read incoming',unread_count:0,last_message_direction:'in'},{id:'c2',title:'unread outgoing',unread_count:2,last_message_direction:'out'}]}});await h.run(`render('inbox')`);
 const html=h.element('#content').innerHTML;assert.match(html,/נקרא/);assert.match(html,/2 לא נקראו/);assert.equal((html.match(/ממתין לתשובה שלך/g)||[]).length,1);assert.equal((html.match(/ממתין לתשובת הצד השני/g)||[]).length,1);
});
test('settings renders real processing and login security status and escapes errors',async()=>{
 const h=harness({'/api/settings':{settings:{ai:{},automation:{},messaging:{trustedClientIds:[]}}},'/api/background/status':{enabled:true,running:false,queued:4,failed:2,last_error:'<script>bad()</script>'},'/api/security/status':{failed_attempts:3,blocked_ips:['192.0.2.1'],locked:false}});
 await h.run(`render('settings')`);const html=h.element('#content').innerHTML;assert.match(html,/ממתינות: 4 · נכשלו: 2/);assert.match(html,/ניסיונות כניסה שנכשלו: 3/);assert.match(html,/192\.0\.2\.1/);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
