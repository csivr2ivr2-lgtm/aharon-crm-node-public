import test from 'node:test';
import assert from 'node:assert/strict';
import {decideInbox} from '../src/ai/inbox-decision.js';
const base={direction:'in',body:'אני רוצה הצעת מחיר ל-10 מספרים',manual_status:'done',workflow_updated_at:'2026-10-12T09:00:00.000Z'};
test('new business inquiry reopens display without mutating historical done',()=>{
 const result=decideInbox({...base,waiting_since:'2026-10-12T10:00:00.000Z'});
 assert.equal(result.handling_state,'needs_reply');
 assert.match(result.reason,/פנייה עסקית חדשה/);
 assert.equal(base.manual_status,'done');
});
test('older inbound inquiry remains done',()=>{
 assert.equal(decideInbox({...base,waiting_since:'2026-10-12T08:00:00.000Z'}).handling_state,'done');
});
test('later system notification does not reopen manually done conversation',()=>{
 assert.equal(decideInbox({...base,body:'GitHub notification',classification:'system',waiting_since:'2026-10-12T10:00:00.000Z'}).handling_state,'done');
});
test('outbound reply after manual done does not reopen',()=>{
 assert.equal(decideInbox({...base,direction:'out',waiting_since:'2026-10-12T10:00:00.000Z'}).handling_state,'done');
});
