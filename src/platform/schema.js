import {db as defaultDb,ensureColumn as defaultEnsureColumn} from '../db.js';

/** Additive, restart-safe migrations. No existing record is removed or rewritten. */
export async function migratePlatform({db=defaultDb,ensureColumn=defaultEnsureColumn}={}) {
  await db.query(`CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(32) PRIMARY KEY,value_json LONGTEXT NOT NULL,updated_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS ai_audit (
    id VARCHAR(64) PRIMARY KEY,action VARCHAR(120) NOT NULL,source VARCHAR(80),actor VARCHAR(100),
    mode VARCHAR(16),entity_type VARCHAR(40),entity_id VARCHAR(128),reason TEXT,confidence DOUBLE,
    before_json LONGTEXT,after_json LONGTEXT,confirmation VARCHAR(40),created_at VARCHAR(40),
    INDEX(created_at),INDEX(entity_type,entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  for(const [column,definition] of Object.entries({
    claim_token:'VARCHAR(64)',max_attempts:'INT NOT NULL DEFAULT 5',idempotency_key:'VARCHAR(191)',
    started_at:'VARCHAR(40)',completed_at:'VARCHAR(40)',lease_until:'VARCHAR(40)'
  })) await ensureColumn('jobs',column,definition);
  await ensureColumn('outgoing_sends','request_hash','VARCHAR(64)');
  const [indexes]=await db.query("SHOW INDEX FROM jobs WHERE Key_name='uq_job_idempotency'");
  if(!indexes.length) {
    try { await db.query('CREATE UNIQUE INDEX uq_job_idempotency ON jobs(idempotency_key)'); }
    catch(error) { if(error.code!=='ER_DUP_KEYNAME') throw error; }
  }
}
