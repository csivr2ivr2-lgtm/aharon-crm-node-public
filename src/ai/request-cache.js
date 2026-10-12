import {createHash} from 'node:crypto';
// Process-local only: no customer text or provider keys are written to disk.
export function createRequestCache({ttl=30000,maxEntries=64,clock=Date.now}={}){
 const values=new Map(),pending=new Map();
 return async function cached(key,generate){
  const hash=createHash('sha256').update(key).digest('hex'),old=values.get(hash);
  if(old&&old.expires>clock())return structuredClone(old.value);
  if(pending.has(hash))return structuredClone(await pending.get(hash));
  const promise=Promise.resolve().then(generate);pending.set(hash,promise);
  try{
   const value=await promise;
   for(const [id,item] of values)if(item.expires<=clock())values.delete(id);
   if(values.size>=maxEntries)values.delete(values.keys().next().value);
   values.set(hash,{value:structuredClone(value),expires:clock()+ttl});return value;
  }finally{pending.delete(hash);}
 };
}
