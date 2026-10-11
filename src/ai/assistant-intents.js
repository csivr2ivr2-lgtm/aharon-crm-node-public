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
export function waitingSummaryRequest(message){
 const m=String(message||'');
 return /(?:מצא|הצג|סכם|תן|איזה|אילו)/u.test(m)&&/(?:שיח|הודע|פניית|פניות)/u.test(m)&&/(?:ממתינ|מחכ|תשוב|לענות)/u.test(m);
}
export function extractWaitingItems(toolResponse,limit=5){
 const rows=toolResponse?.result?.items;
 if(!toolResponse?.ok||toolResponse.status!=='completed'||!Array.isArray(rows))throw Error('assistant_read_unavailable');
 return rows.slice(0,limit).filter(x=>x&&typeof x==='object').map(x=>({
  title:String(x.title||'שיחה ללא כותרת').slice(0,180),
  channel:String(x.channel||'').slice(0,24),
  waiting_since:String(x.waiting_since||'').slice(0,50),
  latest_inbound_body:String(x.latest_inbound_body||'').slice(0,700)
 }));
}
export function waitingExcerpt(items){
 if(!items.length)return 'לא נמצאו שיחות שממתינות לתשובה לפי נתוני ה־CRM.';
 return 'השיחות האחרונות שממתינות לתשובה (תוכן ההודעה האחרונה, ללא סיכום AI):\n'
  +items.map((x,i)=>(i+1)+'. '+x.title+' — '+(x.latest_inbound_body||'אין טקסט זמין').slice(0,300)).join('\n');
}
