import {decideInbox} from './inbox-decision.js';
// Compatibility helper; all new reads use the paginated workbench service.
export function selectWaitingCustomerRows(candidates,limit=10){
 const seen=new Set();return (Array.isArray(candidates)?candidates:[]).filter(row=>{
  if(!row||typeof row!=='object')return false;
  const decision=decideInbox(row);if(!['needs_reply','review'].includes(decision.handling_state))return false;
  const key=row.id||row.message_id;if(key&&seen.has(key))return false;if(key)seen.add(key);return true;
 }).slice(0,Math.max(1,Math.min(50,Number(limit)||10)));
}
