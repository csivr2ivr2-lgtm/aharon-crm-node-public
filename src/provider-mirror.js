import {createHash} from 'node:crypto';
const scopeId=(provider,account)=>createHash('sha256').update(JSON.stringify([provider,account])).digest('hex');
const recordId=(scope,id)=>createHash('sha256').update(JSON.stringify([scope,id])).digest('hex');
const validate=(provider,account)=>{if(!['google.drive','google.people'].includes(provider)||typeof account!=='string'||!account||account.length>255)throw Error('invalid_provider_mirror_scope');};
export async function migrateProviderMirrors(db){
 await db.query(`CREATE TABLE IF NOT EXISTS provider_sync (
 id CHAR(64) PRIMARY KEY,provider VARCHAR(40) NOT NULL,account_id VARCHAR(255) NOT NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 0,state_json LONGTEXT NOT NULL,checked_at VARCHAR(40)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db.query(`CREATE TABLE IF NOT EXISTS provider_records (
 id CHAR(64) PRIMARY KEY,sync_id CHAR(64) NOT NULL,external_id VARCHAR(1024) NOT NULL,
 generation VARCHAR(64) NOT NULL,available TINYINT NOT NULL DEFAULT 1,payload_json LONGTEXT NOT NULL,
 updated_at VARCHAR(40),INDEX(sync_id,generation,available)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function syncProviderMirror({provider,account_id,fetchPage,db}){
 validate(provider,account_id);const id=scopeId(provider,account_id);
 const [rows]=await db.execute('SELECT revision,state_json FROM provider_sync WHERE id=?',[id]);
 const state=rows[0]?JSON.parse(rows[0].state_json):null,revision=Number(rows[0]?.revision||0);
 const page=await fetchPage(state);
 if(!page?.nextState?.generation||!Array.isArray(page.items))throw Error('invalid_provider_mirror_page');
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  await c.execute("INSERT IGNORE INTO provider_sync(id,provider,account_id,revision,state_json) VALUES(?,?,?,0,'null')",[id,provider,account_id]);
  const [locked]=await c.execute('SELECT revision FROM provider_sync WHERE id=? FOR UPDATE',[id]);
  if(Number(locked[0]?.revision)!==revision)throw Error('provider_checkpoint_conflict');
  const stamp=new Date().toISOString();
  for(const item of page.items){
   if(typeof item.id!=='string'||!item.id||item.id.length>1024||typeof item.available!=='boolean')throw Error('invalid_provider_record');
   const payload=JSON.stringify(item);if(Buffer.byteLength(payload)>262144)throw Error('provider_record_too_large');
   // Retain the historical metadata after removal, but never return it in active results.
   await c.execute(`INSERT INTO provider_records(id,sync_id,external_id,generation,available,payload_json,updated_at)
    VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE generation=VALUES(generation),
    payload_json=IF(VALUES(available)=1,VALUES(payload_json),payload_json),
    available=VALUES(available),updated_at=VALUES(updated_at)`,
    [recordId(id,item.id),id,item.id,page.nextState.generation,item.available?1:0,payload,stamp]);
  }
  await c.execute('UPDATE provider_sync SET revision=revision+1,state_json=?,checked_at=? WHERE id=?',[JSON.stringify(page.nextState),stamp,id]);
  await c.commit();
  return {ok:true,imported:page.items.length,mode:page.nextState.mode,has_next_page:Boolean(page.nextState.page),recovered:page.recovered===true};
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
export async function listProviderMirror({provider,account_id,db,query=''}){
 validate(provider,account_id);
 if(typeof query!=='string'||query.length>200)throw Error('invalid_provider_search');
 const id=scopeId(provider,account_id),[sync]=await db.execute('SELECT state_json,checked_at FROM provider_sync WHERE id=?',[id]);
 if(!sync.length)return {ok:true,items:[],limited:false,sync:{mode:'not_started',checked_at:null,has_next_page:false}};
 const state=JSON.parse(sync[0].state_json);
 // Search is bound as a value. No identifiers or provider cursors enter SQL text.
 const [rows]=await db.execute('SELECT payload_json FROM provider_records WHERE sync_id=? AND generation=? AND available=1 AND (?=\'\' OR payload_json LIKE ?) ORDER BY updated_at DESC,id LIMIT 101',[id,state.generation,query,'%'+query+'%']);
 return {ok:true,items:rows.slice(0,100).map(r=>JSON.parse(r.payload_json)),limited:rows.length>100,
 sync:{mode:state.mode,checked_at:sync[0].checked_at,has_next_page:Boolean(state.page)}};
}
