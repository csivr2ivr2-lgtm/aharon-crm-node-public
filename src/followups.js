import {createHash} from 'node:crypto';
import {db as defaultDb} from './db.js';
import {getSettings} from './platform/settings.js';
import {createCrmIntelligence} from './crm-intelligence.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const hours=(value,fallback)=>Number.isFinite(Number(value))?Math.max(0,Math.min(8760,Number(value))):fallback;
// A calendar due date remains open for its full UTC day (also conservative in Israel).
const taskDue=value=>new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T23:59:59.999Z':value);
const timestamp=clock=>new Date(clock ? clock() : Date.now());
const inactive="p.deleted_at IS NOT NULL OR p.archived_at IS NOT NULL OR p.status NOT IN ('active','waiting')";
function candidate(kind,row,anchorAt){
 const entityId=kind==='overdue_task'?row.id:row.conversation_id;
 const source_key=`followup:${kind}:${entityId}:${kind==='overdue_task'?row.due_date:row.id}`;
 return {id:hash(source_key),kind,title:kind==='overdue_task'?`משימה באיחור: ${row.title}`:kind==='waiting_reply'?`ממתין לתשובה שלנו: ${row.title||row.subject||'שיחה'}`:`הלקוח טרם השיב: ${row.title||row.subject||'שיחה'}`,
  anchor_at:anchorAt,due_at:anchorAt,reason:kind==='overdue_task'?'מועד המשימה חלף':kind==='waiting_reply'?'הודעה נכנסת ממתינה למענה מעבר לזמן שהוגדר':'טרם התקבלה תשובה להודעה האחרונה',source_key,task_id:kind==='overdue_task'?row.id:null,conversation_id:kind==='overdue_task'?null:row.conversation_id,
  message_id:kind==='overdue_task'?null:row.id,client_id:row.client_id||null,project_id:row.project_id||null};
}
/** Read-only, bounded scan. Off disables automation, not owner visibility. */
export async function getFollowupCandidates({db=defaultDb,settings,clock,limit=100,includeHandled=false,candidateId}={}){
 settings||=await getSettings(db);const now=timestamp(clock);if(!Number.isFinite(now.getTime()))throw Error('invalid_followup_clock');
 const size=Math.max(1,Math.min(200,Number.parseInt(limit,10)||100));
 const waitingBefore=new Date(now-hours(settings.followups?.waitingHours,48)*3600000).toISOString();
 const overdueBefore=new Date(now-hours(settings.followups?.overdueHours,24)*3600000).toISOString();
 const [tasks]=await db.execute(`SELECT t.*,(SELECT MIN(r.to_id) FROM entity_relations r WHERE r.from_type='task' AND r.from_id=t.id AND r.to_type='client') AS client_id,(SELECT MIN(r.to_id) FROM entity_relations r WHERE r.from_type='task' AND r.from_id=t.id AND r.to_type='project') AS project_id FROM tasks t WHERE t.status IN ('open','in_progress') AND t.due_date IS NOT NULL AND t.due_date<>'' AND t.due_date<=?
 AND NOT EXISTS (SELECT 1 FROM entity_relations r JOIN projects p ON (r.to_type='project' AND p.id=r.to_id AND r.from_type='task' AND r.from_id=t.id) OR (r.from_type='project' AND p.id=r.from_id AND r.to_type='task' AND r.to_id=t.id) WHERE ${inactive})
 AND NOT EXISTS (SELECT 1 FROM entity_relations r JOIN conversations c ON r.to_type='conversation' AND r.to_id=c.id JOIN projects p ON p.id=c.project_id WHERE r.from_type='task' AND r.from_id=t.id AND (${inactive}))
 ${candidateId?"AND SHA2(CONCAT('followup:overdue_task:',t.id,':',t.due_date),256)=?":''}
 ${includeHandled?'':"AND NOT EXISTS (SELECT 1 FROM reminders handled WHERE handled.source_key=SHA2(CONCAT('followup:overdue_task:',t.id,':',t.due_date),256))"}
 ORDER BY t.due_date ASC,t.id ASC LIMIT ${size}`,candidateId?[overdueBefore,candidateId]:[overdueBefore]);
 const [messages]=await db.execute(`SELECT m.*,c.title,c.client_id,c.project_id FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN projects p ON p.id=c.project_id
 WHERE m.direction IN ('in','out') AND m.sent_at<=? AND m.sent_at<>''
 AND (NULLIF(c.project_id,'') IS NULL OR (p.id IS NOT NULL AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.status IN ('active','waiting')))
 AND COALESCE(m.classification,'unknown') NOT IN ('spam','suspicious','marketing','automated','system') AND COALESCE(m.spam_disposition,'inbox')='inbox'
 AND NOT EXISTS (SELECT 1 FROM messages newer WHERE newer.conversation_id=m.conversation_id AND (COALESCE(newer.sent_at,'')>COALESCE(m.sent_at,'') OR (COALESCE(newer.sent_at,'')=COALESCE(m.sent_at,'') AND newer.id>m.id)))
 ${candidateId?"AND SHA2(CONCAT('followup:',IF(m.direction='in','waiting_reply','waiting_customer'),':',m.conversation_id,':',m.id),256)=?":''}
 ${includeHandled?'':"AND NOT EXISTS (SELECT 1 FROM reminders handled WHERE handled.source_key=SHA2(CONCAT('followup:',IF(m.direction='in','waiting_reply','waiting_customer'),':',m.conversation_id,':',m.id),256))"}
 ORDER BY m.sent_at ASC,m.id ASC LIMIT ${size}`,candidateId?[waitingBefore,candidateId]:[waitingBefore]);
 let items=[...tasks.filter(r=>Number.isFinite(taskDue(r.due_date).getTime())&&taskDue(r.due_date).getTime()<=Date.parse(overdueBefore)).map(r=>candidate('overdue_task',r,taskDue(r.due_date).toISOString())),
 ...messages.filter(r=>Number.isFinite(Date.parse(r.sent_at))&&Date.parse(r.sent_at)<=Date.parse(waitingBefore)).map(r=>candidate(r.direction==='in'?'waiting_reply':'waiting_customer',r,new Date(r.sent_at).toISOString()))]
 .sort((a,b)=>a.anchor_at.localeCompare(b.anchor_at)||a.id.localeCompare(b.id)).slice(0,size);
 if(items.length&&!includeHandled){
  const [handled]=await db.execute(`SELECT source_key FROM reminders WHERE source_key IN (${items.map(()=>'?').join(',')})`,items.map(item=>hash(item.source_key)));
  const keys=new Set(handled.map(row=>row.source_key));items=items.filter(item=>!keys.has(hash(item.source_key)));
 }
 return {ok:true,items};
}
async function schedule(candidate,{db,settings,clock,crm,mode,actor='followups',source='automation'}){
 const reminderMode=mode||settings.followups?.mode||'remind';
 if(!['remind','draft_follow_up'].includes(reminderMode))throw Error('invalid_followup_mode');
 return (crm||createCrmIntelligence({db})).createReminder({title:candidate.title.slice(0,500),due_at:timestamp(clock).toISOString(),
  mode:candidate.kind==='overdue_task'?'remind':reminderMode,source_key:candidate.source_key,
  client_id:candidate.client_id,project_id:candidate.project_id,task_id:candidate.task_id,conversation_id:candidate.conversation_id,
  notes:JSON.stringify({followup:{kind:candidate.kind,messageId:candidate.message_id,taskId:candidate.task_id,anchorAt:candidate.anchor_at},text:candidate.title})
 },{actor,source,reason:'מעקב לפי זמן ההמתנה שהוגדר; ללא שליחת הודעה'});
}
export async function scheduleFollowup(id,{mode}={},deps={}){
 const db=deps.db||defaultDb,settings=deps.settings||await getSettings(db);
 const {items}=await getFollowupCandidates({...deps,db,settings,limit:200,includeHandled:true,candidateId:id});const item=items.find(item=>item.id===id);
 if(!item)throw Error('followup_not_found_or_stale');
 return schedule(item,{...deps,db,settings,mode,actor:deps.actor||'owner',source:'manual'});
}
export async function processFollowups({db=defaultDb,settings,clock,crm}={}){
 settings||=await getSettings(db);const mode=settings.automation?.followups||'suggest';
 if(mode!=='automatic')return {ok:true,mode,candidates:0,created:0,duplicates:0};
 const {items}=await getFollowupCandidates({db,settings,clock});let created=0,duplicates=0;
 for(const item of items){const result=await schedule(item,{db,settings,clock,crm});if(result.duplicate)duplicates++;else created++;}
 return {ok:true,mode,candidates:items.length,created,duplicates};
}
export function createFollowups(deps={}){return {
 getFollowupCandidates:options=>getFollowupCandidates({...deps,...options}),
 processFollowups:options=>processFollowups({...deps,...options}),
 scheduleFollowup:(id,input)=>scheduleFollowup(id,input,deps)
};}
