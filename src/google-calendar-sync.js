import {createHash,randomUUID} from 'node:crypto';
const key=(account,calendar)=>createHash('sha256').update(JSON.stringify([account,calendar])).digest('hex');
export async function calendarSyncPage(calendar,state=null){
 const current=state||{mode:'full',sync:'',page:'',generation:randomUUID()};
 const params={calendarId:'primary',maxResults:100,singleEvents:false,showDeleted:true,
  ...(current.sync?{syncToken:current.sync}:{}),...(current.page?{pageToken:current.page}:{})};
 let data;
 try{data=(await calendar.events.list(params)).data;}
 catch(error){
  if(Number(error?.response?.status||error?.code)!==410||!current.sync)throw error;
  const fresh=await calendarSyncPage(calendar,null);return {...fresh,recovered:true};
 }
 if(!data||!Array.isArray(data.items||[]))throw Error('invalid_calendar_page');
 if(current.page&&data.nextPageToken===current.page)throw Error('calendar_cursor_not_advancing');
 if(!data.nextPageToken&&!data.nextSyncToken)throw Error('calendar_sync_token_missing');
 const items=(data.items||[]).map(e=>{
  if(typeof e.id!=='string'||!e.id||e.id.length>1024)throw Error('invalid_calendar_event');
  // Keep source time zone/date and recurrence semantics; never invent local dates.
  return {id:e.id,status:e.status||'confirmed',summary:e.summary||'',description:e.description||'',
   start:e.start||null,end:e.end||null,recurrence:e.recurrence||[],recurringEventId:e.recurringEventId||'',
   originalStartTime:e.originalStartTime||null,updated:e.updated||'',htmlLink:e.htmlLink||'',location:e.location||''};
 });
 return {items,recovered:false,nextState:{mode:data.nextPageToken?current.mode:'delta',
  sync:data.nextPageToken?current.sync:data.nextSyncToken,page:data.nextPageToken||'',
  generation:current.generation}};
}
export async function migrateCalendarMirror(db){
 await db.query(`CREATE TABLE IF NOT EXISTS google_calendar_sync (
  id CHAR(64) PRIMARY KEY,account_id VARCHAR(255) NOT NULL,calendar_id VARCHAR(255) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,state_json LONGTEXT NOT NULL,checked_at VARCHAR(40)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db.query(`CREATE TABLE IF NOT EXISTS google_calendar_events (
  id CHAR(64) PRIMARY KEY,sync_id CHAR(64) NOT NULL,external_id VARCHAR(1024) NOT NULL,
  generation VARCHAR(64) NOT NULL,payload_json LONGTEXT NOT NULL,updated_at VARCHAR(40),INDEX(sync_id,generation)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function syncCalendarMirror({account_id,calendar,db}){
 if(typeof account_id!=='string'||!account_id||account_id.length>255)throw Error('calendar_account_required');
 const syncId=key(account_id,'primary');
 const [existing]=await db.execute('SELECT revision,state_json FROM google_calendar_sync WHERE id=?',[syncId]);
 const before=existing[0],revision=Number(before?.revision||0),state=before?JSON.parse(before.state_json):null;
 const page=await calendarSyncPage(calendar,state);
 await persistCalendarPage({db,syncId,account_id,revision,page});
 return {ok:true,account_id,imported:page.items.length,has_next_page:Boolean(page.nextState.page),
  mode:page.nextState.mode,recovered:page.recovered};
}
export async function persistCalendarPage({db,syncId,account_id,revision,page}){
 const c=await db.getConnection();
 try{
  await c.beginTransaction();
  await c.execute("INSERT IGNORE INTO google_calendar_sync(id,account_id,calendar_id,revision,state_json) VALUES(?,?,'primary',0,'null')",[syncId,account_id]);
  const [locked]=await c.execute('SELECT revision FROM google_calendar_sync WHERE id=? FOR UPDATE',[syncId]);
  if(Number(locked[0]?.revision)!==revision)throw Error('calendar_checkpoint_conflict');
  const stamp=new Date().toISOString();
  for(const item of page.items){
   const payload=JSON.stringify(item);if(Buffer.byteLength(payload)>262144)throw Error('calendar_event_too_large');
   await c.execute(`INSERT INTO google_calendar_events(id,sync_id,external_id,generation,payload_json,updated_at) VALUES(?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE generation=VALUES(generation),payload_json=VALUES(payload_json),updated_at=VALUES(updated_at)`,
    [key(syncId,item.id),syncId,item.id,page.nextState.generation,payload,stamp]);
  }
  await c.execute('UPDATE google_calendar_sync SET revision=revision+1,state_json=?,checked_at=? WHERE id=?',
   [JSON.stringify(page.nextState),stamp,syncId]);
  await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
export async function listCalendarMirror({account_id,db}){
 const syncId=key(account_id,'primary');
 const [rows]=await db.execute('SELECT state_json,checked_at FROM google_calendar_sync WHERE id=?',[syncId]);
 if(!rows.length)return {ok:true,events:[],sync:{mode:'not_started',checked_at:null,has_next_page:false},limited:false};
 const state=JSON.parse(rows[0].state_json);
 const [events]=await db.execute('SELECT payload_json FROM google_calendar_events WHERE sync_id=? AND generation=? ORDER BY updated_at DESC,id LIMIT 101',[syncId,state.generation]);
 return {ok:true,events:events.slice(0,100).map(x=>JSON.parse(x.payload_json)),limited:events.length>100,
  sync:{mode:state.mode,has_next_page:Boolean(state.page),checked_at:rows[0].checked_at}};
}
