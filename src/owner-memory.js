import {randomUUID} from 'node:crypto';
import {db as defaultDb,now} from './db.js';

// Owner-only memory is NOT client knowledge. Nothing is extracted from inbound
// messages or chat tool output automatically. Only an authenticated owner can edit it.
const KINDS=['preference','decision','project','fact','inference','temporary'];
const actorId=actor=>{if(actor!=='dashboard')throw Error('owner_memory_access_denied');return actor;};
const valid=(value,max,field)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error('invalid_owner_memory_'+field);return value.trim();};
const kindValue=kind=>{if(!KINDS.includes(kind))throw Error('invalid_owner_memory_kind');return kind;};
const revisionValue=value=>{if(!Number.isSafeInteger(value)||value<1)throw Error('invalid_owner_memory_revision');return value;};
const memoryId=id=>{if(typeof id!=='string'||!/^mem_[a-f0-9-]{36}$/.test(id))throw Error('invalid_owner_memory_id');return id;};

export async function migrateOwnerMemories(database=defaultDb){
 await database.query(`CREATE TABLE IF NOT EXISTS owner_memories (
 id VARCHAR(64) PRIMARY KEY, actor VARCHAR(64) NOT NULL, kind VARCHAR(20) NOT NULL,
 subject VARCHAR(160) NOT NULL, body TEXT NOT NULL, revision INT NOT NULL DEFAULT 1,
 source VARCHAR(24) NOT NULL DEFAULT 'owner_manual',created_at VARCHAR(40) NOT NULL,
 updated_at VARCHAR(40) NOT NULL,INDEX idx_owner_memories(actor,updated_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export async function listOwnerMemories({actor='dashboard'}={},database=defaultDb){
 actorId(actor);
 const [items]=await database.execute('SELECT id,kind,subject,body,revision,source,created_at,updated_at FROM owner_memories WHERE actor=? ORDER BY updated_at DESC,id DESC LIMIT 200',[actor]);
 return {ok:true,items};
}
export async function createOwnerMemory({actor='dashboard',kind,subject,body}={},database=defaultDb){
 actorId(actor);kindValue(kind);subject=valid(subject,160,'subject');body=valid(body,2500,'body');
 const id='mem_'+randomUUID(),ts=now();
 await database.execute("INSERT INTO owner_memories(id,actor,kind,subject,body,revision,source,created_at,updated_at) VALUES(?,?,?,?,?,1,'owner_manual',?,?)",[id,actor,kind,subject,body,ts,ts]);
 return {ok:true,id,revision:1};
}
export async function updateOwnerMemory({actor='dashboard',id,revision,kind,subject,body}={},database=defaultDb){
 actorId(actor);memoryId(id);revisionValue(revision);kindValue(kind);subject=valid(subject,160,'subject');body=valid(body,2500,'body');
 const [result]=await database.execute('UPDATE owner_memories SET kind=?,subject=?,body=?,revision=revision+1,updated_at=? WHERE id=? AND actor=? AND revision=?',[kind,subject,body,now(),id,actor,revision]);
 if(result.affectedRows!==1)throw Error('owner_memory_not_found_or_changed');
 return {ok:true,id,revision:revision+1};
}
export async function deleteOwnerMemory({actor='dashboard',id,revision}={},database=defaultDb){
 actorId(actor);memoryId(id);revisionValue(revision);
 // Hard deletion: never copy personal memory text into an audit log.
 const [result]=await database.execute('DELETE FROM owner_memories WHERE id=? AND actor=? AND revision=?',[id,actor,revision]);
 if(result.affectedRows!==1)throw Error('owner_memory_not_found_or_changed');
 return {ok:true};
}
// Match simple Hebrew definite articles/prepositions without using an AI service
// to read private facts. Keep the original token to avoid losing precise matches.
export const memoryTerms=s=>{
 const words=String(s||'').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
 const expanded=[];
 for(const word of words.slice(0,24)){
  expanded.push(word);
  if(/^[והבכלמש][א-ת]{4,}$/.test(word))expanded.push(word.slice(1));
 }
 return [...new Set(expanded)].slice(0,32);
};
export async function retrieveOwnerMemories({actor='dashboard',query='',limit=6,maxChars=2600}={},database=defaultDb){
 actorId(actor);
 const terms=memoryTerms(query);
 if(!terms.length)return [];
 // Rank across the entire owner's store BEFORE limiting rows, so an old decision
 // cannot disappear behind 200 unrelated recent edits. Values are always bound.
 const score=terms.map(()=>'(CASE WHEN LOCATE(?,LOWER(subject))>0 THEN 4 ELSE 0 END + CASE WHEN LOCATE(?,LOWER(body))>0 THEN 1 ELSE 0 END)').join('+');
 const [rows]=await database.execute(`SELECT id,kind,subject,body,revision,source,updated_at,(${score}) AS relevance FROM owner_memories WHERE actor=? AND (kind<>'temporary' OR updated_at>?) HAVING relevance>0 ORDER BY relevance DESC,updated_at DESC,id DESC LIMIT 60`,[...terms.flatMap(t=>[t,t]),actor,new Date(Date.now()-7*86400000).toISOString()]);
 const scored=rows.map(row=>{
  const title=String(row.subject||'').normalize('NFKC').toLocaleLowerCase(),body=String(row.body||'').normalize('NFKC').toLocaleLowerCase();
  const hits=terms.reduce((n,t)=>n+(title.includes(t)?4:0)+(body.includes(t)?1:0),0);
  // Temporary notes expire after seven days, without deleting the owner's record.
  const expired=row.kind==='temporary'&&(!Number.isFinite(Date.parse(row.updated_at))||Date.parse(row.updated_at)+7*86400000<=Date.now());
  return {row,score:!expired&&hits>0?hits:0};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(b.row.updated_at).localeCompare(String(a.row.updated_at)));
 const output=[];const budget=Math.max(200,Math.min(4000,Number(maxChars)||2600));let used=2;
 for(const {row} of scored){
  if(output.length>=Math.min(10,Math.max(1,Number(limit)||6)))break;
  const item={id:row.id,revision:row.revision,kind:row.kind,subject:row.subject,body:row.body,updated_at:row.updated_at,source:row.source||'owner_manual',evidence:row.kind==='inference'?'unverified_inference':row.kind==='preference'?'owner_preference':row.kind==='temporary'?'temporary_owner_note':'owner_assertion'};
  const n=JSON.stringify(item).length+2;
  if(used+n>budget)continue;
  output.push(item);used+=n;
 }
 return output;
}

