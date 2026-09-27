import {randomUUID} from 'node:crypto';
import {db as defaultDb,now} from '../db.js';

export async function enqueueJob(type,payload,{idempotencyKey,maxAttempts=5,runAfter,db=defaultDb}={}) {
  if(typeof type!=='string'||!type||type.length>100)throw Error('invalid_job_type');
  if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||!idempotencyKey||idempotencyKey.length>191))throw Error('invalid_idempotency_key');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>20)throw Error('invalid_max_attempts');
  const encoded=JSON.stringify(payload??{});
  if(encoded.length>256000)throw Error('job_payload_too_large');
  const id=randomUUID(),timestamp=now(),after=runAfter?new Date(runAfter).toISOString():timestamp;
  await db.execute(`INSERT INTO jobs (id,type,payload_json,status,attempts,max_attempts,idempotency_key,run_after,created_at,updated_at)
    VALUES (?,?,?,'queued',0,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,[id,type,encoded,maxAttempts,idempotencyKey??null,after,timestamp,timestamp]);
  const [rows]=await db.execute('SELECT * FROM jobs WHERE '+(idempotencyKey?'idempotency_key=?':'id=?'),[idempotencyKey||id]);
  return rows[0];
}

/** Transactional claim works on MySQL and MariaDB without requiring SKIP LOCKED. */
export async function claimJob({leaseMs=120000,db=defaultDb,types}={}) {
  if(!Number.isFinite(leaseMs)||leaseMs<1000||leaseMs>3600000)throw Error('invalid_lease');
  if(types&&(!Array.isArray(types)||!types.length||types.some(type=>typeof type!=='string'||!type)))return null;
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();const timestamp=now();
    await connection.execute("UPDATE jobs SET status='failed',last_error='lease_expired_attempts_exhausted',completed_at=?,claim_token=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND (lease_until IS NULL OR lease_until<=?) AND attempts>=max_attempts",[timestamp,timestamp,timestamp]);
    const filter=types?' AND type IN ('+types.map(()=>'?').join(',')+')':'';
    const [rows]=await connection.execute(`SELECT * FROM jobs WHERE attempts<max_attempts AND ((status='queued' AND (run_after IS NULL OR run_after<=?)) OR (status='running' AND (lease_until IS NULL OR lease_until<=?)))${filter} ORDER BY run_after,created_at,id LIMIT 1 FOR UPDATE`,[timestamp,timestamp,...(types||[])]);
    if(!rows.length){await connection.commit();return null;}
    const job=rows[0],token=randomUUID(),leaseUntil=new Date(Date.now()+leaseMs).toISOString();
    await connection.execute("UPDATE jobs SET status='running',attempts=attempts+1,claim_token=?,locked_at=?,lease_until=?,started_at=COALESCE(started_at,?),updated_at=? WHERE id=?",[token,timestamp,leaseUntil,timestamp,timestamp,job.id]);
    await connection.commit();
    return {...job,status:'running',attempts:Number(job.attempts)+1,claim_token:token,lease_until:leaseUntil};
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

export async function renewJob(job,{leaseMs=120000,db=defaultDb}={}) {
  const timestamp=now();
  const [result]=await db.execute("UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND status='running' AND claim_token=? AND lease_until>?",[new Date(Date.now()+leaseMs).toISOString(),timestamp,job.id,job.claim_token,timestamp]);
  return result.affectedRows===1;
}
export async function completeJob(job,{db=defaultDb}={}) {
  const timestamp=now();
  const [result]=await db.execute("UPDATE jobs SET status='done',completed_at=?,updated_at=?,claim_token=NULL,lease_until=NULL,last_error=NULL WHERE id=? AND status='running' AND claim_token=? AND lease_until>?",[timestamp,timestamp,job.id,job.claim_token,timestamp]);
  return result.affectedRows===1;
}
export async function failJob(job,error,{db=defaultDb}={}) {
  const timestamp=now(),exhausted=Number(job.attempts)>=Number(job.max_attempts||5);
  // Persist only a short error code. Provider errors may contain credentials or message bodies.
  const raw=String(error?.code||error?.message||'job_failed');
  const code=/^[a-zA-Z0-9_.-]{1,100}$/.test(raw)?raw:'job_execution_failed';
  const retryAt=new Date(Date.now()+Math.min(3600000,1000*2**Math.min(Number(job.attempts)||1,12))).toISOString();
  const [result]=await db.execute("UPDATE jobs SET status=?,last_error=?,run_after=?,completed_at=?,updated_at=?,claim_token=NULL,lease_until=NULL WHERE id=? AND status='running' AND claim_token=? AND lease_until>?",[exhausted?'failed':'queued',code,retryAt,exhausted?timestamp:null,timestamp,job.id,job.claim_token,timestamp]);
  return result.affectedRows===1;
}
export async function retryJob(id,{db=defaultDb}={}) {
  const timestamp=now();
  const [result]=await db.execute("UPDATE jobs SET status='queued',attempts=0,run_after=?,completed_at=NULL,claim_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='failed'",[timestamp,timestamp,id]);
  return {ok:result.affectedRows===1};
}
export async function listJobs({limit=100,db=defaultDb}={}) {
  const count=Math.min(200,Math.max(1,Number.parseInt(limit,10)||100));
  const [rows]=await db.execute(`SELECT id,type,status,attempts,max_attempts,run_after,last_error,created_at,started_at,completed_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT ${count}`);
  return rows;
}

/** Handlers MUST use job IDs/source IDs for business-write idempotency; leases are at-least-once. */
export function startJobWorker(handlers,{intervalMs=3000,leaseMs=120000,db=defaultDb,onError=()=>{}}={}) {
  let stopped=false,running=false,inflight=Promise.resolve();
  async function run() {
    if(stopped||running)return;running=true;
    try {
      const job=await claimJob({leaseMs,db,types:Object.keys(handlers)});if(!job)return;
      const abort=new AbortController();let renewing=false;
      const heartbeat=setInterval(async()=>{
        if(renewing)return;renewing=true;
        try{if(!await renewJob(job,{leaseMs,db}))abort.abort(Error('job_lease_lost'));}
        catch(error){abort.abort(error);onError(error);}finally{renewing=false;}
      },Math.max(250,Math.floor(leaseMs/3)));heartbeat.unref?.();
      try {
        const payload=JSON.parse(job.payload_json||'{}');
        await handlers[job.type](payload,{...job,signal:abort.signal});
        if(!abort.signal.aborted)await completeJob(job,{db});
      }catch(error){await failJob(job,error,{db});onError(error);}finally{clearInterval(heartbeat);}
    }catch(error){onError(error);}finally{running=false;}
  }
  const tick=()=>{if(!running)inflight=run();};
  const timer=setInterval(tick,Math.max(100,intervalMs));timer.unref?.();tick();
  return async()=>{stopped=true;clearInterval(timer);await inflight;};
}
