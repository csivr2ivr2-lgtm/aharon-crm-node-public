// AHARON NEXT M6: evidence-backed 24h operational brief.
// Deterministic read-only aggregation: no LLM, guesses, provider side effects or writes.
const select=async(database,sql,params)=>(await database.execute(sql,params))[0];
export async function loadRecentChanges({hours=24,clock=Date.now(),database}={}){
 if(!database||typeof database.execute!=='function')throw Error('database_required');
 const n=Number(hours);
 if(!Number.isInteger(n)||n<1||n>168)throw Error('invalid_recent_hours');
 if(!Number.isFinite(clock))throw Error('invalid_clock');
 const cutoff=new Date(clock-n*3600000).toISOString();
 const [messages,tasks,clients]=await Promise.all([
  select(database,'SELECT m.id,m.conversation_id,m.direction,m.subject,SUBSTRING(m.body,1,240) AS snippet,m.sent_at,c.channel,c.title AS conversation_title,c.client_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.sent_at>=? ORDER BY m.sent_at DESC,m.id DESC LIMIT 50',[cutoff]),
  select(database,'SELECT id,title,status,priority,due_date,updated_at FROM tasks WHERE updated_at>=? ORDER BY updated_at DESC,id DESC LIMIT 30',[cutoff]),
  select(database,'SELECT id,name,company,created_at FROM clients WHERE created_at>=? ORDER BY created_at DESC,id DESC LIMIT 20',[cutoff])
 ]);
 return {ok:true,window:{hours:n,since:cutoff,until:new Date(clock).toISOString()},
  counts:{messages:messages.length,incoming:messages.filter(x=>x.direction==='in').length,
   outgoing:messages.filter(x=>x.direction==='out').length,tasks_updated:tasks.length,clients_added:clients.length},
  messages:messages.map(m=>({...m,source:{type:'message',id:m.id,conversation_id:m.conversation_id}})),
  tasks:tasks.map(t=>({...t,source:{type:'task',id:t.id}})),
  clients:clients.map(c=>({...c,source:{type:'client',id:c.id}})),
  limited:true,generated_by:'crm_database_read_only',
  note:'Only CRM records already synchronized are included; linked provider data may still be missing.'};
}
