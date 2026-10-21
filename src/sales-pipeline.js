import {randomUUID} from 'node:crypto';
export const defaultStages=[['new','ליד חדש'],['contacted','נוצר קשר'],['discovery','בבירור צרכים'],['proposal','הצעת מחיר'],['negotiation','משא ומתן'],['won','נסגר בהצלחה'],['lost','לא נסגר']];
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const stamp=()=>new Date().toISOString();
export async function migrateSales(db){
 await db.query("CREATE TABLE IF NOT EXISTS sales_stages (id VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,label VARCHAR(120) NOT NULL,position INT NOT NULL,revision INT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 await db.query("CREATE TABLE IF NOT EXISTS sales_leads (id VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,client_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,title VARCHAR(500) NOT NULL,source VARCHAR(255) NOT NULL,stage_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,next_action VARCHAR(1000) NOT NULL,followup_date VARCHAR(10) NOT NULL,last_activity_at VARCHAR(40) NOT NULL,created_at VARCHAR(40) NOT NULL,updated_at VARCHAR(40) NOT NULL,revision INT NOT NULL DEFAULT 0,INDEX(client_id),INDEX(stage_id,updated_at),INDEX(followup_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 for(const [position,[id,label]] of defaultStages.entries())await db.execute("INSERT IGNORE INTO sales_stages(id,label,position) VALUES(?,?,?)",[id,label,position]);
}
export function validateLead(p){
 for(const [field,max] of [['title',500],['source',255],['next_action',1000]])if(typeof p[field]!=='string'||p[field].length>max||(field==='title'&&!p[field].trim()))throw Error('invalid_lead_'+field);
 if(!validId(p.client_id)||!validId(p.stage_id))throw Error('invalid_lead_reference');
 if(typeof p.followup_date!=='string'||(p.followup_date&&!/^\d{4}-\d{2}-\d{2}$/.test(p.followup_date)))throw Error('invalid_followup_date');
 if(p.followup_date&&new Date(p.followup_date+'T00:00:00Z').toISOString().slice(0,10)!==p.followup_date)throw Error('invalid_followup_date');
}
export async function listSales(db,{q='',stage='',client_id=''}={}){
 if(typeof q!=='string'||q.length>120||stage&&!validId(stage)||client_id&&!validId(client_id))throw Error('invalid_sales_filter');
 const [stages]=await db.query('SELECT id,label,position,revision FROM sales_stages ORDER BY position,id');
 const where=[],values=[];
 if(q){where.push("(LOCATE(?,l.title)>0 OR LOCATE(?,c.name)>0 OR LOCATE(?,l.source)>0)");values.push(q,q,q);}
 if(stage){where.push('l.stage_id=?');values.push(stage);}
 if(client_id){where.push('l.client_id=?');values.push(client_id);}
 const [items]=await db.execute('SELECT l.*,c.name AS client_name FROM sales_leads l JOIN clients c ON BINARY c.id=BINARY l.client_id'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY l.updated_at DESC,l.id LIMIT 201',values);
 return {ok:true,stages,items:items.slice(0,200),limited:items.length>200};
}
export async function saveLead({db,audit,id,confirmed,...p}){
 if(confirmed!==true)throw Error('confirmation_required');validateLead(p);
 if(id&&!validId(id))throw Error('invalid_lead_id');
 if(id&&(!Number.isInteger(p.revision)||p.revision<0))throw Error('revision_required');
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  const [clients]=await c.execute('SELECT id FROM clients WHERE BINARY id=BINARY ? FOR UPDATE',[p.client_id]);if(!clients.length)throw Error('client_not_found');
  const [stages]=await c.execute('SELECT id FROM sales_stages WHERE id=? FOR UPDATE',[p.stage_id]);if(!stages.length)throw Error('stage_not_found');
  const key=id||'lead_'+randomUUID(),at=stamp();let before=null;
  if(id){const [rows]=await c.execute('SELECT * FROM sales_leads WHERE id=? FOR UPDATE',[id]);before=rows[0];if(!before)throw Error('lead_not_found');if(before.revision!==p.revision)throw Error('lead_revision_conflict');}
  if(id)await c.execute('UPDATE sales_leads SET client_id=?,title=?,source=?,stage_id=?,next_action=?,followup_date=?,last_activity_at=?,updated_at=?,revision=revision+1 WHERE id=?',[p.client_id,p.title.trim(),p.source,p.stage_id,p.next_action,p.followup_date,at,at,key]);
  else await c.execute('INSERT INTO sales_leads(id,client_id,title,source,stage_id,next_action,followup_date,last_activity_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',[key,p.client_id,p.title.trim(),p.source,p.stage_id,p.next_action,p.followup_date,at,at,at]);
  await audit({action:id?'sales.lead.update':'sales.lead.create',entityType:'lead',entityId:key,confirmation:'explicit',before,after:{client_id:p.client_id,stage_id:p.stage_id,title:p.title}},{db:c});
  await c.commit();return {ok:true,id:key,revision:(before?.revision??-1)+1};
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
export async function renameSalesStage({db,audit,id,label,revision,confirmed}){
 if(confirmed!==true||!validId(id)||typeof label!=='string'||!label.trim()||label.length>120||!Number.isInteger(revision)||revision<0)throw Error('invalid_stage_update');
 const c=await db.getConnection();
 try{
  await c.beginTransaction();const [rows]=await c.execute('SELECT * FROM sales_stages WHERE id=? FOR UPDATE',[id]);
  if(!rows.length||rows[0].revision!==revision)throw Error('stage_revision_conflict');
  await c.execute('UPDATE sales_stages SET label=?,revision=revision+1 WHERE id=?',[label.trim(),id]);
  await audit({action:'sales.stage.rename',entityType:'sales_stage',entityId:id,confirmation:'explicit',before:rows[0],after:{label:label.trim()}},{db:c});
  await c.commit();return {ok:true};
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
