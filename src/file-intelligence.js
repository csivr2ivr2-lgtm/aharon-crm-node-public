import path from 'node:path';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {db as defaultDb,ensureColumn} from './db.js';
import {config} from './config.js';
import {audit as platformAudit} from './platform/audit.js';
const MAX_BYTES=10*1024*1024,MAX_TEXT=200000;
const textExtensions=new Set(['.txt','.md','.json','.csv']);
const now=()=>new Date().toISOString();
export function validateFileName(name){
 name=String(name||'').normalize('NFC').trim();if(!name||name.length>240||/[\\/\x00-\x1f]/.test(name)||name==='.'||name==='..')throw Error('invalid_file_name');return name;
}
export function validateFolder(folder){
 folder=String(folder||'').normalize('NFC').trim();if(folder.length>255||folder.includes('\\')||folder.startsWith('/')||folder.split('/').some(p=>p==='.'||p==='..')||/[\x00-\x1f]/.test(folder))throw Error('invalid_folder');return folder;
}
export function validateDocxArchive(buffer){
 if(buffer.length<22)throw Error('invalid_docx_archive');
 // Check ZIP central directory before any decompression; cap expansion and entry count.
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('invalid_docx_archive');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
 if(count>2000||start+size>end||count===65535)throw Error('docx_archive_limit');
 let offset=start,total=0;
 for(let n=0;n<count;n++){
  if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw Error('invalid_docx_archive');
  const expanded=buffer.readUInt32LE(offset+24),compressed=buffer.readUInt32LE(offset+20),names=buffer.readUInt16LE(offset+28),extra=buffer.readUInt16LE(offset+30),comment=buffer.readUInt16LE(offset+32);
  total+=expanded;if(total>25*1024*1024||expanded===0xffffffff||(expanded>1024*1024&&expanded>Math.max(1,compressed)*200))throw Error('docx_archive_limit');
  offset+=46+names+extra+comment;
 }if(offset!==start+size)throw Error('invalid_docx_archive');
}
export async function extractFileText(buffer,name){
 if(buffer.length>MAX_BYTES)throw Error('file_too_large_for_index');const ext=path.extname(name).toLowerCase();
 if(textExtensions.has(ext)){const content=buffer.toString('utf8').replace(/\u0000/g,'');return {content:content.slice(0,MAX_TEXT),truncated:content.length>MAX_TEXT};}
 if(!['.pdf','.docx'].includes(ext))throw Error('unsupported_file_type');if(ext==='.docx')validateDocxArchive(buffer);
 const code=`const {parentPort,workerData}=require('node:worker_threads');(async()=>{let text='';if(workerData.ext==='.pdf'){const {getDocumentProxy}=await import('unpdf');const pdf=await getDocumentProxy(new Uint8Array(workerData.bytes),{isEvalSupported:false,disableFontFace:true,useSystemFonts:false});try{if(pdf.numPages>100)throw Error('pdf_page_limit');for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);const content=await page.getTextContent();text+=content.items.map(x=>x.str||'').join(' ')+'\\n';page.cleanup();if(text.length>200000)break;}}finally{await pdf.destroy();}}else{const imported=await import('mammoth');const mammoth=imported.default||imported;const result=await mammoth.extractRawText({buffer:Buffer.from(workerData.bytes)},{externalFileAccess:false});text=result.value;}parentPort.postMessage({content:text.slice(0,200000),truncated:text.length>200000});})().catch(e=>parentPort.postMessage({error:e.message}));`;
 return new Promise((resolve,reject)=>{const worker=new Worker(code,{eval:true,workerData:{bytes:buffer,ext},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});const timer=setTimeout(()=>{worker.terminate();reject(Error('file_extraction_timeout'));},15000);worker.once('message',result=>{clearTimeout(timer);worker.terminate();result.error?reject(Error(result.error)):resolve(result);});worker.once('error',e=>{clearTimeout(timer);reject(e);});worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('file_extraction_failed'));});});
}
export async function migrateFileIntelligence(){
 for(const [column,definition] of Object.entries({task_id:'VARCHAR(64)',folder:"VARCHAR(255) DEFAULT ''",archived_at:'VARCHAR(40)',deleted_at:'VARCHAR(40)',updated_at:'VARCHAR(40)'}))await ensureColumn('files',column,definition);
 await defaultDb.query(`CREATE TABLE IF NOT EXISTS file_content (
 file_id VARCHAR(64) PRIMARY KEY,content LONGTEXT,content_hash VARCHAR(64),status VARCHAR(32),last_error VARCHAR(255),truncated TINYINT DEFAULT 0,indexed_at VARCHAR(40),INDEX(status)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
export function createFileIntelligence({db=defaultDb,uploadDir=config.uploadDir}={}){
 async function fileRecord(id,scope={},includeDeleted=false,connection=db,lock=false){
  if(scope.internal!==true&&!scope.clientId)throw Error('file_scope_required');
  const values=[String(id)];let sql='SELECT * FROM files WHERE id=?';if(!includeDeleted)sql+=' AND deleted_at IS NULL';if(scope.internal!==true){sql+=' AND client_id=? AND archived_at IS NULL';values.push(String(scope.clientId));}
  if(lock)sql+=' FOR UPDATE';const [rows]=await connection.execute(sql,values);if(!rows[0])throw Error('file_not_found');return rows[0];
 }
 async function safePath(storageName){
  if(!/^[a-zA-Z0-9_-]{1,255}$/.test(String(storageName)))throw Error('unsafe_file_path');
  await fs.mkdir(uploadDir,{recursive:true,mode:0o700});const root=await fs.realpath(uploadDir),target=path.join(root,storageName);
  try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe_file_path');const real=await fs.realpath(target);if(path.dirname(real)!==root)throw Error('unsafe_file_path');}catch(e){if(e.code!=='ENOENT')throw e;}
  return target;
 }
 async function loadBuffer(file){const target=await safePath(file.storage_name);const handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('file_too_large_for_index');return await handle.readFile();}finally{await handle.close();}}
 async function audit(event,id,before,after,scope,connection=db){await platformAudit({action:event,entityType:'file',entityId:id,before,after,actor:scope.actor,source:scope.source,mode:scope.source==='ai'?'ai':'manual',confirmation:scope.confirmed===true?'confirmed':null},{db:connection});await connection.execute('INSERT INTO activities(event,entity_type,entity_id,title,metadata_json,created_at) VALUES(?,?,?,?,?,?)',[event,'file',id,event,JSON.stringify({actor:scope.actor||'dashboard',source:scope.source||'manual',ai:scope.source==='ai',before,after,confirmed:scope.confirmed===true}),now()]);}
 async function indexFile(id){
  const file=await fileRecord(id,{internal:true});try{const buffer=await loadBuffer(file);const hash=createHash('sha256').update(buffer).digest('hex');const result=await extractFileText(buffer,file.name);
   await db.execute("INSERT INTO file_content(file_id,content,content_hash,status,last_error,truncated,indexed_at) VALUES(?,?,?,'ready',NULL,?,?) ON DUPLICATE KEY UPDATE content=VALUES(content),content_hash=VALUES(content_hash),status='ready',last_error=NULL,truncated=VALUES(truncated),indexed_at=VALUES(indexed_at)",[id,result.content,hash,result.truncated?1:0,now()]);return {ok:true,id,...result};
  }catch(e){await db.execute("INSERT INTO file_content(file_id,status,last_error,indexed_at) VALUES(?,'error',?,?) ON DUPLICATE KEY UPDATE content=NULL,status='error',last_error=VALUES(last_error),indexed_at=VALUES(indexed_at)",[id,String(e.message).slice(0,255),now()]);throw e;}
 }
 async function readFile(id,scope={}){const file=await fileRecord(id,scope);const [rows]=await db.execute("SELECT content,status,truncated,last_error FROM file_content WHERE file_id=?",[id]);let content=rows[0];if(!content||content.status!=='ready')content=await indexFile(id);const {storage_name,...metadata}=file;return {ok:true,item:metadata,content:content.content,truncated:Boolean(content.truncated)};}
 async function searchFiles(q,scope={}){
  if(scope.internal!==true&&!scope.clientId)throw Error('file_scope_required');const term=String(q||'').trim().slice(0,300);if(!term)return {ok:true,items:[]};const like='%'+term.replace(/[!%_]/g,'!$&')+'%';const values=[like,like],where=[...(scope.internal===true&&scope.includeArchived?[]:["f.deleted_at IS NULL","f.archived_at IS NULL"]),"(f.name LIKE ? ESCAPE '!' OR c.content LIKE ? ESCAPE '!')"];
  if(scope.internal!==true){where.push('f.client_id=?');values.push(String(scope.clientId));}const limit=Math.max(1,Math.min(50,Number.parseInt(scope.limit,10)||20));
  const [items]=await db.execute(`SELECT f.id,f.name,f.size_bytes,f.client_id,f.project_id,f.task_id,f.folder,f.archived_at,f.deleted_at,c.status AS index_status,c.content,c.indexed_at FROM files f LEFT JOIN file_content c ON c.file_id=f.id AND c.status='ready' WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC LIMIT ${limit}`,values);
  return {ok:true,items:items.map(({content,...row})=>{const start=Math.max(0,String(content||'').toLowerCase().indexOf(term.toLowerCase())-80);return {...row,excerpt:String(content||'').slice(start,start+700)};})};
 }
 async function validateAssociations(input){for(const [field,table] of [['client_id','clients'],['project_id','projects'],['task_id','tasks']]){if(input[field]){const [rows]=await db.execute(`SELECT id FROM ${table} WHERE id=?${table==='projects'?' AND deleted_at IS NULL':''}`,[String(input[field])]);if(!rows.length)throw Error('association_not_found');}}}
 function writable(scope){if(scope.internal!==true)throw Error('file_write_forbidden');}
 async function createTextFile(input,scope={}){
  writable(scope);const name=validateFileName(input.name),folder=validateFolder(input.folder);if(!textExtensions.has(path.extname(name).toLowerCase()))throw Error('unsupported_file_edit');const content=String(input.content??'');if(Buffer.byteLength(content)>MAX_BYTES)throw Error('file_too_large_for_index');if(name.toLowerCase().endsWith('.json'))JSON.parse(content);
  await validateAssociations(input);const id='file_'+randomUUID(),target=await safePath(id),ts=now();await fs.writeFile(target,content,{flag:'wx',mode:0o600});
  try{await db.execute('INSERT INTO files(id,name,mime,size_bytes,storage_name,project_id,client_id,task_id,folder,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[id,name,'text/plain',Buffer.byteLength(content),id,input.project_id||null,input.client_id||null,input.task_id||null,folder,ts,ts]);}catch(e){await fs.unlink(target);throw e;}
  await indexFile(id);await audit('file.created',id,null,{name,folder},scope);return {ok:true,id};
 }
 async function updateFile(id,input,scope={}){
  writable(scope);const c=await db.getConnection();let previousBytes=null,target=null,committed=false;
  async function atomicWrite(bytes){const temporary=target+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}}
  try{
   await c.beginTransaction();const file=await fileRecord(id,scope,true,c,true);const before={name:file.name,folder:file.folder,size_bytes:file.size_bytes};
   const action=input.action||'update';if(!['archive','restore','delete','update'].includes(action))throw Error('invalid_file_action');
   if(action==='delete'&&input.confirmed!==true)throw Error('confirmation_required');if(file.deleted_at&&action!=='restore')throw Error('restore_deleted_file_first');
   if(action!=='update'&&input.content!==undefined)throw Error('separate_file_content_and_lifecycle_actions');
   const name=input.name===undefined?file.name:validateFileName(input.name),folder=input.folder===undefined?file.folder:validateFolder(input.folder);
   if(path.extname(name).toLowerCase()!==path.extname(file.name).toLowerCase())throw Error('file_extension_change_forbidden');await validateAssociations(input);
   // Keep physical names opaque; owner-defined folders are metadata only.
   if(input.content!==undefined){
    if(!textExtensions.has(path.extname(file.name).toLowerCase()))throw Error('unsupported_file_edit');
    const content=String(input.content);if(Buffer.byteLength(content)>MAX_BYTES)throw Error('file_too_large_for_index');if(name.toLowerCase().endsWith('.json'))JSON.parse(content);
    previousBytes=await loadBuffer(file);target=await safePath(file.storage_name);await atomicWrite(content);file.size_bytes=Buffer.byteLength(content);
    // Invalidate the previous text in the same transaction as the metadata update.
    await c.execute('DELETE FROM file_content WHERE file_id=?',[id]);
   }
   const archived=action==='archive'?now():action==='restore'?null:file.archived_at||null,deleted=action==='delete'?now():action==='restore'?null:file.deleted_at||null;
   await c.execute('UPDATE files SET name=?,folder=?,size_bytes=?,client_id=?,project_id=?,task_id=?,archived_at=?,deleted_at=?,updated_at=? WHERE id=?',[name,folder||'',file.size_bytes,input.client_id===undefined?file.client_id:input.client_id||null,input.project_id===undefined?file.project_id:input.project_id||null,input.task_id===undefined?file.task_id:input.task_id||null,archived,deleted,now(),id]);
   await audit('file.'+action,id,before,{name,folder,archived_at:archived,deleted_at:deleted},{...scope,confirmed:input.confirmed},c);await c.commit();committed=true;
  }catch(e){if(previousBytes!==null&&!committed)await atomicWrite(previousBytes);await c.rollback();throw e;}finally{c.release();}
  if(input.content!==undefined)await indexFile(id);return {ok:true,id};
 }

 return {safePath,indexFile,readFile,searchFiles,createTextFile,updateFile};
}
export const fileIntelligence=createFileIntelligence();
