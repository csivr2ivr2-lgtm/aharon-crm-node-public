import {randomUUID} from 'node:crypto';
import {db as defaultDb,now} from '../db.js';

const secretKey=/(password|secret|token|authorization|cookie|credential|api.?key)/i;
export function redactAudit(value,depth=0) {
  if(depth>12)return '[depth limit]';
  if(typeof value==='string')return value.slice(0,12000).replace(/Bearer\s+[\w.~-]+/gi,'Bearer [redacted]');
  if(Array.isArray(value))return value.slice(0,100).map(item=>redactAudit(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([key,item])=>[key,secretKey.test(key)?'[redacted]':redactAudit(item,depth+1)]));
  return value??null;
}
export async function audit(entry,{db=defaultDb}={}) {
  if(!entry||typeof entry.action!=='string'||!entry.action||entry.action.length>120)throw Error('invalid_audit_action');
  const id=randomUUID();
  await db.execute(`INSERT INTO ai_audit (id,action,source,actor,mode,entity_type,entity_id,reason,confidence,before_json,after_json,confirmation,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,entry.action,String(entry.source||'manual').slice(0,80),String(entry.actor||'owner').slice(0,100),entry.mode==='ai'?'ai':'manual',entry.entityType??null,entry.entityId??null,String(entry.reason||'').slice(0,2000),Number.isFinite(entry.confidence)?Math.max(0,Math.min(1,entry.confidence)):null,JSON.stringify(redactAudit(entry.before)),JSON.stringify(redactAudit(entry.after)),entry.confirmation??null,now()]);
  return {id};
}
export async function listAudit({limit=100,db=defaultDb}={}) {
  const count=Math.min(200,Math.max(1,Number.parseInt(limit,10)||100));
  const [rows]=await db.execute(`SELECT * FROM ai_audit ORDER BY created_at DESC LIMIT ${count}`);
  return rows;
}
