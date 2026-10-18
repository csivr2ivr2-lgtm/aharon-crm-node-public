import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionEngine,validateTool,authorizeTool} from '../src/ai/actions.js';
test('customer activity tool enforces read permission and audits the exact client query',async()=>{
 const {tool}=validateTool('get_client_activity',{id:'client_a'});
 assert.throws(()=>authorizeTool(tool,{actor:'dashboard',source:'chat',trustedInput:true,permissions:[]}),/tool_permission_denied/);
 const queries=[],audits=[];
 const database={execute:async(sql,args)=>{
  queries.push({sql,args});
  if(sql.includes('FROM clients WHERE'))return [[{id:'client_a',name:'A'}]];
  if(sql.includes('FROM conversations'))return [[{id:'conv_a'}]];
  return [[]];
 }};
 const engine=new ActionEngine({database});
 engine.audit=async(...args)=>audits.push(args);
 const r=await engine.execute('get_client_activity',{id:'client_a'},{actor:'dashboard',source:'chat',trustedInput:true,permissions:['read']});
 assert.equal(r.status,'completed');assert.equal(r.result.client.id,'client_a');
 assert.deepEqual(r.result.conversations[0].source,{type:'conversations',id:'conv_a',client_id:'client_a'});
 assert.ok(queries.every(q=>q.sql.startsWith('SELECT')&&q.args[0]==='client_a'));
 assert.equal(audits.length,1);assert.equal(audits[0][1],'read_completed');
 assert.deepEqual(audits[0][3],{query:{id:'client_a'}});
});
