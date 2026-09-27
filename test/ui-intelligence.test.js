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
