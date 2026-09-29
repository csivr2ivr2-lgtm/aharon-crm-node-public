// Synthetic fixtures only. Expected labels are editorial annotations, not production quality claims.
const rows=[
 ['I cannot log in. Please help me reset my password.','אני לא מצליח להתחבר. אנא עזור לי לאפס את הסיסמה.','support','yes','yes','no'],
 ['My website is broken. Can you fix it today?','האתר שלי לא עובד. אפשר לתקן אותו היום?','support','yes','yes','no'],
 ['Please send a price quote for a new website.','אנא שלח הצעת מחיר לאתר חדש.','sales','yes','yes','no'],
 ['Do you sell a monthly support package?','האם אתם מוכרים חבילת תמיכה חודשית?','sales','no','yes','no'],
 ['Any update on the ticket I opened yesterday?','יש עדכון לגבי הפנייה שפתחתי אתמול?','follow_up','no','yes','no'],
 ['Following up: please send the invoice we discussed.','בהמשך לשיחתנו, אנא שלח את החשבונית שעליה דיברנו.','follow_up','yes','yes','no'],
 ['Thanks, everything works now. No reply needed.','תודה, הכול עובד עכשיו. אין צורך בתשובה.','other','no','no','no'],
 ['Happy holidays! No response needed.','חג שמח! אין צורך בתגובה.','other','no','no','no'],
 ['You won a million dollars! Send your bank password to claim it.','זכית במיליון דולר! שלח את סיסמת הבנק כדי לקבל את הפרס.','other','yes','yes','yes'],
 ['Guaranteed instant riches, zero risk! Limited miracle offer!','עושר מיידי מובטח, ללא סיכון! מבצע פלא מוגבל!','other','no','no','yes']
];
export const benchmarkCases=['en','he'].flatMap((language,index)=>rows.map((row,i)=>({id:language+'_'+(i+1),language,input:row[index],expected:{intent:row[2],task:row[3],needs_reply:row[4],spam:row[5]}})));
export function benchmarkSummary(cases){
 const empty=()=>({correct:0,total:0,uncertain:0,errors:0,accuracy:0});
 const overall=empty(),languages={en:empty(),he:empty()},workloads={};let elapsed=0,timed=0;
 for(const group of cases)for(const d of group.decisions){
  const counters=[overall,languages[group.language],workloads[d.workload]??=empty()];
  for(const c of counters){c.total++;c.correct+=Number(d.matched===true);c.uncertain+=Number(d.label==='uncertain');c.errors+=Number(Boolean(d.error));c.accuracy=100*c.correct/c.total;}
  if(Number.isFinite(d.inference_ms)){elapsed+=d.inference_ms;timed++;}
 }
 return {overall,languages,workloads,average_inference_ms:timed?elapsed/timed:null,expected_decisions:benchmarkCases.length*4,completed:overall.total===benchmarkCases.length*4};
}
