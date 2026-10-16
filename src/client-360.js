// AHARON NEXT M5: read-only, explicitly linked customer view.
// Never infer an association from a similar name, phone suffix or shared project.
const idPattern=/^[A-Za-z0-9_-]{1,64}$/;
const one=async(database,sql,args)=>(await database.execute(sql,args))[0];
export async function loadClient360(id,database){
 if(!idPattern.test(String(id||'')))throw Error('invalid_client_id');
 if(!database||typeof database.execute!=='function')throw Error('database_required');
 const clients=await one(database,
  'SELECT id,name,phone,email,company,status,created_at,updated_at FROM clients WHERE id=? LIMIT 1',[id]);
 if(!clients.length)throw Error('client_not_found');
 const [conversations,projects,tasks,files,reminders,notes,activities]=await Promise.all([
  one(database,'SELECT id,channel,title,external_id,account_id,project_id,unread_count,last_message_at FROM conversations WHERE client_id=? ORDER BY last_message_at DESC,id DESC LIMIT 40',[id]),
  one(database,"SELECT p.id,p.name,p.status,p.next_step,p.updated_at FROM projects p JOIN entity_relations r ON r.to_type='project' AND r.to_id=p.id AND r.from_type='client' WHERE r.from_id=? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 30",[id]),
  one(database,"SELECT DISTINCT t.id,t.title,t.status,t.priority,t.due_date,t.updated_at FROM tasks t JOIN entity_relations r ON r.to_type='client' AND r.to_id=? AND r.from_type='task' AND r.from_id=t.id ORDER BY t.updated_at DESC LIMIT 40",[id]),
  one(database,'SELECT id,name,mime,size_bytes,project_id,created_at FROM files WHERE client_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at DESC LIMIT 30',[id]),
  one(database,'SELECT id,title,status,due_at,task_id,project_id FROM reminders WHERE client_id=? ORDER BY due_at DESC LIMIT 30',[id]),
  one(database,"SELECT id,body,updated_at FROM crm_notes WHERE entity_type='client' AND entity_id=? ORDER BY updated_at DESC LIMIT 20",[id]),
  one(database,"SELECT id,event,title,created_at FROM activities WHERE entity_type='client' AND entity_id=? ORDER BY id DESC LIMIT 30",[id])
 ]);
 const sections={conversations,projects,tasks,files,reminders,notes,activities};
 // Counts are returned page counts, not claimed lifetime totals.
 const displayed_counts=Object.fromEntries(Object.entries(sections).map(([key,values])=>[key,values.length]));
 return {ok:true,client:clients[0],...sections,displayed_counts,limited:true,
  note:'Only explicit client links are included. Lists are bounded and may not include every historical item.'};
}
