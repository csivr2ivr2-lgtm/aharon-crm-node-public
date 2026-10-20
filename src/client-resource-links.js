import {createHash} from 'node:crypto';
const providers=new Set(['google.drive','google.people','google.calendar']);
function validate({client_id,provider,account_id,external_id}){
 if(typeof client_id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(client_id))throw Error('invalid_client_id');
 if(!providers.has(provider)||typeof account_id!=='string'||!account_id||account_id.length>255||typeof external_id!=='string'||!external_id||external_id.length>1024)throw Error('invalid_resource_reference');
}
const resourceKey=x=>createHash('sha256').update(JSON.stringify([x.provider,x.account_id,x.external_id])).digest('hex');
export async function migrateClientResourceLinks(db){
 await db.query(`CREATE TABLE IF NOT EXISTS client_resource_links (
 id CHAR(64) PRIMARY KEY,client_id VARCHAR(64) NOT NULL,provider VARCHAR(40) NOT NULL,
 account_id VARCHAR(255) NOT NULL,external_id VARCHAR(1024) NOT NULL,
 linked_at VARCHAR(40) NOT NULL,INDEX(client_id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function resolveClientResource(ref,db,authorize){
 validate(ref);await authorize(ref.provider,ref.account_id);
 const calendar=ref.provider==='google.calendar';
 const [rows]=await db.execute(calendar?
  "SELECT r.payload_json,r.generation,s.state_json,s.checked_at FROM google_calendar_events r JOIN google_calendar_sync s ON s.id=r.sync_id WHERE BINARY s.account_id=BINARY ? AND s.calendar_id='primary' AND BINARY r.external_id=BINARY ? LIMIT 1":
  "SELECT r.payload_json,r.generation,r.available,s.state_json,s.checked_at FROM provider_records r JOIN provider_sync s ON s.id=r.sync_id WHERE s.provider=? AND BINARY s.account_id=BINARY ? AND BINARY r.external_id=BINARY ? LIMIT 1",
  calendar?[ref.account_id,ref.external_id]:[ref.provider,ref.account_id,ref.external_id]);
 const row=rows[0],state=row&&JSON.parse(row.state_json),item=row&&JSON.parse(row.payload_json);
 if(!row||row.generation!==state?.generation||(!calendar&&!Number(row.available))||item.id!==ref.external_id||item.status==='cancelled')throw Error('resource_unavailable');
 return {item,checked_at:row.checked_at};
}
export async function linkClientResource({confirmed,db,authorize,audit,...ref}){
 if(confirmed!==true)throw Error('explicit_confirmation_required');validate(ref);
 await resolveClientResource(ref,db,authorize);
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  const [clients]=await c.execute('SELECT id FROM clients WHERE id=? FOR UPDATE',[ref.client_id]);
  if(!clients.length)throw Error('client_not_found');
  const id=resourceKey(ref),stamp=new Date().toISOString();
  await c.execute('INSERT IGNORE INTO client_resource_links(id,client_id,provider,account_id,external_id,linked_at) VALUES(?,?,?,?,?,?)',[id,ref.client_id,ref.provider,ref.account_id,ref.external_id,stamp]);
  const [links]=await c.execute('SELECT client_id FROM client_resource_links WHERE id=? FOR UPDATE',[id]);
  if(links[0]?.client_id!==ref.client_id)throw Error('resource_already_linked_to_another_client');
  await audit({action:'client.resource.link',entityType:'client',entityId:ref.client_id,confirmation:'explicit',after:{provider:ref.provider,account_id:ref.account_id,external_id:ref.external_id}},{db:c});
  await c.commit();return {ok:true,id};
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
export async function listClientResources({client_id,db,authorize}){
 if(typeof client_id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(client_id))throw Error('invalid_client_id');
 const [rows]=await db.execute('SELECT id,client_id,provider,account_id,external_id,linked_at FROM client_resource_links WHERE client_id=? ORDER BY linked_at DESC,id LIMIT 41',[client_id]);
 const items=[];
 for(const row of rows.slice(0,40)){
  try{const result=await resolveClientResource(row,db,authorize);items.push({...row,...result,available:true});}
  catch{items.push({id:row.id,client_id,provider:row.provider,available:false});}
 }
 return {ok:true,items,limited:rows.length>40};
}
