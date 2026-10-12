import {recordInboxSync} from './inbox-sync-state.js';
import {config} from "./config.js";
import {syncIssue,issueSummary} from "./sync-diagnostics.js";
export class SyncScheduler{
 constructor({hub,logger,connectors,workspace}={}){this.hub=hub;this.logger=logger;this.timer=null;this.running=false;this.connectors=connectors||null;this.workspace=workspace||null;this.lastReport=null}
 async runOnce(){
  if(this.running)return {ok:true,skipped:"already_running",...(this.lastReport||{})};this.running=true;let imported=0,errors=0,duplicates=0;const issues=[];
  try{
   if(!this.connectors)this.connectors=new (await import("./clients/connectors.js")).ConnectorsClient();
    if(!this.workspace)this.workspace=new (await import("./workspace-service.js")).WorkspaceService();
    const {events=[]}=await this.connectors.sync();
   for(const event of events){
    if(event.type==="sync.error"){errors++;issues.push(event);this.logger?.warn?.({source:event.source,stage:event.stage,error:event.error},"Connector sync error");continue}
    try{if(event.type==="message"){const r=await this.workspace.call("message.ingest",event);if(r?.inserted)imported++;else duplicates++}else await this.workspace.call("activity.add",{event:"external."+String(event.type||"event"),entity_type:"integration",entity_id:String(event.account_id||""),title:String(event.title||event.type||"Event"),metadata:event});this.hub?.publish?.("external.event",{type:event.type,source:event.source,account_id:event.account_id})}
    catch(err){errors++;const issue=syncIssue(event.source||"workspace","ingest",err,event.account?.identifier||event.account_id);issues.push(issue);this.logger?.warn?.({source:issue.source,error:issue.error,stage:issue.stage},"Connector ingestion failed")}
   }
   const result={ok:true,events:events.length,imported,duplicates,errors,issues:issueSummary(issues),checked_at:new Date().toISOString()};this.lastReport=result;recordInboxSync(result);return result;
  }catch(error){recordInboxSync({ok:false,errors:1});throw error;}finally{this.running=false}
 }
 start(){if(!config.syncEnabled)return;const run=()=>this.runOnce().catch(err=>this.logger.error({err},"Connector sync failed"));this.timer=setInterval(run,config.syncIntervalSeconds*1000);this.timer.unref?.();this.initial=setTimeout(run,1500);this.initial.unref?.()}
 stop(){if(this.timer)clearInterval(this.timer);clearTimeout(this.initial)}
}

