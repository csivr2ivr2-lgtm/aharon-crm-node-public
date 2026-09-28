import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import {config,assertConfig} from "./config.js";
import {equalToken,bearerToken} from "./http.js";
import {migrate,db} from "./db.js";
import {readFile,mkdir,unlink} from "node:fs/promises";
import {createWriteStream,createReadStream,constants} from "node:fs";
import {Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {resolve,basename} from "node:path";
import {randomBytes} from "node:crypto";
import {aiStatus} from "./ai/local-ai.js";
import {migrateExtras} from "./extra-schema.js";
import {WorkspaceService} from "./workspace-service.js";
import {ConnectorsClient,googleConnector,hostingerMail,whatsapp} from "./clients/connectors.js";
import {RealtimeHub} from "./realtime.js";
import {SyncScheduler} from "./scheduler.js";
import {SmartTaskWorker} from "./worker.js";
import {createDraft,listDrafts,sendConversationReply} from "./inbox.js";
import {handleMcp} from "./mcp.js";
import {appHtml,loginHtml,lockedHtml,blockedHtml} from "./ui.js";
import {loginSecurity,normalizeIp} from "./login-security.js";
import {migratePlatform} from "./platform/schema.js";
import {enqueueJob,startJobWorker} from "./platform/jobs.js";
import {migrateIntelligence} from "./ai/intelligence.js";
import {migrateActions} from "./ai/actions.js";
import {migrateCrmIntelligence} from "./crm-intelligence.js";
import {migrateFileIntelligence,fileIntelligence} from "./file-intelligence.js";
import {registerIntelligenceRoutes} from "./intelligence-routes.js";
import {migrateKnowledge} from "./ai/knowledge.js";
import {BackgroundActionRuntime} from "./ai/background-actions.js";

export async function buildApp({initializeDatabase=true,startBackground=true}={}){
assertConfig();await loginSecurity.initialize();await hostingerMail.initialize();if(initializeDatabase){await migrate();await migrateExtras();await migratePlatform();await migrateCrmIntelligence();await migrateFileIntelligence();await migrateIntelligence();await migrateActions();await migrateKnowledge();}
const app=Fastify({trustProxy:config.trustProxy,logger:config.env==="test"?false:{serializers:{req:req=>({method:req.method,url:String(req.url||"").split("?")[0],remoteAddress:req.ip})},level:config.env==="production"?"info":"debug",redact:["req.headers.authorization","*.password","*.token","*.secret","*.api_key","*.access_token","*.refresh_token"]},bodyLimit:3*1024*1024});
await app.register(cookie,{secret:config.sessionSecret,hook:"onRequest"});await app.register(formbody);await app.register(multipart,{limits:{fileSize:25*1024*1024}});
const workspace=new WorkspaceService(),connectors=new ConnectorsClient(),hub=new RealtimeHub(app.server),scheduler=new SyncScheduler({hub,logger:app.log}),worker=new SmartTaskWorker({hub,logger:app.log});

function logged(req){const raw=req.cookies?.crm_session;if(!raw)return false;const u=req.unsignCookie(raw);return u.valid&&Number(u.value)>Date.now()}
function uiAuth(req,reply){if(logged(req))return true;reply.code(401).type("application/json").send({ok:false,error:"login_required"});return false}
function apiAuth(req,reply){if(equalToken(bearerToken(req),config.coreApiToken))return true;return uiAuth(req,reply)}
const cookieOpts={path:"/",httpOnly:true,sameSite:"strict",secure:config.env==="production",maxAge:60*60*24*14};

app.get("/health",async()=>({ok:true,service:"aharon-crm-node",locked:await loginSecurity.isLocked()}));
app.get("/assets/app.js",async(_req,reply)=>reply.type("text/javascript").send(await readFile(new URL("./browser.js",import.meta.url),"utf8")));
app.addHook("onRequest",async(req,reply)=>{
 reply.header("X-Content-Type-Options","nosniff").header("X-Frame-Options","DENY").header("Referrer-Policy","same-origin").header("Cache-Control","no-store");
 if(!["GET","HEAD","OPTIONS"].includes(req.method)&&req.headers.origin){
  const expected=config.publicBaseUrl?new URL(config.publicBaseUrl).origin:req.protocol+"://"+req.headers.host;
  if(req.headers.origin!==expected)return reply.code(403).send({ok:false,error:"origin_rejected"});
 }
});
app.addHook("onRequest",async(req,reply)=>{
 const path=String(req.raw.url||"").split("?")[0];if(path==="/health")return;
 const ip=normalizeIp(req.ip);
 if(await loginSecurity.isBlacklisted(ip)){
  if(path==="/"&&req.method==="GET")return reply.code(403).type("text/html; charset=utf-8").send(blockedHtml());
  return reply.code(403).send({ok:false,error:"ip_blocked"});
 }
 if(await loginSecurity.isLocked()){
  if((path==="/"&&req.method==="GET")||path==="/login")return reply.code(423).type("text/html; charset=utf-8").send(lockedHtml());
  return reply.code(423).send({ok:false,error:"crm_locked"});
 }
});
app.setErrorHandler((error,req,reply)=>{app.log.warn({errorName:error.name,code:error.code},"Request failed");reply.code(error.statusCode>=400&&error.statusCode<500?error.statusCode:400).send({ok:false,error:/^[a-z_]{3,100}$/.test(error.message)?error.message:"request_failed"});});
app.get("/",async(req,reply)=>reply.type("text/html; charset=utf-8").send(logged(req)?appHtml():loginHtml()));
app.post("/login",async(req,reply)=>{const p=String(req.body?.password||""),ip=normalizeIp(req.ip);if(!equalToken(p,config.dashboardPassword)){const state=await loginSecurity.failed(ip);app.log.warn({remoteAddress:ip,attempt:state.count,locked:state.locked},"Dashboard login failed");if(state.locked)return reply.code(423).type("text/html; charset=utf-8").send(lockedHtml());return reply.code(401).type("text/html; charset=utf-8").send(loginHtml({error:"סיסמה שגויה"}));}loginSecurity.success(ip);reply.setCookie("crm_session",String(Date.now()+14*86400000),{...cookieOpts,signed:true});return reply.redirect("/")});
app.post("/logout",async(req,reply)=>{reply.clearCookie("crm_session",{path:"/"});return reply.redirect("/")});

app.get("/api/status",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("status")});
app.get("/api/projects",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("project.list",{...req.query,limit:100})});
app.post("/api/projects",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("project.create",req.body||{})});
app.get("/api/clients",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("client.list",{limit:100})});
app.post("/api/clients",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("client.create",req.body||{})});
app.get("/api/tasks",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("task.list",{limit:100})});
app.post("/api/tasks",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("task.create",{status:"open",priority:"normal",worker_state:"idle",...(req.body||{})})});
app.get("/api/inbox",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("conversation.list",{...req.query,limit:100})});
app.get("/api/conversations/:id",async(req,reply)=>{if(!uiAuth(req,reply))return;const r=await workspace.call("conversation.get",{id:req.params.id});if(!r.ok)return reply.code(404).send(r);return r});
app.post("/api/conversations/:id/read",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("conversation.read",{id:req.params.id})});
app.post("/api/conversations/:id/draft",async(req,reply)=>{if(!uiAuth(req,reply))return;return createDraft({conversationId:req.params.id,instruction:String(req.body?.instruction||""),tone:String(req.body?.tone||"")})});
app.get("/api/conversations/:id/drafts",async(req,reply)=>{if(!uiAuth(req,reply))return;return {ok:true,items:await listDrafts(req.params.id)}});
app.post("/api/conversations/:id/send",async(req,reply)=>{if(!uiAuth(req,reply))return;if(req.body?.confirmed!==true)throw Error("confirmation_required");const body=String(req.body?.body||"").trim();if(!body)return reply.code(422).send({ok:false,error:"body_required"});const sent=await sendConversationReply({conversationId:req.params.id,body,draftId:String(req.body?.draft_id||""),requestId:String(req.body?.request_id||"")});hub.publish("message.sent",{conversation_id:req.params.id});return sent;});
app.get("/api/connectors",async(req,reply)=>{if(!uiAuth(req,reply))return;return connectors.status()});
app.get("/api/whatsapp/status",async(req,reply)=>{if(!uiAuth(req,reply))return;return {ok:true,...whatsapp.status()}});
app.post("/api/sync",async(req,reply)=>{if(!uiAuth(req,reply))return;return scheduler.runOnce()});
app.post("/api/google/auth-url",async(req,reply)=>{if(!uiAuth(req,reply))return;if(!googleConnector.configured())return reply.code(503).send({ok:false,error:"google_not_configured"});const url=googleConnector.authUrl(String(req.body?.account_hint||""));reply.setCookie("oauth_state",new URL(url).searchParams.get("state"),{...cookieOpts,signed:true,sameSite:"lax",maxAge:600});return {ok:true,url}});
app.get("/oauth/google/callback",async(req,reply)=>{
 const state=String(req.query?.state||""),saved=req.unsignCookie(req.cookies?.oauth_state||"");
 if(!saved.valid||!equalToken(saved.value,state))return reply.code(400).send({ok:false,error:"invalid_oauth_state"});
 reply.clearCookie("oauth_state",{path:"/"});await googleConnector.callback(String(req.query?.code||""),state);return reply.redirect("/#connectors");
});
app.get("/api/files",async(req,reply)=>{if(!uiAuth(req,reply))return;if(req.query.q)return fileIntelligence.searchFiles(req.query.q,{internal:true,includeArchived:Boolean(req.query.include_archived)});const [items]=await db.query("SELECT f.id,f.name,f.mime,f.size_bytes,f.project_id,f.client_id,f.task_id,f.folder,f.notes,f.archived_at,f.deleted_at,f.created_at,c.status AS index_status FROM files f LEFT JOIN file_content c ON c.file_id=f.id "+(req.query.include_archived?"":"WHERE f.deleted_at IS NULL AND f.archived_at IS NULL ")+"ORDER BY f.created_at DESC LIMIT 200");return {ok:true,items};});
app.post("/api/files",async(req,reply)=>{
 if(!uiAuth(req,reply))return;const part=await req.file();if(!part)throw Error("file_required");
 const id="file_"+randomBytes(16).toString("hex"),name=basename(part.filename).replace(/[\r\n\0]/g,"").slice(0,500)||"attachment";
 await mkdir(config.uploadDir,{recursive:true,mode:0o700});const path=resolve(config.uploadDir,id);
 try{
  let size=0;await pipeline(part.file,new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(null,chunk);}}),createWriteStream(path,{flags:"wx",mode:0o600}));if(part.file.truncated)throw Error("file_too_large");
  const connection=await db.getConnection();try{await connection.beginTransaction();
   await connection.execute("INSERT INTO files(id,name,mime,size_bytes,storage_name,created_at) VALUES(?,?,?,?,?,?)",[id,name,part.mimetype,size,id,new Date().toISOString()]);
   await enqueueJob("file.index",{fileId:id},{idempotencyKey:"file:"+id,db:connection});await connection.commit();
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}return {ok:true,id};
 }catch(error){await unlink(path).catch(()=>{});throw error;}
});
app.get("/api/files/:id/download",async(req,reply)=>{
 if(!uiAuth(req,reply))return;const [rows]=await db.execute("SELECT * FROM files WHERE id=? AND deleted_at IS NULL",[req.params.id]);const file=rows[0];
 if(!file)return reply.code(404).send({ok:false,error:"file_not_found"});
 const path=await fileIntelligence.safePath(file.storage_name);
 reply.type("application/octet-stream").header("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(file.name));return reply.send(createReadStream(path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW}));
});
app.get("/api/ai/status",async(req,reply)=>{if(!uiAuth(req,reply))return;return {ok:true,...aiStatus()};});
app.post("/api/ws-ticket",async(req,reply)=>{if(!uiAuth(req,reply))return;return {ok:true,ticket:hub.issueTicket()};});
for(const [plural,entity] of [["projects","project"],["clients","client"],["tasks","task"],["systems","system"],["accounts","account"]]){
 if(["systems","accounts"].includes(plural)){
  app.get("/api/"+plural,async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call(entity+".list",req.query||{});});
  app.post("/api/"+plural,async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call(entity+".create",req.body||{});});
 }
 app.patch("/api/"+plural+"/:id",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call(entity+".update",{...(req.body||{}),[entity==="system"?"did":"id"]:req.params.id});});
}
app.patch("/api/conversations/:id",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("conversation.update",{...(req.body||{}),id:req.params.id});});
app.get("/api/notes",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("note.list",req.query||{});});
app.post("/api/notes",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("note.create",req.body||{});});
app.post("/api/whatsapp/connect",async(req,reply)=>{if(!uiAuth(req,reply))return;await whatsapp.start(onWhatsAppEvent);return {ok:true,...whatsapp.status()};});
app.post("/api/whatsapp/logout",async(req,reply)=>{if(!uiAuth(req,reply))return;await whatsapp.logout();return {ok:true};});
app.post("/api/hostinger/accounts",async(req,reply)=>{if(!uiAuth(req,reply))return;return hostingerMail.configure(req.body||{});});
app.post("/api/hostinger/disconnect",async(req,reply)=>{if(!uiAuth(req,reply))return;return hostingerMail.disconnect();});
app.delete("/api/google/accounts/:id",async(req,reply)=>{if(!uiAuth(req,reply))return;return googleConnector.disconnect(req.params.id);});
app.post("/api/whatsapp/disconnect",async(req,reply)=>{if(!uiAuth(req,reply))return;await whatsapp.disconnect();return {ok:true,...whatsapp.status()};});
app.post("/api/whatsapp/reconnect",async(req,reply)=>{if(!uiAuth(req,reply))return;await whatsapp.reconnect(onWhatsAppEvent);return {ok:true,...whatsapp.status()};});
app.delete("/api/whatsapp/session",async(req,reply)=>{if(!uiAuth(req,reply))return;await whatsapp.deleteSession();return {ok:true,...whatsapp.status()};});

