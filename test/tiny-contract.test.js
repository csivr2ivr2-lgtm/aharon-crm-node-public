import test from 'node:test';
import assert from 'node:assert/strict';
import {alpacaPrompt,parseStructured,structuredResult,tinyTestSchema,tinyTestCases,labelMessages,parseLabel} from '../src/ai/tiny-contract.js';
const value={intent:'support',needs_reply:true,has_task:true},json=JSON.stringify(value);
test('exact short Alpaca label template in both languages',()=>{
 for(const sample of tinyTestCases)assert.equal(alpacaPrompt(labelMessages('intent',sample.input)),`### Instruction:
Classify the message.
Reply with exactly one word:
support
sales
follow_up
other

### Input:
${sample.input}

### Response:
`);
});
for(const text of ['support','```support```',' support \n','support.','support!','```text\nsupport\n```','```\nsupport\n```'])test('intent accepts only bounded formatting: '+text,()=>assert.equal(parseLabel(text,'intent'),'support'));
for(const text of ['SUPPORT','yes','support because','{"intent":"support"}','support yes','unknown'])test('invalid intent label rejected: '+text,()=>assert.throws(()=>parseLabel(text,'intent')));
test('yes/no labels are exact and independent for task and reply',()=>{
 for(const workload of ['task','needs_reply']){for(const label of ['yes','no'])assert.equal(parseLabel(label,workload),label);assert.throws(()=>parseLabel('true',workload));}
});

for(const [name,text] of [['pure',json],['whitespace',' \n'+json+'\n '],['fence','```json\n'+json+'\n```'],['noise','Result: '+json+'\nDone.']])test('structured parser accepts '+name,()=>assert.deepEqual(parseStructured(text,tinyTestSchema),value));
for(const text of ['{"intent":','{"intent":"invalid","needs_reply":true,"has_task":true}','{"intent":"support"}',json.slice(0,-1)+',"extra":1}',json+' '+json,'x'.repeat(121)+json,'['+json+']','```json\n'+json+'\n``` more'])test('strict parser rejects '+text.slice(0,35),()=>assert.throws(()=>parseStructured(text,tinyTestSchema)));
test('balanced scanning respects escaped quotes and braces inside JSON strings',()=>{
 const schema={safeParse:v=>({success:true,data:v})};assert.deepEqual(parseStructured('Result: {"text":"brace } and \\" quote"} done',schema),{text:'brace } and " quote'});
 assert.deepEqual(structuredResult('{"intent":}',tinyTestSchema),{json_extracted:true,json_parsed:false,schema_valid:false});
});
