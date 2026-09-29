// Shared deterministic address handling for all inbox providers.
export function emailOf(value){
 return (String(value||"").match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]||String(value||"").match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||"").toLowerCase();
}
export function phoneOf(value){
 const text=String(value||"").trim();
 if(text.includes("@")&&!text.endsWith("@s.whatsapp.net"))return "";
 const raw=text.replace(/@s\.whatsapp\.net$/,"");
 if(!/^[+\d\s().-]+$/.test(raw))return "";
 const digits=raw.replace(/\D/g,"");return digits.length>=9?digits:"";
}
export function safeHeader(value){const s=String(value||"");if(/[\r\n\0]/.test(s))throw Error("invalid_mail_header");return s;}

// Pure extraction: no model, network, or inference needed for these identifiers.
export function extractDeterministicEntities(value){
 const text=String(value||'').slice(0,20000),unique=values=>[...new Set(values)].slice(0,20);
 const emails=unique((text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(emailOf));
 const phones=unique((text.match(/(?:\+972[- ]?|0)[2-9](?:[- ]?\d){7,8}/g)||[]).map(phoneOf).filter(Boolean));
 const urls=unique((text.match(/https?:\/\/[^\s<>"']+/gi)||[]).flatMap(raw=>{try{const url=new URL(raw.replace(/[.,;!?]+$/,''));return ['http:','https:'].includes(url.protocol)?[url.href]:[];}catch{return [];}}));
 return {emails,phones,did_candidates:phones,urls};
}
