import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProjectRisks} from '../src/ai/project-risks.js';
import {Assistant} from '../src/ai/assistant.js';
import {validateTool,authorizeTool} from '../src/ai/actions.js';
test('project risk evidence excludes future, today-only and malformed deadlines',async()=>{
 const clock=Date.parse('2026-10-18T12:00:00Z');
 const dates=['2026-10-17','2026-10-18','2026-10-19','not-a-date','2026-10-18T13:00:00+03:00','2026-99-01'];
 const r=await loadProjectRisks({clock,database:{execute:async(sql,args)=>{
  assert.match(sql,/t.status IN \('open','in_progress'\)/);assert.match(sql,/p.deleted_at IS NULL/);
  assert.deepEqual(args,[]);return [dates.map((due_date,i)=>({task_id:'t'+i,project_id:'p',due_date}))];
 }}});
 assert.deepEqual(r.items.map(x=>x.task_id),['t0','t4']);
 assert.ok(r.items.every(x=>x.cause==='unknown'&&x.source.project_id==='p'));
 assert.equal(r.timezone,'UTC');
});
test('bounded project scan reports incompleteness instead of claiming no other delays',async()=>{
 const r=await loadProjectRisks({database:{execute:async()=>[Array.from({length:201},(_,i)=>({task_id:'t'+i,project_id:'p',due_date:'2000-01-01'}))]}});
 assert.equal(r.items.length,50);assert.equal(r.limited,true);
});
test('project delay question uses only an authorized read and does not invent a cause',async()=>{
 const calls=[];
 const a=new Assistant({settings:async()=>({}),generate:async()=>{throw Error('no model');},engine:{execute:async(name,args)=>{
  calls.push({name,args});return {ok:true,status:'completed',result:{ok:true,items:[{project_name:'Project',task_title:'Review',project_id:'p',task_id:'t',due_date:'2026-10-17'}]}};
 }}});
 const r=await a.chat({message:'איזה פרויקטים מתעכבים ולמה?',context:{actor:'dashboard',source:'chat',trustedInput:true,permissions:['read']}});
 assert.deepEqual(calls,[{name:'project_risks',args:{}}]);assert.deepEqual(r.actions,[]);
 assert.match(r.reply,/הגורם לעיכוב אינו ידוע/);assert.match(r.reply,/פרויקט p \/ משימה t/);
 const {tool}=validateTool('project_risks',{});
 assert.throws(()=>authorizeTool(tool,{actor:'dashboard',permissions:[]}),/tool_permission_denied/);
});
