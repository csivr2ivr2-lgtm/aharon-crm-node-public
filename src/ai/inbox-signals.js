// Conservative, deterministic signals for messages that are not customer inquiries.
// Keep such messages accessible in Updates; never delete them or label them as spam.
export function nonCustomerSignal(message={}){
 const sender=String(message.sender||'').trim();
 const peer=String(message.conversation_external_id||'').trim();
 const subject=String(message.subject||'').trim();
 if(/@newsletter$/i.test(sender)||/@newsletter$/i.test(peer))
  return {classification:'automated',confidence:1,reason:'ערוץ עדכונים של WhatsApp; לא פנייה מלקוח',source:'routing'};
 // Avoid inferring a business lead or an actionable task from security notifications.
 if(/(?:^|[\s:])(?:one[- ]time|verification|security|login|sign[- ]in|sign in|password reset|reset your password|authentication|2fa|otp)(?:[\s:-]|$)/i.test(subject)&&/(?:code|alert|notification|activity|attempt|request|verify|reset|new|temporary|your|account|אימות|כניסה|קוד)/i.test(subject)||
    /(?:temporary (?:chatgpt )?login code|new login from |new sign-in to|reset your password|oauth application approval|סיסמ[הא].{0,20}איפוס|קוד (?:אימות|כניסה)|התחברות חדשה)/i.test(subject))
  return {classification:'system',confidence:.99,reason:'התראה או קוד גישה; אין להשיב ואין ליצור לקוח',source:'routing'};
 if(/^(?:welcome to (?:supabase|slack|elevenlabs|groq|openai))\b/i.test(subject))return {classification:'system',confidence:.98,reason:'הודעת קבלת פנים משירות מקוון',source:'routing'};
  if(/(?:summary of failures for google apps script|you updated .{0,60}access|you have granted .{0,60}access|your .{0,40}api account has been funded|service status notification)/i.test(subject))
  return {classification:'system',confidence:.97,reason:'הודעת מערכת או שירות',source:'routing'};
 if(/(?:\b(?:unsubscribe|special offer|limited[- ]time|discount|newsletter|digest|promotional)\b|get \d{1,3}% off|free trial .{0,45}ends|you.ve got \$\d+|הוסף .{0,100}(?:founder|engineer)|התראות חדשות נוספות|עדכונים עליהם|\d+\s*עדכונים:\s*על|חדש ברשת שלך|חולקים את מחשבותיהם|הצעות בשבילך)/i.test(subject))
  return {classification:'marketing',confidence:.94,reason:'עדכון שיווקי/רשימת תפוצה; לא פנייה ישירה',source:'routing'};
 return null;
}
