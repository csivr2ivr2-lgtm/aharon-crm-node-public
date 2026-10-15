import {randomUUID} from 'node:crypto';
import {db as defaultDb,now} from './db.js';
import {memoryTerms} from './owner-memory.js';

// The database is the source of truth; client-supplied chat/action identifiers grant no authority.
const id=prefix=>prefix+randomUUID();
const validChat=s=>/^chat_[a-f0-9-]{36}$/.test(String(s||''));
const validRequest=s=>/^[a-zA-Z0-9_-]{8,64}$/.test(String(s||''));
const title=s=>String(s||'שיחה חדשה').slice(0,180);
export async function migrateAssistantChats(database=defaultDb){
 await database.query("CREATE TABLE IF NOT EXISTS assistant_chat_sessions (id VARCHAR(64) PRIMARY KEY,actor VARCHAR(64) NOT NULL,title VARCHAR(180),created_at VARCHAR(40),updated_at VARCHAR(40),archived_at VARCHAR(40),INDEX(actor,updated_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 await database.query("CREATE TABLE IF NOT EXISTS assistant_chat_turns (id VARCHAR(64) PRIMARY KEY,session_id VARCHAR(64) NOT NULL,role VARCHAR(12) NOT NULL,body LONGTEXT NOT NULL,request_id VARCHAR(64) NOT NULL,created_at VARCHAR(40),UNIQUE KEY uq_turn_request(session_id,request_id,role),INDEX(session_id,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
 await database.query("CREATE TABLE IF NOT EXISTS assistant_chat_actions (action_id VARCHAR(64) PRIMARY KEY,session_id VARCHAR(64) NOT NULL,turn_id VARCHAR(64) NOT NULL,tool VARCHAR(80),args_json LONGTEXT,preview_json LONGTEXT,dismissed_at VARCHAR(40),INDEX(session_id,turn_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
const parse=s=>{try{return JSON.parse(s||'{}')}catch{return {}}};
export class AssistantChatHistory{
 constructor({database=defaultDb,engine=null,assistant=null,clock=now}={}){Object.assign(this,{database,engine,assistant,clock});}
 async ensure(sessionId,actor='dashboard'){
  if(!validChat(sessionId))throw Error('assistant_chat_not_found');
  const [rows]=await this.database.execute('SELECT id FROM assistant_chat_sessions WHERE id=? AND actor=? AND archived_at IS NULL',[sessionId,actor]);
  if(!rows.length)throw Error('assistant_chat_not_found');
 }
 async create(actor='dashboard'){
  const sessionId=id('chat_'),ts=this.clock();
  await this.database.execute('INSERT INTO assistant_chat_sessions(id,actor,title,created_at,updated_at) VALUES(?,?,?,?,?)',[sessionId,actor,'שיחה חדשה',ts,ts]);
  return {ok:true,id:sessionId,title:'שיחה חדשה'};
 }
 async list(actor='dashboard'){
  const [items]=await this.database.execute('SELECT id,title,created_at,updated_at FROM assistant_chat_sessions WHERE actor=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 60',[actor]);
  return {ok:true,items};
 }
 async archive(sessionId,actor='dashboard'){
  await this.ensure(sessionId,actor);
  await this.database.execute('UPDATE assistant_chat_sessions SET archived_at=?,updated_at=? WHERE id=? AND actor=? AND archived_at IS NULL',[this.clock(),this.clock(),sessionId,actor]);
  return {ok:true};
 }
 async actionBelongs(sessionId,actionId,actor='dashboard'){
  await this.ensure(sessionId,actor);
  const [found]=await this.database.execute('SELECT action_id FROM assistant_chat_actions WHERE action_id=? AND session_id=? AND dismissed_at IS NULL',[actionId,sessionId]);
  if(!found.length)throw Error('assistant_action_not_in_chat');
 }
 async actionChanged(sessionId,actionId,actor='dashboard'){
  await this.actionBelongs(sessionId,actionId,actor);
  return this.load(sessionId,actor);
 }
 async dismiss(sessionId,actionId,actor='dashboard'){
  await this.actionBelongs(sessionId,actionId,actor);
  await this.engine.dismissPending(actionId,{actor,source:'chat',trustedInput:true});
  await this.database.execute('UPDATE assistant_chat_actions SET dismissed_at=? WHERE action_id=? AND session_id=?',[this.clock(),actionId,sessionId]);
  return {ok:true};
 }
 async load(sessionId,actor='dashboard'){
  await this.ensure(sessionId,actor);
  const [turns]=await this.database.execute("SELECT id,role,body,request_id,created_at FROM assistant_chat_turns WHERE session_id=? ORDER BY created_at DESC,CASE WHEN role='user' THEN 0 ELSE 1 END DESC,id DESC LIMIT 400",[sessionId]);
  const [links]=await this.database.execute('SELECT l.action_id,l.turn_id,l.tool,l.args_json,l.preview_json,l.dismissed_at,a.state,a.expires_at FROM assistant_chat_actions l LEFT JOIN ai_actions a ON a.id=l.action_id WHERE l.session_id=?',[sessionId]);
  const indexed=new Map(),visibleTurns=new Set(turns.map(t=>t.id));
  for(const link of links){
   if(!visibleTurns.has(link.turn_id))continue;
   const actions=indexed.get(link.turn_id)||[];
   let status=link.dismissed_at?'dismissed':link.state||'unknown',confirmation_token;
   if(status==='pending'){
    try{
     confirmation_token=await this.engine.reissuePendingToken(link.action_id,{actor,source:'chat',trustedInput:true});
     if(!confirmation_token)status='expired';
    }catch{status='expired';}
   }
   actions.push({id:link.action_id,tool:link.tool,args:parse(link.args_json),preview:parse(link.preview_json),status,...(confirmation_token?{confirmation_token}:{})});
   indexed.set(link.turn_id,actions);
  }
  return {ok:true,id:sessionId,messages:turns.reverse().map(t=>({id:t.id,role:t.role,text:t.body,created_at:t.created_at,actions:indexed.get(t.id)||[]}))};
 }
 async send({sessionId,message,requestId,actor='dashboard',context}){
  await this.ensure(sessionId,actor);
  if(typeof message!=='string'||!message.trim()||message.length>12000||!validRequest(requestId))throw Error('invalid_chat_message');
  const [replayed]=await this.database.execute("SELECT id FROM assistant_chat_turns WHERE session_id=? AND request_id=? AND role='user'",[sessionId,requestId]);
  if(replayed.length)throw Error('assistant_request_already_received');
  const ts=this.clock(),userId=id('turn_');
  await this.database.execute('INSERT INTO assistant_chat_turns(id,session_id,role,body,request_id,created_at) VALUES(?,?,?,?,?,?)',[userId,sessionId,'user',message.trim(),requestId,ts]);
  const [prior]=await this.database.execute("SELECT role,body FROM assistant_chat_turns WHERE session_id=? AND request_id<>? ORDER BY created_at DESC,id DESC LIMIT 12",[sessionId,requestId]);
  const history=prior.reverse().map(t=>({role:t.role,text:String(t.body||'').slice(0,1400)}));
  const terms=memoryTerms(message).slice(0,12);
  let recalledHistory=[];
  if(terms.length){
   const score=terms.map(()=>'(CASE WHEN LOCATE(?,LOWER(body))>0 THEN 1 ELSE 0 END)').join('+');
   const [recalled]=await this.database.execute(`SELECT role,body,(${score}) AS relevance FROM assistant_chat_turns WHERE session_id=? AND request_id<>? HAVING relevance>0 ORDER BY relevance DESC,created_at DESC,id DESC LIMIT 6`,[...terms,sessionId,requestId]);
   recalledHistory=recalled.filter(t=>!history.some(h=>h.role===t.role&&h.text===String(t.body||'').slice(0,1400))).map(t=>({role:t.role,text:String(t.body||'').slice(0,1000)}));
  }
  const response=await this.assistant.chat({message:message.trim(),context,requestId,history,recalledHistory});
  const replyId=id('turn_');
  const result=response.reply||'לא התקבלה תשובה.';
  const c=await this.database.getConnection();
  try{
   await c.beginTransaction();
   await c.execute('INSERT INTO assistant_chat_turns(id,session_id,role,body,request_id,created_at) VALUES(?,?,?,?,?,?)',[replyId,sessionId,'assistant',result,requestId,this.clock()]);
   for(const action of response.actions||[]){
    if(!action.id||!/^act_[a-z0-9_-]{12,63}$/i.test(action.id))continue;
    const {confirmation_token,...safe}=action;
    const preview={...safe.preview};delete preview.account_key;
    await c.execute('INSERT INTO assistant_chat_actions(action_id,session_id,turn_id,tool,args_json,preview_json) VALUES(?,?,?,?,?,?)',[safe.id,sessionId,replyId,String(safe.tool||''),JSON.stringify(safe.args||{}),JSON.stringify(preview)]);
   }
   await c.execute('UPDATE assistant_chat_sessions SET title=IF(title=?,?,title),updated_at=? WHERE id=? AND actor=?',['שיחה חדשה',title(message.trim()),this.clock(),sessionId,actor]);
   await c.commit();
  }catch(error){await c.rollback();throw error;}finally{c.release();}
  return {ok:true,id:replyId,reply:result,actions:response.actions||[],provider:response.provider,model:response.model};
 }
}

