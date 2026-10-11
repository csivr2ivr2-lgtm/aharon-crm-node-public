// Deterministic recognition for explicit CRM requests; model text is never proof of mutation.
export function explicitTaskRequest(message){
 const m=String(message||'').trim().match(/^(?:צור|צרי|תיצור|תצרי)\s+(?:לי\s+)?משימ[הת]\s+(?:בדיקה\s+)?(?:חדשה\s+)?(?:בשם|שנקראת)\s*["'״“]([^"'״”]{1,500})["'״”]/iu);
 if(!m)return null;
 const title=m[1].trim();if(!title)return null;
 const suffix=String(message||'').slice(m[0].length);
 const priority=/עדיפות\s+(?:נמוכה|נמוך)/u.test(suffix)?'low':/עדיפות\s+(?:דחופה|דחוף)/u.test(suffix)?'urgent':/עדיפות\s+(?:גבוהה|גבוה)/u.test(suffix)?'high':'normal';
 return {title,priority};
}
export function explicitMutationRequest(message){
 return /^(?:צור|צרי|תיצור|תצרי|עדכן|עדכני|מחק|מחקי|שלח|שלחי|שמור|שמרי|פתח|פתחי)\s/u.test(String(message||'').trim());
}
// Read-only waiting-message queries must go to CRM data even if there is no client card.
export function waitingSummaryRequest(message){
 const m=String(message||'').trim();
 const reverse=/(?:אני|אנחנו)\s+(?:מחכ|ממתינ)[^\n]{0,35}(?:מהם|מהלקוח|מהלקוחות|מצידם)/u.test(m);
 if(reverse)return false;
 const query=/(?:מי|למי|איזה|אילו|מצא|הצג|סכם|תן|רשימ|כמה|צריך)/u.test(m);
 const pending=/(?:ממתינ|מחכ|תשוב|מענה|לענות|להשיב|הגב|השב|לא\s+עניתי|לא\s+השבתי)/u.test(m);
 const subject=/(?:שיח|הודע|פניית|פניות|לקוחות|לקוח|פונים|מי|למי)/u.test(m);
 const ownership=/(?:ממני|לי|שלי|מאתנו|לנו|אני|אנחנו)/u.test(m);
 return query&&pending&&(subject||ownership);
}
export function waitingNeedsSummary(message){
 return /(?:סכם|סיכום|מה\s+(?:כל|הלקוח|הלקוחות|הפונה)\s+(?:לקוח\s+)?מבקש|מה\s+מבקש)/u.test(String(message||''));
}
export function waitingRequestLimit(message){
 const m=String(message||'');
 const n=m.match(/\b(?:[1-9]|[1-4]\d|50)\b/);
 if(n)return Math.min(50,Math.max(1,Number(n[0])));
 if(/חמש|חמישה/u.test(m))return 5;
 if(/עשר|עשרה/u.test(m))return 10;
 return 10;
}
export function extractWaitingItems(toolResponse,limit=10){
 const rows=toolResponse?.result?.items;
 if(!toolResponse?.ok||toolResponse.status!=='completed'||!Array.isArray(rows))throw Error('assistant_read_unavailable');
 return rows.slice(0,limit).filter(x=>x&&typeof x==='object').map(x=>({
  contact_name:String(x.contact_name||x.sender||x.title||'פונה לא מזוהה').slice(0,180),
  title:String(x.title||'שיחה ללא כותרת').slice(0,180),
  channel:String(x.channel||'').slice(0,24),
  waiting_since:String(x.waiting_since||'').slice(0,50),
  latest_inbound_body:String(x.latest_inbound_body||'').slice(0,700)
 }));
}
export function waitingExcerpt(items){
 if(!items.length)return 'לפי הנתונים המסוננים של ה־CRM, לא נמצאו שיחות שממתינות לתשובה. ייתכן שקיימות פניות שעדיין לא סווגו או סונכרנו.';
 return 'פניות שממתינות לתשובה שלך — לפי ההודעה האחרונה בכל שיחה (גם ללא כרטיס לקוח):\n'
  +items.map((x,i)=>(i+1)+'. '+x.contact_name+' ('+(x.channel==='whatsapp'?'WhatsApp':x.channel==='email'?'דוא״ל':x.channel||'ערוץ לא ידוע')+') — '+(x.latest_inbound_body||x.title||'אין טקסט זמין').replace(/\s+/g,' ').slice(0,300)).join('\n');
}
