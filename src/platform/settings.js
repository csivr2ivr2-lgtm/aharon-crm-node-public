import {z} from 'zod';
import {config} from '../config.js';
import {normalizeLocalModel,LEGACY_LOCAL_MODELS} from '../ai/local-model.js';
import {db as defaultDb,now} from '../db.js';
import {audit} from './audit.js';

const mode=z.enum(['off','suggest','automatic']);
export const settingsSchema=z.object({
  ai:z.object({localModel:z.string().trim().max(180),externalModel:z.string().trim().max(255),generativeProvider:z.enum(['external','disabled']),provider:z.enum(['local','external','auto']),model:z.string().trim().max(255),temperature:z.number().min(0).max(2),contextSize:z.number().int().min(2000).max(64000),fallback:z.boolean()}).strict(),
  automation:z.object({clients:mode,projects:mode,tasks:mode,drafts:mode,spam:mode,classification:mode,followups:mode}).strict(),
  followups:z.object({waitingHours:z.number().int().min(1).max(2160),overdueHours:z.number().int().min(0).max(2160),mode:z.enum(['remind','draft_follow_up'])}).strict(),
  messaging:z.object({policy:z.enum(['always_confirm','confirm_sensitive','auto_send_trusted','never_auto_send']),trustedClientIds:z.array(z.string().min(1).max(64)).max(500),defaultAccountId:z.string().max(64),signature:z.string().max(4000)}).strict()
}).strict();
export const DEFAULT_SETTINGS=Object.freeze({
  ai:{localModel:normalizeLocalModel(config.localAiModel),externalModel:config.aiModel,generativeProvider:'external',provider:'auto',model:'',temperature:0.3,contextSize:18000,fallback:true},
  automation:{clients:'suggest',projects:'suggest',tasks:'suggest',drafts:'automatic',spam:'automatic',classification:'automatic',followups:'suggest'},
  followups:{waitingHours:48,overdueHours:24,mode:'remind'},
  messaging:{policy:'always_confirm',trustedClientIds:[],defaultAccountId:'',signature:''}
});
export function validateSettings(patch,current=DEFAULT_SETTINGS) {
  if(!patch||Array.isArray(patch)||typeof patch!=='object')throw Error('invalid_settings');
  const merged={...current,...patch};
  for(const key of ['ai','automation','messaging','followups'])if(Object.hasOwn(patch,key)) {
    if(!patch[key]||typeof patch[key]!=='object'||Array.isArray(patch[key]))throw Error('invalid_settings');
    merged[key]={...current[key],...patch[key]};
  }
  const legacy=patch.ai||{};
  if(legacy.model&&!Object.hasOwn(legacy,'localModel')&&!Object.hasOwn(legacy,'externalModel')){
   if(legacy.provider==='local'||/^onnx-community\//.test(legacy.model))merged.ai.localModel=normalizeLocalModel(legacy.model);
   else merged.ai.externalModel=legacy.model;
  }
  merged.ai={...merged.ai,localModel:normalizeLocalModel(merged.ai.localModel,normalizeLocalModel(config.localAiModel))};
  return settingsSchema.parse(merged);
}
export async function getSettings(db=defaultDb) {
  const [rows]=await db.execute("SELECT value_json FROM app_settings WHERE id='global'");
  return rows.length?validateSettings(JSON.parse(rows[0].value_json)):structuredClone(DEFAULT_SETTINGS);
}
export async function updateSettings(patch,{actor='owner',db=defaultDb}={}) {
  // Validate the patch before acquiring a connection; validate again against the locked row.
  validateSettings(patch);
  const connection=await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT IGNORE INTO app_settings (id,value_json,updated_at) VALUES ('global',?,?)",[JSON.stringify(DEFAULT_SETTINGS),now()]);
    const [rows]=await connection.execute("SELECT value_json FROM app_settings WHERE id='global' FOR UPDATE");
    const before=validateSettings(JSON.parse(rows[0].value_json));
    const settings=validateSettings(patch,before);
    await connection.execute("UPDATE app_settings SET value_json=?,updated_at=? WHERE id='global'",[JSON.stringify(settings),now()]);
    await audit({action:'settings.update',actor,before,after:settings},{db:connection});
    await connection.commit();return settings;
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}

// Additive data migration: change only obsolete local model selectors, keep custom models.
export async function migrateLocalModelSettings(database=defaultDb){
 const c=await database.getConnection();try{
  await c.beginTransaction();const [rows]=await c.execute("SELECT value_json FROM app_settings WHERE id='global' FOR UPDATE");
  if(rows.length){const before=JSON.parse(rows[0].value_json),ai=before.ai||{};
   const old=ai.localModel||((ai.provider==='local'||/^onnx-community\//.test(ai.model||''))?ai.model:'');
   if(LEGACY_LOCAL_MODELS.includes(old)){
    const after={...before,ai:{...ai,localModel:normalizeLocalModel(old)}};
    await c.execute("UPDATE app_settings SET value_json=?,updated_at=? WHERE id='global'",[JSON.stringify(after),now()]);
    await audit({action:'settings.local_model_migrated',source:'migration',before:{localModel:old},after:{localModel:after.ai.localModel}},{db:c});
   }
  }
  await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
}
