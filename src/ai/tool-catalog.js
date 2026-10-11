// Fit a task-relevant, allowlisted tool catalog inside the CRM character budget.
// Actual permissions and argument schemas are enforced by the server-side ActionEngine.
const focus=[
 [/לקוח|לקוחות|client|customer|contact/iu,/client|search_crm/],
 [/פרויקט|פרויקטים|project/iu,/project|search_crm/],
 [/משימ|task|todo/iu,/task|search_crm/],
 [/וואטס|whatsapp/iu,/whatsapp|account|conversation|search_crm/],
 [/מייל|דואר|אימייל|gmail|email/iu,/email|account|conversation|search_crm/],
 [/הודע|שיח|reply|conversation|inbox|unread/iu,/conversation|reply|draft|waiting_for_reply|search_crm/],
 [/ממתינ|מחכה|לענות|waiting|follow.?up/iu,/waiting_for_reply|conversation|reminder|search_crm/],
 [/קובץ|קבצים|file|document/iu,/file|search_crm/],
 [/תזכור|תזכורת|remind|reminder/iu,/reminder|search_crm/],
 [/מערכת|מספר|system|did/iu,/system|search_crm/],
 [/שלח|send/iu,/send_|account|search_crm/]
];
export function selectToolCatalog(items,query,maxChars){
 const budget=Math.max(2,Math.trunc(Number(maxChars)||0));
 if(!Array.isArray(items)||budget<4)return [];
 const q=String(query||'');
 const active=focus.filter(([pattern])=>pattern.test(q)).map(([,targets])=>targets);
 const scored=items.map((tool,index)=>{
  const name=String(tool?.name||'');
  let score=name==='search_crm'?10:0;
  for(const target of active)if(target.test(name))score+=30;
  if(!active.length&&name==='waiting_for_reply')score+=1;
  // Favour read-only tools if no exact business object is named.
  if(!active.length&&/^(list_|get_|search_)/.test(name))score+=2;
  return {tool,index,score};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const result=[];let used=2;
 for(const {tool} of scored){
  const raw=JSON.stringify(tool);if(typeof raw!=='string')continue;
  const chars=raw.length+(result.length?1:0);
  if(used+chars>budget)continue;
  result.push(tool);used+=chars;
 }
 return result;
}
