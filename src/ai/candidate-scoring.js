// Teacher-forced causal likelihood. Each token is scored against its preceding prefix.
export function logProbability(logits,offset,size,token){
 if(!Number.isInteger(token)||token<0||token>=size)throw Error('invalid_candidate_token');
 let max=-Infinity;for(let i=0;i<size;i++)max=Math.max(max,Number(logits[offset+i]));
 if(!Number.isFinite(max))throw Error('invalid_logits');
 let sum=0;for(let i=0;i<size;i++)sum+=Math.exp(Number(logits[offset+i])-max);
 const score=Number(logits[offset+token])-max-Math.log(sum);
 if(!Number.isFinite(score))throw Error('invalid_logits');return score;
}
export function rankCandidates(scores,{minMargin=0.15,lengthNormalize=true}={}){
 const ranked=scores.map(({label,sum,tokens})=>{
  if(!Number.isFinite(sum)||!Number.isInteger(tokens)||tokens<1)throw Error('invalid_score');
  return {label,score:lengthNormalize?sum/tokens:sum};
 }).sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label));
 if(ranked.length<2)throw Error('invalid_candidates');
 const margin=ranked[0].score-ranked[1].score;
 return {label:margin<=Math.max(0,minMargin)?'uncertain':ranked[0].label,score:ranked[0].score,margin};
}
function dispose(value,seen=new Set()){
 if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
 if(typeof value.dispose==='function'){value.dispose();return;}
 for(const child of Object.values(value))dispose(child,seen);
}
export async function scoreCandidates({network,encoder,Tensor,prompt,candidates,minMargin=0.15,lengthNormalize=true}){
 let prefix=encoder.encode(prompt,{add_special_tokens:true});
 // Keep instruction and response boundary, with a bounded amount of input between them.
 if(prefix.length>384)prefix=[...prefix.slice(0,96),...prefix.slice(-288)];
 if(!prefix.length)throw Error('empty_prompt');
 const scores=[];
 for(const label of candidates){
  const tokens=encoder.encode(label,{add_special_tokens:false});
  if(!tokens.length||tokens.length>16)throw Error('invalid_candidate_tokens');
  const ids=[...prefix,...tokens.slice(0,-1)];
  const input_ids=new Tensor('int64',BigInt64Array.from(ids,BigInt),[1,ids.length]);
  const attention_mask=new Tensor('int64',new BigInt64Array(ids.length).fill(1n),[1,ids.length]);
  let output;
  try{
   output=await network.forward({input_ids,attention_mask});
   const logits=output.logits,[batch,positions,vocab]=logits?.dims||[];
   if(batch!==1||positions!==ids.length||!Number.isInteger(vocab)||vocab<2)throw Error('invalid_logits_shape');
   let sum=0;for(let j=0;j<tokens.length;j++)sum+=logProbability(logits.data,(prefix.length-1+j)*vocab,vocab,Number(tokens[j]));
   scores.push({label,sum,tokens:tokens.length});
  }finally{dispose(output);dispose(input_ids);dispose(attention_mask);}
 }
 return rankCandidates(scores,{minMargin,lengthNormalize});
}
