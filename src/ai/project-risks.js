// Read-only risk evidence. An overdue task is not proof of why a project is delayed.
export async function loadProjectRisks({database,clock=Date.now()}={}){
 if(!database||!Number.isFinite(clock))throw Error('invalid_project_risk_context');
 const [rows]=await database.execute(`SELECT DISTINCT p.id AS project_id,p.name AS project_name,p.status AS project_status,
 t.id AS task_id,t.title AS task_title,t.status AS task_status,t.due_date
 FROM projects p JOIN entity_relations r ON r.to_type='project' AND CAST(r.to_id AS BINARY)=CAST(p.id AS BINARY)
 AND r.from_type='task' JOIN tasks t ON CAST(r.from_id AS BINARY)=CAST(t.id AS BINARY)
 WHERE p.deleted_at IS NULL AND p.status IN ('active','paused') AND t.status IN ('open','in_progress')
 AND t.due_date IS NOT NULL AND t.due_date<>'' ORDER BY t.due_date,t.id,p.id LIMIT 201`,[]);
 const today=new Date(clock).toISOString().slice(0,10);
 const overdue=rows.slice(0,200).filter(r=>{
  const due=String(r.due_date||'');
  if(!Number.isFinite(Date.parse(due)))return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(due)?due<today:Number.isFinite(Date.parse(due))&&Date.parse(due)<clock;
 });
 const items=overdue.slice(0,50).map(r=>({...r,evidence:'open_task_past_due',cause:'unknown',
  source:{project_id:r.project_id,task_id:r.task_id}}));
 return {ok:true,items,checked_at:new Date(clock).toISOString(),timezone:'UTC',
  limited:rows.length>200||overdue.length>50,note:'Only explicitly linked open tasks with recorded deadlines are checked; the reason for delay is unknown.'};
}
