// In-memory health for this server process. Restart means unknown, never success.
let last=null;
export function recordInboxSync(report){last={checked_at:report.checked_at||new Date().toISOString(),errors:Number(report.errors)||0,ok:report.ok!==false};}
export function inboxSyncState(){return last?{...last,state:!last.ok||last.errors?'failed':Date.now()-Date.parse(last.checked_at)>15*60*1000?'stale':'verified'}:{state:'unknown',checked_at:null};}
