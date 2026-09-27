import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import {config,assertConfig} from "./config.js";
import {equalToken,bearerToken} from "./http.js";
import {migrate,db} from "./db.js";
import {readFile,mkdir,unlink} from "node:fs/promises";
import {createWriteStream,createReadStream} from "node:fs";
import {Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {resolve,basename} from "node:path";
import {randomBytes} from "node:crypto";
import {aiStatus} from "./ai/local-ai.js";
import {migrateExtras} from "./extra-schema.js";
import {WorkspaceService} from "./workspace-service.js";
import {ConnectorsClient,googleConnector,whatsapp} from "./clients/connectors.js";
import {RealtimeHub} from "./realtime.js";
import {SyncScheduler} from "./scheduler.js";
import {SmartTaskWorker} from "./worker.js";
import {createDraft,listDrafts,sendConversationReply} from "./inbox.js";
import {handleMcp} from "./mcp.js";
import {appHtml,loginHtml} from "./ui.js";

export async function buildApp({initializeDatabase=true,startBackground=true}={}){
assertConfig();if(initializeDatabase){await migrate();await migrateExtras();}
const app=Fastify({logger:config.env==="test"?false:{serializers:{req:req=>({method:req.method,url:String(req.url||"").split("?")[0],remoteAddress:req.ip})},level:config.env==="production"?"info":"debug",redact:["req.headers.authorization","*.password","*.token","*.secret","*.api_key","*.access_token","*.refresh_token"]},bodyLimit:3*1024*1024});
await app.register(cookie,{secret:config.sessionSecret,hook:"onRequest"});await app.register(formbody);await app.register(multipart,{limits:{fileSize:25*1024*1024}});
const workspace=new WorkspaceService(),connectors=new ConnectorsClient(),hub=new RealtimeHub(app.server),scheduler=new SyncScheduler({hub,logger:app.log}),worker=new SmartTaskWorker({hub,logger:app.log});

function logged(req){const raw=req.cookies?.crm_session;if(!raw)return false;const u=req.unsignCookie(raw);return u.valid&&Number(u.value)>Date.now()}
function uiAuth(req,reply){if(logged(req))return true;reply.code(401).type("application/json").send({ok:false,error:"login_required"});return false}
function apiAuth(req,reply){if(equalToken(bearerToken(req),config.coreApiToken))return true;return uiAuth(req,reply)}
const cookieOpts={path:"/",httpOnly:true,sameSite:"strict",secure:config.env==="production",maxAge:60*60*24*14};

app.get("/health",async()=>({ok:true,service:"aharon-crm-node"}));
app.get("/assets/app.js",async(_req,reply)=>reply.type("text/javascript").send(await readFile(new URL("./browser.js",import.meta.url),"utf8")));
app.addHook("onRequest",async(req,reply)=>{
 reply.header("X-Content-Type-Options","nosniff").header("X-Frame-Options","DENY").header("Referrer-Policy","same-origin").header("Cache-Control","no-store");
 if(!["GET","HEAD","OPTIONS"].includes(req.method)&&req.headers.origin){
  const expected=config.publicBaseUrl?new URL(config.publicBaseUrl).origin:req.protocol+"://"+req.headers.host;
  if(req.headers.origin!==expected)return reply.code(403).send({ok:false,error:"origin_rejected"});
 }
});
const attempts=new Map();
app.addHook("onRequest",async(req,reply)=>{
 if(req.url!=="/login"||req.method!=="POST")return;
 const key=req.ip,t=Date.now();for(const [ip,a] of attempts)if(a.until<t)attempts.delete(ip);
 const a=attempts.get(key)||{count:0,until:t+60000};a.count++;attempts.set(key,a);
 if(attempts.size>10000)attempts.delete(attempts.keys().next().value);
 if(a.count>10)return reply.code(429).send({ok:false,error:"too_many_login_attempts"});
});
app.setErrorHandler((error,req,reply)=>{app.log.warn({errorName:error.name,code:error.code},"Request failed");reply.code(error.statusCode>=400&&error.statusCode<500?error.statusCode:400).send({ok:false,error:/^[a-z_]{3,100}$/.test(error.message)?error.message:"request_failed"});});
app.get("/",async(req,reply)=>reply.type("text/html; charset=utf-8").send(logged(req)?appHtml():loginHtml()));
app.post("/login",async(req,reply)=>{const p=String(req.body?.password||"");if(!equalToken(p,config.dashboardPassword))return reply.code(401).type("text/html").send(loginHtml());reply.setCookie("crm_session",String(Date.now()+14*86400000),{...cookieOpts,signed:true});return reply.redirect("/")});
app.post("/logout",async(req,reply)=>{reply.clearCookie("crm_session",{path:"/"});return reply.redirect("/")});

app.get("/api/status",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("status")});
app.get("/api/projects",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("project.list",{limit:100})});
app.post("/api/projects",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("project.create",req.body||{})});
app.get("/api/clients",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("client.list",{limit:100})});
app.post("/api/clients",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("client.create",req.body||{})});
app.get("/api/tasks",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("task.list",{limit:100})});
app.post("/api/tasks",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("task.create",{status:"open",priority:"normal",worker_state:"idle",...(req.body||{})})});
app.get("/api/inbox",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("conversation.list",{limit:100})});
app.get("/api/conversations/:id",async(req,reply)=>{if(!uiAuth(req,reply))return;const r=await workspace.call("conversation.get",{id:req.params.id});if(!r.ok)return reply.code(404).send(r);return r});
app.post("/api/conversations/:id/read",async(req,reply)=>{if(!uiAuth(req,reply))return;return workspace.call("conversation.read",{id:req.params.id})});
app.post("/api/conversations/:id/draft",async(req,reply)=>{if(!uiAuth(req,reply))return;return createDraft({conversationId:req.params.id,instruction:String(req.body?.instruction||""),tone:String(req.body?.tone||"")})});
app.get("/api/conversations/:id/drafts",async(req,reply)=>{if(!uiAuth(req,reply))return;return {ok:true,items:await listDrafts(req.params.id)}});
app.post("/api/conversations/:id/send",async(req,reply)=>{if(!uiAuth(req,reply))return;const body=String(req.body?.body||"").trim();if(!body)return reply.code(422).send({ok:false,error:"body_required"});const sent=await sendConversationReply({conversationId:req.params.id,body,draftId:String(req.body?.draft_id||""),requestId:String(req.body?.request_id||"")});hub.publish("message.sent",{conversation_id:req.params.id});return sent;});
app.get("/api/connectors",async(req,reply)=>{if(!uiAuth(req,reply))return;return connectors.status()});
app.get("/api/whatsapp/status",async(req,reply)=>{if(!uiAuth(req,reply))return;return {ok:true,...whatsapp.status()}});
app.post("/api/sync",async(req,reply)=>{if(!uiAuth(req,reply))return;return scheduler.runOnce()});
app.post("/api/google/auth-url",async(req,reply)=>{if(!uiAuth(req,reply))return;if(!googleConnector.configured())return reply.code(503).send({ok:false,error:"google_not_configured"});const url=googleConnector.authUrl(String(req.body?.account_hint||""));reply.setCookie("oauth_state",new URL(url).searchParams.get("state"),{...cookieOpts,signed:true,sameSite:"lax",maxAge:600});return {ok:true,url}});
app.get("/oauth/google/callback",async(req,reply)=>{
 const state=String(req.query?.state||""),saved=req.unsignCookie(req.cookies?.oauth_state||"");
 if(!saved.valid||!equalToken(saved.value,state))return reply.code(400).send({ok:false,error:"invalid_oauth_state"});
 reply.clearCookie("oauth_state",{path:"/"});await googleConnector.callback(String(req.query?.code||""),state);return reply.redirect("/#connectors");
});
app.get("/api/files",async(req,reply)=>{if(!uiAuth(req,reply))return;const [items]=await db.query("SELECT id,name,mime,size_bytes,project_id,client_id,notes,created_at FROM files ORDER BY created_at DESC LIMIT 200");return {ok:true,items};});
app.post("/api/files",async(req,reply)=>{
 if(!uiAuth(req,reply))return;const part=await req.file();if(!part)throw Error("file_required");
 const id="file_"+randomBytes(16).toString("hex"),name=basename(part.filename).replace(/[\r\n\0]/g,"").slice(0,500)||"attachment";
 await mkdir(config.uploadDir,{recursive:true,mode:0o700});const path=resolve(config.uploadDir,id);
 try{
  let size=0;await pipeline(part.file,new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(null,chunk);}}),createWriteStream(path,{flags:"wx",mode:0o600}));if(part.file.truncated)throw Error("file_too_large");
  await db.execute("INSERT INTO files(id,name,mime,size_bytes,storage_name,created_at) VALUES(?,?,?,?,?,?)",[id,name,part.mimetype,size,id,new Date().toISOString()]);return {ok:true,id};
 }catch(error){await unlink(path).catch(()=>{});throw error;}
});
app.get("/api/files/:id/download",async(req,reply)=>{
 if(!uiAuth(req,reply))return;const [rows]=await db.execute("SELECT * FROM files WHERE id=?",[req.params.id]);const file=rows[0];
 if(!file||!/^file_[a-f0-9]{32}$/.test(file.storage_name))return reply.code(404).send({ok:false,error:"file_not_found"});
 reply.type("application/octet-stream").header("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(file.name));return reply.send(createReadStream(resolve(config.uploadDir,file.storage_name)));
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

app.get("/v1/status",async(req,reply)=>{if(!apiAuth(req,reply))return;return {ok:true,workspace:await workspace.call("status"),connectors:await connectors.status()}});
app.post("/v1/workspace/:op",async(req,reply)=>{if(!apiAuth(req,reply))return;try{return await workspace.call(req.params.op,req.body||{})}catch(e){return reply.code(400).send({ok:false,error:e.message})}});
app.post("/v1/sync",async(req,reply)=>{if(!apiAuth(req,reply))return;return scheduler.runOnce()});
app.all("/mcp",handleMcp);

async function onWhatsAppEvent(event){const r=await workspace.call("message.ingest",event);if(r.inserted)hub.publish("message.new",{conversation_id:r.conversation_id,channel:"whatsapp"});}
app.addHook("onClose",async()=>{scheduler.stop();worker.stop();whatsapp.stop();hub.close();if(initializeDatabase)await db.end();});
if(startBackground)app.addHook("onListen",async()=>{scheduler.start();worker.start();void whatsapp.start(onWhatsAppEvent).catch(()=>app.log.warn("WhatsApp connection failed"));});
return app;
}
export async function start(){
 const app=await buildApp();await app.listen({host:config.host,port:config.port});
 let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();};process.once("SIGTERM",stop);process.once("SIGINT",stop);return app;
}
