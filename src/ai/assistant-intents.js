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
 if(!toolResponse?.ok||toolResponse.status!=='completed'||toolResponse.result?.ok===false||!Array.isArray(rows)||(!rows.length&&(toolResponse.result?.complete===false||toolResponse.result?.sync?.state==='failed')))throw Error('assistant_read_unavailable');
 return rows.slice(0,limit).filter(x=>x&&typeof x==='object').map(x=>({
  id:String(x.id||'').slice(0,128),
  source_url:x.id?'/#conversation='+encodeURIComponent(String(x.id)):'',
  reason:String(x.reason||'בקשה ללא תשובה מאוחרת בשיחה').slice(0,250),
  contact_name:String(x.contact_name||x.sender||x.title||'פונה לא מזוהה').slice(0,180),
  title:String(x.title||'שיחה ללא כותרת').slice(0,180),
  channel:String(x.channel||'').slice(0,24),
  waiting_since:String(x.waiting_since||'').slice(0,50),
  latest_inbound_body:String(x.latest_inbound_body||'').slice(0,700)
 }));
}
export function waitingExcerpt(items){
 if(!items.length)return 'לפי הנתונים המסוננים של ה־CRM, לא נמצאו שיחות שממתינות לתשובה. ייתכן שקיימות פניות שעדיין לא סווגו או סונכרנו.';
 return 'פניות שממתינות לתשובה שלך — לפי הבקשות והסטטוסים בנתונים שסונכרנו (תקינות הסנכרון החי לא נבדקה):\n'
  +items.map((x,i)=>(i+1)+'. '+x.contact_name+' ('+(x.channel==='whatsapp'?'WhatsApp':x.channel==='email'?'דוא״ל':x.channel||'ערוץ לא ידוע')+') — '+(x.latest_inbound_body||x.title||'אין טקסט זמין').replace(/\s+/g,' ').slice(0,300)+' — '+(x.reason||'')+(x.source_url?'\nמקור: '+x.source_url:'')).join('\n');
}


export function businessReadRequest(message){
 const m=String(message||'').trim();
 if(explicitMutationRequest(m))return null;
 if(/(?:חמש|חמישה|5).{0,25}פניות.{0,20}חשוב/.test(m))return {view:'needs_reply',sort:'priority',limit:5};
 if(/(?:מי|איזה|אילו).{0,35}(?:ביקש|רצ[וה]).{0,25}(?:מחיר|הצעה)/.test(m))return {view:'needs_reply',message_type:'quote',limit:10};
 if(/(?:איזה|אילו|מי).{0,40}(?:רצ[וה]|ביקש|מתעניין).{0,25}מספרים/.test(m))return {view:'all',q:'מספר',limit:20};
 if(/מה השתנה/.test(m))return {view:'all',since_visit:true,limit:30};
 if(/(?:תקציר|סיכום).{0,12}(?:יומי|היום)/.test(m))return {view:'all',from:new Date(Date.now()-24*3600000).toISOString(),limit:30};
 return null;
}


export function recentChangesRequest(message){
 const m=String(message||'').trim();
 if(explicitMutationRequest(m)||!/מה השתנה|סיכום פעילות|תקציר פעילות/u.test(m))return null;
 if(/מאז אתמול|ביממה האחרונה|24\s*שעות/u.test(m))return {hours:24};
 if(/בשבוע האחרון|בשבעת הימים האחרונים/u.test(m))return {hours:168};
 return null;
}
