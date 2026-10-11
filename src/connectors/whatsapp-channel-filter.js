// Official WhatsApp channel/newsletter messages must never appear in the CRM.
export function isWhatsAppChannelJid(value){
 const jid=String(value||'').trim();
 return jid==='status@broadcast'||/@newsletter$/i.test(jid);
}
// Applies to historical rows in ALL conversation lists, regardless of their spam classification.
export const whatsappChannelExclusionSql="NOT (e.channel='whatsapp' AND COALESCE(LOWER(e.external_id),'') LIKE '%@newsletter')";
