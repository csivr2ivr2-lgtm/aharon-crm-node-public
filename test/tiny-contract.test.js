import test from 'node:test';
import assert from 'node:assert/strict';
import {alpacaPrompt,parseStructured,structuredResult,tinyTestSchema,tinyTestCases} from '../src/ai/tiny-contract.js';
const value={intent:'support',needs_reply:true,has_task:true},json=JSON.stringify(value);
test('exact shared Alpaca template for fixed English and Hebrew inputs',()=>{
 for(const sample of tinyTestCases)assert.equal(alpacaPrompt(sample.messages),`Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.

### Instruction:
Return only valid JSON matching exactly this schema:
{"intent":"support|sales|follow_up|other","needs_reply":true,"has_task":true}

Do not add explanations, markdown or code fences.

### Input:
${sample.messages[1].content}

### Response:
`);
});
for(const [name,text] of [['pure',json],['whitespace',' \n'+json+'\n '],['fence','```json\n'+json+'\n```'],['noise','Result: '+json+'\nDone.']])test('structured parser accepts '+name,()=>assert.deepEqual(parseStructured(text,tinyTestSchema),value));
for(const text of ['{"intent":','{"intent":"invalid","needs_reply":true,"has_task":true}','{"intent":"support"}',json.slice(0,-1)+',"extra":1}',json+' '+json,'x'.repeat(121)+json,'['+json+']','```json\n'+json+'\n``` more'])test('strict parser rejects '+text.slice(0,35),()=>assert.throws(()=>parseStructured(text,tinyTestSchema)));
test('balanced scanning respects escaped quotes and braces inside JSON strings',()=>{
 const schema={safeParse:v=>({success:true,data:v})};assert.deepEqual(parseStructured('Result: {"text":"brace } and \\" quote"} done',schema),{text:'brace } and " quote'});
 assert.deepEqual(structuredResult('{"intent":}',tinyTestSchema),{json_extracted:true,json_parsed:false,schema_valid:false});
});
