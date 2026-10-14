import {nonCustomerSignal} from './inbox-signals.js';
export const INBOX_ENGINE_VERSION='inbox-2026-10-13.2';
export const HANDLING_STATES=['auto','needs_reply','waiting_customer','in_progress','done','no_action','review','snoozed'];
export const CALLER_TYPES=['auto','lead','customer','vendor','system','unknown'];
export const MESSAGE_TYPES=['auto','business','quote','support','system','marketing','spam','suspicious','reaction','unknown'];
const str=x=>String(x||'');
export function decideInbox(row={},clock=Date.now()){
 const body=str(row.body||row.latest_inbound_body),subject=str(row.subject||row.title);
 // Quoted correspondence must not turn a sales pitch into a buyer request.
 const fresh=(subject+'\n'+body.split(/\n(?:On .+wrote:|בתאריך .+כתב|[- ]*Original Message[- ]*)/i)[0]).slice(0,20000);
 const manual=str(row.manual_message_type),manualCaller=str(row.manual_caller_type);
 const feedback=/סיווג ידני|סיווג לפי משוב קודם/.test(str(row.classification_reason));
 const signal=nonCustomerSignal({...row,body,subject});
 let message_type='unknown',caller_type='unknown',handling_state='review',confidence=.35,reason='אין די מידע כדי לקבוע שנדרש מענה; יש לבדוק את השיחה',priority=40;
 const injection=/ignore (all |previous |your )*instructions|reveal.{0,30}(secret|token)|send me all (client|customer)|התעלם.{0,20}(הוראות|הנחיות)|שלח.{0,20}כל הלקוחות/i.test(fresh);
 const effective=signal?.source==='brand_rule'?signal.classification:feedback?(row.classification||'normal'):signal?.classification||row.classification;
 if(injection){message_type='suspicious';reason='תוכן חשוד; לבדיקה בלבד';confidence=.99;}
 else if(['system','automated','marketing','spam','suspicious'].includes(effective)){
  message_type=signal?.event_type==='reaction'?'reaction':effective==='automated'?'system':effective;
  caller_type=effective==='marketing'?'vendor':'system';handling_state=effective==='suspicious'?'review':'no_action';confidence=signal?.confidence||Number(row.classification_score)||.9;reason=signal?.reason||row.classification_reason||'הודעה שאינה פנייה עסקית';priority=5;
 }else if(/(?:מעוניי?ן|מתעניין|מתעניינים)\s+ב|(?:אני|אנחנו)\s+(?:מעוניי?ן|מעוניינים|צריך|צריכים|רוצה|רוצים|מחפש|מחפשים)|(?:מבקש|אשמח לקבל|אפשר לקבל|אבקש|תשלח|שלח לי).{0,65}(?:מחיר|הצעה|מספר|שירות|פרטים)|(?:i|we)\s+(?:need|want|would like|am interested|are interested)|(?:can you|please)\s+(?:send|provide|help)|\?|\b(?:pricing|quotation|quote request)\b|הצעת מחיר|בקשה|בירור|שאלה|תקלה|לא עובד/i.test(fresh)){
  message_type=/מחיר|תמחור|הצעה|מע[״"]?מ|\b(?:quote|pricing|quotation)\b/i.test(fresh)?'quote':/תקלה|לא עובד|תמיכה|\b(?:broken|support|error)\b/i.test(fresh)?'support':'business';
  caller_type=row.client_id?'customer':'lead';handling_state='needs_reply';confidence=.86;reason='פנייה הכוללת בקשה, שאלה או צורך עסקי וללא תשובה מאוחרת בשיחה';priority=message_type==='quote'?80:message_type==='support'?75:60;
  if(/(?:100|מאה).{0,35}(?:מספר|number)|(?:מספר|number).{0,35}(?:100|מאה)/i.test(fresh)){priority=95;reason+='; מוזכרת אפשרות להזמנה בהיקף גדול';}
 }else if(/^(?:תודה(?: רבה)?|קיבלתי[,! ]*תודה|מעולה[,! ]*תודה|thanks|thank you|received[,! ]*thanks)[.!\s🙏👍]*$/iu.test(body.trim())){
  message_type='business';caller_type=row.client_id?'customer':'unknown';handling_state='no_action';confidence=.91;reason='אישור קבלה או תודה ללא בקשה חדשה';priority=10;
 }else if(row.client_id||feedback&&effective==='normal'){
  message_type='business';caller_type=row.client_id?'customer':'lead';reason='פונה משויך או מסומן כלקוח, אך לא זוהתה בקשה ברורה';confidence=.65;
 }
 // Independent manual dimensions; they never grant tool execution permission.
 if(MESSAGE_TYPES.includes(manual)&&manual!=='auto'){message_type=manual;confidence=1;reason='סוג הודעה שנקבע ידנית';if(['system','marketing','spam','reaction'].includes(manual))handling_state='no_action';else if(['business','quote','support'].includes(manual)&&!injection)handling_state='needs_reply';}
 if(CALLER_TYPES.includes(manualCaller)&&manualCaller!=='auto'){caller_type=manualCaller;if(['lead','customer'].includes(manualCaller)&&!injection&&manual==='business')handling_state='needs_reply';}
 if(row.direction==='out'&&!['system','marketing','spam','reaction','suspicious'].includes(message_type)){handling_state='waiting_customer';reason='ההודעה האחרונה בשיחה נשלחה ממך';confidence=.98;}
 if(row.replied_elsewhere){handling_state='waiting_customer';reason='נמצאה תשובה מחשבון מחובר עם הפניה למזהה ההודעה המקורית';confidence=.99;}
 if(HANDLING_STATES.includes(row.manual_status)&&row.manual_status!=='auto'){
  handling_state=row.manual_status;reason='מצב טיפול שנקבע ידנית';confidence=1;
  // Preserve the operator's historical "done" decision, but surface a newer
  // substantive inbound business request for re-review.
  const handledAt=Date.parse(row.workflow_updated_at||'');
  const latestAt=Date.parse(row.waiting_since||row.sent_at||'');
  if(handling_state==='done'&&row.direction==='in'&&
     ['business','quote','support'].includes(message_type)&&
     Number.isFinite(handledAt)&&Number.isFinite(latestAt)&&latestAt>handledAt){
    handling_state='needs_reply';reason='פנייה עסקית חדשה מאז הסימון הידני כטופל; החלטת הטיפול ההיסטורית נשמרה';confidence=1;
  }
  if(handling_state==='snoozed'&&Date.parse(row.snoozed_until)<=clock){handling_state='review';reason='מועד הדחייה הסתיים; יש לבדוק את הפנייה';}
 }
 // Imported archives must not create years-old actionable leads from ordinary questions.
 // Keep explicit operator workflow choices; age never marks mail as spam or deletes it.
 const arrived=Date.parse(row.waiting_since||row.sent_at||row.last_message_at||'');
 const historical=Number.isFinite(arrived)&&clock-arrived>90*86400000&&clock>=arrived;
 if(row.inbox_event_type!=='timestamp_review'&&historical&&(!row.manual_status||row.manual_status==='auto')&&['needs_reply','waiting_customer','review'].includes(handling_state)){
  handling_state='no_action';priority=Math.min(priority,10);reason='התכתבות היסטורית (מעל 90 יום); זמינה בארכיון אך אינה דורשת טיפול אוטומטי';confidence=.99;
 }
 return {message_type,caller_type,handling_state,confidence,reason,historical,priority,priority_reason:priority>=80?'בקשת מחיר או היקף עסקי משמעותי':priority>=60?'בקשה עסקית פעילה':'בדיקה לפי ההקשר',engine_version:INBOX_ENGINE_VERSION,review_required:handling_state==='review',request_summary:body.replace(/\s+/g,' ').slice(0,220)||subject,next_action:handling_state==='needs_reply'?'בדוק את הבקשה והכן תשובה':handling_state==='waiting_customer'?'בדוק אם נדרש מעקב':handling_state==='review'?'בדוק את ההקשר וסמן מצב טיפול':'אין פעולה אוטומטית'};
}

