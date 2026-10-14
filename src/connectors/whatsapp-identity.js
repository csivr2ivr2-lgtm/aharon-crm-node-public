// Baileys PN and privacy-preserving LID addresses are different identifier types.
// Never turn digits from @lid or @g.us into a telephone number.
export const isPhoneJid=value=>/^[1-9]\d{6,14}@s\.whatsapp\.net$/i.test(String(value||''));
export const isLidJid=value=>/^\d{5,20}@lid$/i.test(String(value||''));
export const isGroupJid=value=>/^\d{5,20}(?:-\d{5,20})?@g\.us$/i.test(String(value||''));
export function safeWhatsAppName(value){
 const name=String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160);
 if(!name||/@(?:lid|g\.us|s\.whatsapp\.net|newsletter|broadcast)$/i.test(name)||/^\d{9,20}$/.test(name))return '';
 return name;
}
export function safeWhatsAppPn(value){
 const jid=String(value||'').trim().toLowerCase();
 return isPhoneJid(jid)?jid:'';
}
export function whatsappPeerTitle({jid,name='',phoneJid=''}={}){
 const label=safeWhatsAppName(name);
 if(label)return label;
 const phone=safeWhatsAppPn(phoneJid)||(isPhoneJid(jid)?String(jid).toLowerCase():'');
 if(phone)return phone.slice(0,phone.indexOf('@'));
 const short=String(jid||'').split('@')[0].slice(-4);
 if(isGroupJid(jid))return 'קבוצת WhatsApp'+(short?' · '+short:'');
 if(isLidJid(jid))return 'איש קשר WhatsApp (מזהה פרטי'+(short?' · '+short:'')+')';
 return 'שיחת WhatsApp';
}
