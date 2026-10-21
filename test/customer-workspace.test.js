import test from 'node:test';
import assert from 'node:assert/strict';
import {customerWorkspace} from '../src/customer-workspace.js';
const info={client:{id:'client_a',name:'<img src=x onerror=alert(1)>',email:'a@example.test'},conversations:[{id:'conv/a',title:'<script>bad</script>',account_id:'business'}],tasks:[{id:'task1',title:'Follow up',status:'open',due_date:'2026-10-22'}],notes:[{body:'<svg onload=alert(1)>',updated_at:'2026-10-21'}]};
test('customer workspace escapes all record content and supplies direct conversation links',()=>{
 const html=customerWorkspace(info,{items:[]});
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('#conversation=conv%2Fa'));assert.ok(html.includes('business'));assert.ok(html.includes('Follow up'));
 assert.ok(!html.includes('<dialog'));assert.ok(html.includes('#client=client_a&amp;')===false);
});
test('tabs keep customer identity and mark the selected section',()=>{
 const html=customerWorkspace(info,{items:[]},{tab:'notes'});
 assert.ok(html.includes('#client=client_a&tab=notes" aria-current="page"'));
 assert.ok(html.includes('&lt;svg'));assert.ok(!html.includes('Follow up'));
});
test('unavailable sources expose no cached payload or source link',()=>{
 const html=customerWorkspace(info,{items:[{id:'r1',provider:'google.drive',account_id:'a',available:false,item:{name:'PRIVATE'}}]},{tab:'resources',sourceLink:()=>{throw Error('must not access unavailable source');}});
 assert.ok(!html.includes('PRIVATE'));assert.ok(html.includes('data-client="client_a"'));assert.ok(html.includes('אינו זמין'));
});
test('failed resources have an explicit partial error and unknown tabs fall back',()=>{
 assert.ok(customerWorkspace(info,{error:true},{tab:'resources'}).includes('אינם זמינים כרגע'));
 assert.ok(customerWorkspace(info,{items:[]},{tab:'invalid'}).includes('הפעולה הבאה'));
});
