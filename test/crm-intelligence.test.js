import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrmIntelligence} from '../src/crm-intelligence.js';
function fixture(type='project',overrides={}){
 const calls=[],item={id:'p1',did:'0771234567',status:'active',deleted_at:null,archived_at:null,...overrides};let committed=false,rolled=false;
 const db={getConnection:async()=>db,beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolled=true;},release(){},execute:async(sql,values=[])=>{
 calls.push({sql,values});if(sql.startsWith('SELECT * FROM '+(type==='project'?'projects':'systems')))return [[{...item}]];
 if(sql.startsWith('SELECT * FROM entity_relations'))return [[{id:1,from_type:'task',from_id:'t1',to_type:type,to_id:item.id}]];
 if(sql.startsWith('SELECT id FROM crm_notes'))return [[{id:'n1'}]];
 if(sql.startsWith('SELECT'))return [[]];return [{affectedRows:1}];}};
 return {api:createCrmIntelligence({db}),calls,get committed(){return committed;},get rolled(){return rolled;}};
}
for(const type of ['project','system']){
 test(`${type} archive retains records and audits`,async()=>{const f=fixture(type);await f.api.changeLifecycle(type,'p1','archive');assert.ok(f.committed);assert.ok(f.calls.some(x=>x.sql.startsWith('UPDATE '+(type==='project'?'projects':'systems'))));assert.ok(f.calls.some(x=>x.sql.includes('INSERT INTO ai_audit')));assert.equal(f.calls.filter(x=>x.sql.startsWith('DELETE')).length,0);});
 test(`${type} soft delete requires explicit confirmation and preserves relations`,async()=>{const f=fixture(type);await assert.rejects(f.api.changeLifecycle(type,'p1','delete'),/confirmation_required/);await f.api.changeLifecycle(type,'p1','delete',{confirmed:true});assert.equal(f.calls.filter(x=>x.sql.startsWith('DELETE')).length,0);});
 test(`${type} hard delete requires prior soft deletion and explicit detachment`,async()=>{const f=fixture(type);await assert.rejects(f.api.changeLifecycle(type,'p1','hard_delete',{confirmed:true}),/soft_delete_required_first/);const soft=fixture(type,{deleted_at:'2026-09-01'});await assert.rejects(soft.api.changeLifecycle(type,'p1','hard_delete',{confirmed:true}),/related_records_require_detach_confirmation/);assert.ok(soft.rolled);await soft.api.changeLifecycle(type,'p1','hard_delete',{confirmed:true,detachRelations:true});assert.ok(soft.calls.some(x=>x.sql.startsWith('DELETE FROM entity_relations')));if(type==='project')assert.equal(soft.calls.filter(x=>/^UPDATE (systems|conversations|files|reminders) SET project_id=NULL/.test(x.sql)).length,4);});
 test(`${type} restore clears both lifecycle timestamps`,async()=>{const f=fixture(type,{deleted_at:'2026-09-01',archived_at:'2026-09-01'});await f.api.changeLifecycle(type,'p1','restore');const update=f.calls.find(x=>x.sql.startsWith('UPDATE'));assert.deepEqual(update.values.slice(0,2),[null,null]);});
}
test('reminder validation prevents invalid date and external-send modes',async()=>{const f=fixture();await assert.rejects(f.api.createReminder({title:'x',due_at:'garbage'}),/invalid_reminder/);await assert.rejects(f.api.createReminder({title:'x',due_at:'2026-10-01',mode:'auto_send'}),/invalid_reminder_mode/);});
test('reminder retry resolves existing source instead of duplicating',async()=>{const writes=[];const db={getConnection:async()=>db,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,p)=>{writes.push(sql);if(sql.startsWith('INSERT IGNORE INTO reminders'))return [{affectedRows:0}];if(sql.startsWith('SELECT id FROM reminders'))return [[{id:'existing'}]];throw Error(sql);}};const result=await createCrmIntelligence({db}).createReminder({title:'Call',due_at:'2026-10-01',source_key:'message:1'});assert.equal(result.id,'existing');assert.equal(result.duplicate,true);assert.equal(writes.length,2);});

for(const scenario of ['current','reply','done','rescheduled','archived'])test('due followup handles '+scenario+' source without stale notification',async()=>{
 const writes=[],task=['done','rescheduled'].includes(scenario);
 const reminder={id:'r',status:'pending',title:'Follow up',conversation_id:task?null:'c',task_id:task?'t':null,project_id:scenario==='archived'?'p':null,mode:'draft_follow_up',notes:JSON.stringify({text:'Readable reminder',followup:{messageId:'m',anchorAt:'2026-09-01T23:59:59.999Z'}})};
 let claimed=false;
 const db={getConnection:async()=>db,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},execute:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM reminders')){if(claimed)return [[]];claimed=true;return [[reminder]];}
  if(sql.startsWith('SELECT id,classification'))return [[{id:scenario==='reply'?'new':'m',classification:'normal',spam_disposition:'inbox'}]];
  if(sql.startsWith('SELECT status,due_date'))return [[{status:scenario==='done'?'done':'open',due_date:scenario==='rescheduled'?'2026-10-01':'2026-09-01'}]];
  if(sql.startsWith('SELECT status,archived_at'))return [[{status:'active',archived_at:'2026-09-28'}]];
  writes.push({sql,args});return [{affectedRows:1}];
 }};
 await createCrmIntelligence({db}).processDueReminders();
 const notification=writes.find(w=>w.sql.startsWith('INSERT IGNORE INTO notifications'));
 if(scenario==='current'){assert.equal(notification.args[3],'Readable reminder');assert.ok(writes.some(w=>w.sql.startsWith('INSERT IGNORE INTO jobs')));}
 else{assert.equal(notification,undefined);assert.ok(!writes.some(w=>w.sql.startsWith('INSERT IGNORE INTO jobs')));assert.ok(writes.some(w=>w.sql.includes("status='cancelled'")));assert.ok(writes.some(w=>w.sql.startsWith('INSERT INTO ai_audit')));}
});