app.get("/v1/status",async(req,reply)=>{if(!apiAuth(req,reply))return;return {ok:true,workspace:await workspace.call("status"),connectors:await connectors.status()}});
app.post("/v1/workspace/:op",async(req,reply)=>{if(!apiAuth(req,reply))return;return workspace.call(req.params.op,req.body||{});});
app.post("/v1/sync",async(req,reply)=>{if(!apiAuth(req,reply))return;return scheduler.runOnce()});
app.all("/mcp",handleMcp);

async function onWhatsAppEvent(event){const r=await workspace.call("message.ingest",event);if(r.inserted)hub.publish("message.new",{conversation_id:r.conversation_id,channel:"whatsapp"});}
const backgroundState={enabled:startBackground,running:false,last_error:null};
registerIntelligenceRoutes(app,{uiAuth,hub,backgroundState});
let stopJobs=async()=>{},reminders;
app.addHook("onClose",async()=>{clearInterval(reminders);scheduler.stop();worker.stop();await stopJobs();backgroundState.running=false;whatsapp.stop();hub.close();if(initializeDatabase)await db.end();});
if(startBackground)app.addHook("onListen",async()=>{
 scheduler.start();worker.start();backgroundState.running=true;
 const runtime=new BackgroundActionRuntime(),handlers=runtime.queueHandlers();
 const processInbox=handlers["inbox.process"];
 handlers["inbox.process"]=async(payload,job)=>{const result=await processInbox(payload,job);hub.publish("ai.inbox",{message_id:payload.messageId});return result;};
 stopJobs=startJobWorker(handlers,{onError:()=>{backgroundState.last_error="background_processing_failed";app.log.warn("Background processing failed; inspect the queue");}});
 const schedulePeriodic=async()=>{const minute=Math.floor(Date.now()/60000);await enqueueJob("reminders.tick",{},{idempotencyKey:"reminders:"+minute});await enqueueJob("followups.tick",{},{idempotencyKey:"followups:"+Math.floor(minute/15)});};
 const tick=()=>{void schedulePeriodic().catch(()=>app.log.warn("Reminder scheduling failed"));};
 reminders=setInterval(tick,60000);reminders.unref();tick();
 void whatsapp.start(onWhatsAppEvent).catch(()=>app.log.warn("WhatsApp connection failed"));
});
return app;
}
export async function start(){
 const app=await buildApp();await app.listen({host:config.host,port:config.port});
 let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();};process.once("SIGTERM",stop);process.once("SIGINT",stop);return app;
}
