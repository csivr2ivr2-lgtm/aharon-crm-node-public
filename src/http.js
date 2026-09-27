import {timingSafeEqual} from "node:crypto";
import {config} from "./config.js";
export function equalToken(a,b){const aa=Buffer.from(String(a||"")),bb=Buffer.from(String(b||""));return aa.length>0&&aa.length===bb.length&&timingSafeEqual(aa,bb);}
export const constantTimeTokenEqual=equalToken;
export function bearerToken(req){return String(req.headers.authorization||"").match(/^Bearer\s+(.+)$/i)?.[1]?.trim()||"";}
export async function jsonRequest(url,{method="GET",token="",body,headers={}}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),config.httpTimeoutMs);
 try{
 const res=await fetch(url,{method,signal:controller.signal,headers:{"Accept":"application/json",...(body===undefined?{}:{"Content-Type":"application/json"}),...(token?{Authorization:"Bearer "+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await res.text();let data={};try{data=raw?JSON.parse(raw):{};}catch{data={error:"invalid_json_from_upstream"};}
 if(!res.ok){const err=Error("Upstream HTTP "+res.status);err.status=res.status;throw err;}return data;
 }finally{clearTimeout(timer);}
}
