import mysql from "mysql2/promise";
import {config} from "./config.js";

export const db=mysql.createPool({
  host:config.db.host,
  port:config.db.port,
  database:config.db.name,
  user:config.db.user,
  password:config.db.password,
  connectionLimit:config.db.poolSize,
  waitForConnections:true,
  charset:"utf8mb4",
  connectTimeout:10000
});

const schema=[
`CREATE TABLE IF NOT EXISTS projects (
 id VARCHAR(64) PRIMARY KEY,name VARCHAR(255) NOT NULL,slug VARCHAR(255),status VARCHAR(32) NOT NULL DEFAULT 'active',
 category VARCHAR(120),description LONGTEXT,next_step LONGTEXT,source VARCHAR(32) DEFAULT 'manual',repo_full_name VARCHAR(255),
 url LONGTEXT,language VARCHAR(80),is_private TINYINT(1) DEFAULT 1,modules_json LONGTEXT,custom_fields_json LONGTEXT,
 deleted_at VARCHAR(40),created_at VARCHAR(40),updated_at VARCHAR(40),INDEX(status),INDEX(updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS clients (
 id VARCHAR(64) PRIMARY KEY,name VARCHAR(255) NOT NULL,phone VARCHAR(80),email VARCHAR(255),company VARCHAR(255),
 status VARCHAR(32) DEFAULT 'active',notes LONGTEXT,created_at VARCHAR(40),updated_at VARCHAR(40),INDEX(updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS accounts (
 id VARCHAR(64) PRIMARY KEY,type VARCHAR(40) NOT NULL,label VARCHAR(255) NOT NULL,identifier VARCHAR(255) NOT NULL,
 status VARCHAR(32) DEFAULT 'active',integration_key VARCHAR(160),notes LONGTEXT,created_at VARCHAR(40),updated_at VARCHAR(40),
 UNIQUE KEY uq_integration_key(integration_key),INDEX(identifier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS systems (
 did VARCHAR(40) PRIMARY KEY,status VARCHAR(40),source VARCHAR(80),voice_minutes DOUBLE,unit_balance DOUBLE,
 unit_transactions INT DEFAULT 0,incoming_sms INT DEFAULT 0,outgoing_sms INT DEFAULT 0,last_activity VARCHAR(40),
 last_error LONGTEXT,project_id VARCHAR(64),client_id VARCHAR(64),notes LONGTEXT,updated_at VARCHAR(40),
 INDEX(project_id),INDEX(client_id),INDEX(status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS tasks (
 id VARCHAR(64) PRIMARY KEY,title VARCHAR(500) NOT NULL,status VARCHAR(32) DEFAULT 'open',priority VARCHAR(32) DEFAULT 'normal',
 due_date VARCHAR(40),notes LONGTEXT,automation_mode VARCHAR(32) DEFAULT 'manual',worker_state VARCHAR(32) DEFAULT 'idle',
 worker_result LONGTEXT,created_at VARCHAR(40),updated_at VARCHAR(40),INDEX(status),INDEX(worker_state),INDEX(updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS entity_relations (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,from_type VARCHAR(40) NOT NULL,from_id VARCHAR(100) NOT NULL,
 to_type VARCHAR(40) NOT NULL,to_id VARCHAR(100) NOT NULL,relation_type VARCHAR(60) DEFAULT 'related',
 created_at VARCHAR(40),UNIQUE KEY uq_relation(from_type,from_id,to_type,to_id,relation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS conversations (
 id VARCHAR(96) PRIMARY KEY,channel VARCHAR(40) NOT NULL,account_id VARCHAR(64),external_id VARCHAR(255),title VARCHAR(500),
 client_id VARCHAR(64),project_id VARCHAR(64),unread_count INT DEFAULT 0,last_message_at VARCHAR(40),
 created_at VARCHAR(40),updated_at VARCHAR(40),INDEX(last_message_at),INDEX(channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS messages (
 id VARCHAR(128) PRIMARY KEY,conversation_id VARCHAR(96) NOT NULL,external_id VARCHAR(255),direction VARCHAR(16) DEFAULT 'in',
 sender VARCHAR(255),recipient VARCHAR(255),subject LONGTEXT,body LONGTEXT,is_read TINYINT(1) DEFAULT 0,sent_at VARCHAR(40),
 created_at VARCHAR(40),INDEX(conversation_id),INDEX(sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS files (
 id VARCHAR(64) PRIMARY KEY,name VARCHAR(500) NOT NULL,mime VARCHAR(150),size_bytes BIGINT DEFAULT 0,storage_name VARCHAR(255),
 project_id VARCHAR(64),client_id VARCHAR(64),notes LONGTEXT,created_at VARCHAR(40),INDEX(project_id),INDEX(client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS activities (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,event VARCHAR(100) NOT NULL,entity_type VARCHAR(40),entity_id VARCHAR(100),
 title VARCHAR(500),metadata_json LONGTEXT,created_at VARCHAR(40),INDEX(created_at),INDEX(entity_type,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS notifications (
 id VARCHAR(64) PRIMARY KEY,type VARCHAR(80),title VARCHAR(500),body LONGTEXT,entity_type VARCHAR(40),entity_id VARCHAR(100),
 is_read TINYINT(1) DEFAULT 0,created_at VARCHAR(40),INDEX(is_read),INDEX(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
`CREATE TABLE IF NOT EXISTS jobs (
 id VARCHAR(64) PRIMARY KEY,type VARCHAR(100) NOT NULL,payload_json LONGTEXT,status VARCHAR(32) DEFAULT 'queued',
 attempts INT DEFAULT 0,run_after VARCHAR(40),locked_at VARCHAR(40),last_error LONGTEXT,created_at VARCHAR(40),updated_at VARCHAR(40),
 INDEX(status,run_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

export async function migrate(){
  for(const sql of schema) await db.query(sql);
  await ensureColumn("tasks","automation_mode","VARCHAR(32) DEFAULT 'manual'");
  await ensureColumn("tasks","worker_state","VARCHAR(32) DEFAULT 'idle'");
  await ensureColumn("tasks","worker_result","LONGTEXT");
  for(const [column,definition] of Object.entries({source:"VARCHAR(80)",channel:"VARCHAR(40)",account_id:"VARCHAR(64)",thread_id:"VARCHAR(255)",cc:"LONGTEXT",rfc_message_id:"VARCHAR(998)",references_json:"LONGTEXT"})) await ensureColumn("messages",column,definition);
  await ensureColumn("tasks","worker_attempts","INT DEFAULT 0");
  await ensureColumn("tasks","worker_claim","VARCHAR(64)");
  await ensureColumn("tasks","worker_retry_at","VARCHAR(40)");
  await db.query(`CREATE TABLE IF NOT EXISTS outgoing_sends (
    id VARCHAR(64) PRIMARY KEY,conversation_id VARCHAR(96) NOT NULL,status VARCHAR(32) NOT NULL,
    result_json LONGTEXT,created_at VARCHAR(40),updated_at VARCHAR(40)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

export async function ensureColumn(table,column,definition){
  const [rows]=await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",
    [config.db.name,table,column]
  );
  if(Number(rows[0]?.n||0)===0) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

export const now=()=>new Date().toISOString();
