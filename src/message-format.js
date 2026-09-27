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
