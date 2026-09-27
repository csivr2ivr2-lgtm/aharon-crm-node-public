import {db} from "./db.js";
export async function migrateExtras(){
 await db.query(`CREATE TABLE IF NOT EXISTS crm_notes (
  id VARCHAR(64) PRIMARY KEY,entity_type VARCHAR(40) NOT NULL,entity_id VARCHAR(100) NOT NULL,title VARCHAR(255),
  body LONGTEXT,created_at VARCHAR(40),updated_at VARCHAR(40),INDEX(entity_type,entity_id),INDEX(updated_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
 await db.query(`CREATE TABLE IF NOT EXISTS message_drafts (
  id VARCHAR(64) PRIMARY KEY,conversation_id VARCHAR(96) NOT NULL,body LONGTEXT NOT NULL,instruction LONGTEXT,
  provider VARCHAR(80),model VARCHAR(255),status VARCHAR(32) DEFAULT 'draft',created_at VARCHAR(40),updated_at VARCHAR(40),
  INDEX(conversation_id),INDEX(status),INDEX(updated_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
