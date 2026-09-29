import {z} from 'zod';
export const TINY_WORKLOADS=['classify','spam','intent','extraction','suggestions'];
export const tinyTestSchema=z.object({intent:z.enum(['support','sales','follow_up','other']),needs_reply:z.boolean(),has_task:z.boolean()}).strict();
export const LABELS={intent:['support','sales','follow_up','other'],task:['yes','no'],needs_reply:['yes','no'],classify:['normal','spam','suspicious','automated','marketing','system','unknown'],spam:['yes','no']};
const instructions={intent:'Classify the message.',task:'Does this message contain a task or requested action?',needs_reply:'Does this message require a reply?',classify:'Classify the inbound message.',spam:'Is this message spam?'};
export function parseLabel(text,workload){
 if(typeof text!=='string'||text.length>500||!Object.hasOwn(LABELS,workload))throw Error('invalid_output');
 let label=text.trim();const fence=label.match(/^```(?:[a-z]+[ \t]*\n)?([\s\S]*?)```$/i);if(fence)label=fence[1].trim();
 label=label.replace(/[.!?,;:]+$/,'').trim();
 if(!LABELS[workload].includes(label))throw Error('invalid_output');return label;
}
export function labelSchema(workload){
 if(!Object.hasOwn(LABELS,workload))throw Error('invalid_tiny_workload');
 return {tinyLabel:workload,safeParse(text){try{return {success:true,data:parseLabel(text,workload)};}catch{return {success:false};}}};
}
export function labelMessages(workload,input){
 if(!Object.hasOwn(LABELS,workload))throw Error('invalid_tiny_workload');
 return [{role:'system',content:instructions[workload]+'\nReply with exactly one word:\n'+LABELS[workload].join('\n')},{role:'user',content:String(input).slice(0,1200)}];
}
export const tinyTestCases=[{language:'en',input:'Hello, please call me tomorrow for help with my website'},{language:'he',input:'שלום, אשמח שתתקשר אלי מחר כדי לעזור לי עם האתר'}];
export const tinyTestMessages=labelMessages('intent',tinyTestCases[1].input);
export function alpacaPrompt(messages){
 const instruction=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n').slice(0,800);
 const input=messages.filter(m=>m.role==='user').map(m=>m.content).join('\n').slice(0,1200);
 return '### Instruction:\n'+instruction+'\n\n### Input:\n'+input+'\n\n### Response:\n';
}
export function localContract(text,schema){
 if(!schema?.tinyLabel)return {schema_valid:false,label:null};
 const parsed=schema.safeParse(text);return {schema_valid:parsed.success,label:parsed.success?parsed.data:null};
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
