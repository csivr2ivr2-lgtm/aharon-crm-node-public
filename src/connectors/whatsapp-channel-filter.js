// Only one-to-one WhatsApp chats belong in the CRM inbox.
// Groups, channels, status, and broadcast lists are excluded without deleting stored history.
export function isWhatsAppChannelJid(value){
 const jid=String(value||'').trim().toLowerCase();
 return /@(newsletter|broadcast|g\.us)$/.test(jid);
}
export function isWhatsAppConversationJid(value){
 const jid=String(value||'').trim().toLowerCase();
 return /^(?:[1-9]\d{6,14}@s\.whatsapp\.net|\d{5,20}@lid)$/.test(jid);
}
export const whatsappChannelExclusion=(alias='e')=>{
 if(!/^[a-z][a-z0-9_]*$/i.test(alias))throw Error('invalid_sql_alias');
 return "NOT ("+alias+".channel='whatsapp' AND (LOWER(COALESCE("+alias+".external_id,'')) LIKE '%@newsletter' OR LOWER(COALESCE("+alias+".external_id,'')) LIKE '%@broadcast' OR LOWER(COALESCE("+alias+".external_id,'')) LIKE '%@g.us'))";
};
export const whatsappChannelExclusionSql=whatsappChannelExclusion('e');
