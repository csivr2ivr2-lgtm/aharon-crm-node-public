// Conservative, deterministic signals for messages that are not customer inquiries.
// Keep such messages accessible in Updates; never delete them or label them as spam.
export function nonCustomerSignal(message={}){
 const sender=String(message.sender||'').trim();
 const peer=String(message.conversation_external_id||'').trim();
 const subject=String(message.subject||'').trim();
 const body=String(message.body||message.latest_inbound_body||'').slice(0,20000);
 const address=(sender.match(/<([^<>]+)>/)?.[1]||sender).toLowerCase();
 // AliExpress rotates email addresses: match brand-identifying sender or the notification's original subject.
 const aliSender=/\bali[ -]?express\b/i.test(sender)||/(?:^|\.)aliexpress\.(?:com|ru|net)$/i.test(address.split('@').at(-1)||'');
 const aliSubject=/\bali[ -]?express\b/i.test(subject)&&!/^(?:re|fw|fwd):/i.test(subject)&&!message.client_id;
 if(aliSender||aliSubject)return {classification:'spam',confidence:.99,reason:'הודעה של AliExpress (כולל כתובות מתחלפות)',source:'brand_rule'};
 let headers=message.headers||{};try{if(message.headers_json)headers=JSON.parse(message.headers_json);}catch{}
 const header=name=>String(Object.entries(headers).find(([k])=>k.toLowerCase()===name)?.[1]||'');
 // Explicit ads and recurring marketing notices are not direct customer requests,
 // even if their copy uses questions such as "Need help?".
 const reply=/^(?:re|fw|fwd):/i.test(subject);
 const ads=/(?:\(פרסומת\)|^פרסומת\s*[|:]|\[ad\]|מבצע(?:ים)?|הנחה|משלוח חינם|last chance|limited[- ]time|\b(?:sale|special offer|free trial|promo(?:tion)?|discount|[0-9]+% off)\b)/i.test(subject);
 if(!reply&&ads&&/(?:פרסומת|\[ad\]|משלוח חינם|last chance|[0-9]+% off|special offer)/i.test(subject))
  return {classification:'spam',confidence:.98,reason:'פרסומת מפורשת ולא פנייה אישית',source:'routing'};
 const mailingSender=/(?:^|[\s<])(?:newsletter|marketing|promotions|no-?reply)@|@(?:updates\.hostinger\.com|email\.grok\.com|ubersuggest\.com|marketing\.mcdonalds\.co\.il|priority\.instagram\.com|mail\.instagram\.com|mailer\.capital\.com|newsletter\.artlist\.io)>?$/i.test(sender);
 const newsletterSubject=/(?:newsletter|weekly (?:digest|roundup)|what.s new|free trial|offer|upgrade|your weekly|try .* free|הכירו את|פרסומת|הישארו מעודכנים|עדכונים חדשים|ניהול הוצאות|הצטרפו|מתנה|מבצע)/i.test(subject);
 if(!reply&&(mailingSender||(newsletterSubject&&/^(?:.*<)?(?:info@make\.com|team@emails\.hostinger\.com|support@mailer\.capital\.com|support@unipile\.com|neil@ubersuggest\.com)>?$/i.test(sender))))
  return {classification:'marketing',confidence:.97,reason:'ניוזלטר או עדכון שיווקי; לא בקשת לקוח',source:'routing'};
 if(header('content-type').includes('reaction')||header('content-disposition').includes('reaction')||
    /^(?:.+ )?(?:reacted with|הגיב[ה]? באמצעות|הגיב[ה]? עם|תגובה באמצעות אימוג)/iu.test(subject)||
    /^(?:.+ )?reacted .{1,20} to (?:your|a) message[.!]?$/iu.test(body.trim()))
  return {classification:'automated',event_type:'reaction',confidence:.99,reason:'אירוע תגובה להודעה; אינו פנייה חדשה',source:'routing'};
 if(address==='notifications@github.com'&&/workflow|github actions|run (?:failed|completed|cancelled)|\[(?:[^\]]+)\].*(?:failure|success)/i.test(subject+' '+body.slice(0,1200)))
  return {classification:'system',confidence:.99,reason:'התראת הרצת GitHub Actions',source:'routing'};
 if(/^(?:reminders|pageupdates|notification|notifications)@facebookmail\.com$/.test(address)&&/facebook|פייסבוק|notification|התרא|עדכון|עדכונ|פוסט|posted|post|remind/i.test(subject+' '+body.slice(0,1200)))
  return {classification:'system',confidence:.99,reason:'עדכון רשת חברתית Facebook',source:'routing'};
 const opening=body.split(/\n(?:On .+wrote:|בתאריך .+כתב|[- ]*Original Message[- ]*)/i)[0].slice(0,1500);
 if(/(?:we|i) (?:offer|provide|speciali[sz]e in|can (?:build|develop|help))|(?:אנחנו|אנו) (?:מציעים|מתמחים|מספקים)|מציע לך/i.test(opening)&&
    /(?:app|website|software|development|seo|marketing|פיתוח|אפליקצי|אתרים|שיווק)/i.test(opening)&&
    !/^(?:re:|fw:|fwd:)/i.test(subject)&&!message.client_id)
  return {classification:'marketing',confidence:.94,reason:'הצעת שירות נכנסת מספק; לא בקשת רכישה ממך',source:'routing'};
 if(header('list-id')&&/bulk|list/i.test(header('precedence')))
  return {classification:'marketing',confidence:.97,reason:'הודעת רשימת תפוצה לפי Headers',source:'routing'};

 if(/(?:^|[<\s])(?:no-?reply|donotreply|mailer-daemon)@/i.test(sender)&&/update|notification|alert|digest|weekly|עדכון|התרא/i.test(subject+' '+body.slice(0,150)))return {classification:'automated',confidence:.95,reason:'הודעת עדכון אוטומטית',source:'routing'};
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

