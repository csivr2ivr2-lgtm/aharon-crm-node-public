import {nonCustomerSignal} from './inbox-signals.js';

// Read-time protection catches historical newsletters never processed by the worker.
// Manual feedback is authoritative; do not permanently mutate message classifications here.
export function selectWaitingCustomerRows(candidates,limit=10){
 const count=Math.max(1,Math.min(50,Number(limit)||10));
 return (Array.isArray(candidates)?candidates:[]).filter(row=>{
  if(!row||typeof row!=='object')return false;
  if(/סיווג ידני/.test(String(row.classification_reason||'')))return true;
  if(/(?:^|[<@\s])(?:no-?reply|donotreply|mailer-daemon)(?:@|[>\s]|$)/i.test(String(row.sender||'')))return false;
  return !nonCustomerSignal(row);
 }).slice(0,count);
}
