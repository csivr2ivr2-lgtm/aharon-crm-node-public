import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {z} from "zod";
import {config} from "./config.js";
import {WorkspaceService} from "./workspace-service.js";
import {ConnectorsClient} from "./clients/connectors.js";
import {createDraft,sendConversationReply} from "./inbox.js";
import {bearerToken,equalToken} from "./http.js";
const result=value=>({content:[{type:"text",text:JSON.stringify(value)}],...(value?.ok===false?{isError:true}:{})});
export function createMcpServer({workspace=new WorkspaceService(),connectors=new ConnectorsClient(),settings=config,draft=createDraft,send=sendConversationReply}={}){
 const server=new McpServer({name:"aharon-crm",version:"2.1.0"});
 const register=(name,description,schema,fn)=>server.registerTool(name,{description,inputSchema:schema},async args=>result(await fn(args)));
 const limit=z.number().int().min(1).max(200).optional(),id=z.string().min(1);
 register("workspace_status","CRM status and entity counts",{},()=>workspace.call("status"));
 register("search_crm","Search internal CRM records",{q:z.string().min(1),limit},p=>workspace.call("search",p));
 for(const [plural,entity] of [["projects","project"],["clients","client"],["systems","system"],["tasks","task"],["conversations","conversation"]]){
  register("list_"+plural,"List CRM "+plural,{limit,q:z.string().optional(),status:z.string().optional(),project_id:z.string().optional(),client_id:z.string().optional(),channel:z.string().optional(),unread_only:z.boolean().optional()},p=>workspace.call(entity+".list",p));
  register("get_"+entity,"Read a CRM "+entity,entity==="system"?{did:id}:{id},p=>workspace.call(entity+".get",p));
 }
 register("search_workspace","Compatibility alias for internal CRM search",{q:z.string().min(1),limit},p=>workspace.call("search",p));
 register("list_integrations","Compatibility alias for connector status",{},()=>connectors.status());
 register("google_gmail_recent","Read Gmail messages and complete selected threads",{account_id:z.string().optional(),max_results:limit,q:z.string().optional()},p=>connectors.post("/v1/google/gmail/recent",p));
 register("recent_activity","Recent CRM activity",{limit},p=>workspace.call("activity.list",p));
 register("list_connectors","Connector states (no credentials)",{},()=>connectors.status());
 register("create_reply_draft","Create an unsent reply draft; never sends messages",{conversation_id:id,instruction:z.string().max(4000).optional()},p=>draft({conversationId:p.conversation_id,instruction:p.instruction}));
 register("google_calendar_upcoming","Read upcoming calendar events",{account_id:z.string().optional(),max_results:limit},p=>connectors.post("/v1/google/calendar/upcoming",p));
 register("google_drive_search","Search Drive metadata",{account_id:z.string().optional(),q:id,max_results:limit},p=>connectors.post("/v1/google/drive/search",p));
 if(settings.mcpAllowWrites){
  const task={title:id,notes:z.string().optional(),priority:z.enum(["low","normal","high","urgent"]).optional(),automation_mode:z.enum(["manual","ai","ai_draft"]).optional(),project_ids:z.array(id).optional(),due_date:z.string().optional()};
  register("create_task","Create a CRM task",task,p=>workspace.call("task.create",p));
  register("update_task","Update specified task fields",{...task,title:task.title.optional(),id,status:z.enum(["open","in_progress","done","cancelled"]).optional()},p=>workspace.call("task.update",p));
  const client={name:id,email:z.string().optional(),phone:z.string().optional(),company:z.string().optional(),notes:z.string().optional(),project_ids:z.array(id).optional()};
  register("create_client","Create a CRM client",client,p=>workspace.call("client.create",p));
  register("update_client","Update specified client fields",{...client,name:client.name.optional(),id},p=>workspace.call("client.update",p));
 }
 if(settings.mcpAllowSensitiveWrites){
  for(const [name,channel] of [["send_email","email"],["send_whatsapp","whatsapp"]])register(name,"Send an explicitly approved reply to an existing conversation",{conversation_id:id,body:id,request_id:z.string().min(16).max(64),confirm:z.literal(true)},async p=>{
   const c=await workspace.call("conversation.get",{id:p.conversation_id});if(!c.ok||c.item.channel!==channel)return {ok:false,error:"conversation_channel_mismatch"};
   return send({conversationId:p.conversation_id,body:p.body,requestId:p.request_id});
  });
 }
 return server;
}
export async function handleMcp(request,reply){
 if(!equalToken(bearerToken(request),config.mcpApiToken))return reply.code(401).send({error:"unauthorized"});
 if(request.method!=="POST")return reply.code(405).header("Allow","POST").send({error:"method_not_allowed"});
 const server=createMcpServer(),transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
 await server.connect(transport);reply.hijack();
 reply.raw.on("close",()=>{void transport.close().catch(()=>{});void server.close().catch(()=>{});});
 try{await transport.handleRequest(request.raw,reply.raw,request.body);}catch{if(!reply.raw.writableEnded)reply.raw.end();}
}
