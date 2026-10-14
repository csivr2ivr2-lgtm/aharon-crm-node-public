// Only one-to-one chats and groups belong in the WhatsApp inbox.
// Channels, status, and broadcast lists are not human/group conversations.
export function isWhatsAppChannelJid(value){
 const jid=String(value||'').trim().toLowerCase();
 return /@(newsletter|broadcast)$/.test(jid);
}
export function isWhatsAppConversationJid(value){
 const jid=String(value||'').trim().toLowerCase();
 return /^(?:[1-9]\d{6,14}@s\.whatsapp\.net|\d{5,20}@lid|\d{5,20}(?:-\d{5,20})?@g\.us)$/.test(jid);
}
export const whatsappChannelExclusion=(alias='e')=>{
 if(!/^[a-z][a-z0-9_]*$/i.test(alias))throw Error('invalid_sql_alias');
 return "NOT ("+alias+".channel='whatsapp' AND (LOWER(COALESCE("+alias+".external_id,'')) LIKE '%@newsletter' OR LOWER(COALESCE("+alias+".external_id,'')) LIKE '%@broadcast'))";
};
export const whatsappChannelExclusionSql=whatsappChannelExclusion('e');
