import {z} from 'zod';
export const TINY_WORKLOADS=['classify','spam','intent','extraction','suggestions'];
export const tinyTestSchema=z.object({intent:z.enum(['support','sales','follow_up','other']),needs_reply:z.boolean(),has_task:z.boolean()}).strict();
const instruction='Return only valid JSON matching exactly this schema:\n{"intent":"support|sales|follow_up|other","needs_reply":true,"has_task":true}';
export const tinyTestCases=[
 {language:'en',messages:[{role:'system',content:instruction},{role:'user',content:'Hello, please call me tomorrow about the new website'}]},
 {language:'he',messages:[{role:'system',content:instruction},{role:'user',content:'שלום, אשמח שתתקשר אלי מחר לגבי האתר החדש'}]}
];
export const tinyTestMessages=tinyTestCases[1].messages;
export function alpacaPrompt(messages){
 const instruction=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n').slice(0,800);
 const input=messages.filter(m=>m.role==='user').map(m=>m.content).join('\n').slice(0,3200);
 return 'Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.\n\n### Instruction:\n'+instruction+'\n\nDo not add explanations, markdown or code fences.\n\n### Input:\n'+input+'\n\n### Response:\n';
}
// Formatting only: never repair syntax, values, missing fields or extra keys.
export function structuredResult(text,schema){
 const result={json_extracted:false,json_parsed:false,schema_valid:false};
 if(typeof text!=='string'||text.length>12000)return result;
 let source=text.trim();
 const fence=source.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);if(fence)source=fence[1].trim();
 if(source.includes('```'))return result;
 if(!source.startsWith('{')){
  const start=source.indexOf('{');if(start<0||start>120||/[\[\]{}]/.test(source.slice(0,start)))return result;source=source.slice(start);
 }
 let depth=0,quoted=false,escaped=false,end=-1;
 for(let i=0;i<source.length;i++){
  const c=source[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break;}
 }
 if(end<0||source.slice(end).trim().length>120||/[{}\[\]]/.test(source.slice(end)))return result;
 result.json_extracted=true;
 let value;try{value=JSON.parse(source.slice(0,end));}catch{return result;}
 result.json_parsed=true;const parsed=schema.safeParse(value);if(parsed.success){result.schema_valid=true;result.data=parsed.data;}return result;
}
export function parseStructured(text,schema){
 const result=structuredResult(text,schema);
 if(!result.schema_valid)throw Error(result.json_parsed?'invalid_ai_schema':'invalid_ai_json');return result.data;
}
