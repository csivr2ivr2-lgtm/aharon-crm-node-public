import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectToolCatalog} from '../src/ai/tool-catalog.js';
import {diagnoseAi} from '../src/ai/diagnostics.js';
const tools=[
 {name:'search_crm',description:'Search',args:{q:{type:'string',required:true}}},
 {name:'list_clients',description:'Clients',args:{}},
 {name:'create_client',description:'Create',args:{}},
 {name:'list_tasks',description:'Tasks',args:{}},
 {name:'create_task',description:'Create task',args:{title:{type:'string',required:true}}},
 {name:'send_whatsapp',description:'Send',args:{}},
 {name:'waiting_for_reply',description:'Waiting',args:{}}
];
test('tool catalog fits tight budget and prioritizes requested tasks',()=>{
 const result=selectToolCatalog(tools,'צור משימה חדשה',250);
 assert.ok(JSON.stringify(result).length<=250);
 assert.ok(result.some(x=>x.name==='create_task'));
});
test('unrelated and sending tools are not promoted by ordinary chat',()=>{
 const result=selectToolCatalog(tools,'שלום',200);
 assert.ok(JSON.stringify(result).length<=200);
 assert.ok(!result.some(x=>x.name==='send_whatsapp'));
});
test('diagnostic code never sends a full tool catalog or customer records',async()=>{
 const source=await readFile(new URL('../src/ai/diagnostics.js',import.meta.url),'utf8');
 assert.ok(source.includes("const {generateText}=await import('./providers.js');"));
 assert.ok(!source.includes("new Assistant("));
 assert.ok(!source.includes("buildCrmContext"));
 assert.deepEqual(await diagnoseAi({run:async()=>({ok:true,provider:'primary',model:'openai/gpt-oss-20b'})}),{connected:true,provider:'primary',model:'openai/gpt-oss-20b'});
});
test('assistant always retains safety instructions and full user message',async()=>{
 const source=await readFile(new URL('../src/ai/assistant.js',import.meta.url),'utf8');
 assert.ok(source.includes('selectToolCatalog(compactCatalog(),message,catalogBudget)'));
 assert.ok(source.includes("content:message.trim()"));
 assert.ok(source.includes('systemHeader+JSON.stringify(selectedTools)'));
});
