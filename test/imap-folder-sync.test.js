import test from 'node:test';
import assert from 'node:assert/strict';
import {HostingerMailConnector} from '../src/connectors/hostinger-mail.js';
import {SyncScheduler} from '../src/scheduler.js';
function fixture(){
 let saved=null;const writes=[];
 const c=new HostingerMailConnector({vault:{get:async()=>saved,set:async(k,v)=>{writes.push(k);saved=v;}}});
 c.configured=()=>true;c.settings=()=>({user:'owner@example.test'});
 const event={type:'message',source:'hostinger.imap',account_id:'owner@example.test',external_id:'m'};
 c.historyPage=async()=>({messages:[event],next_cursor:'page2',done:false});
 return {c,writes,get:()=>saved};
}
test('folder synchronization checkpoints only after successful persistence acknowledgements',async()=>{
 const f=fixture();
 const scheduler=new SyncScheduler({connectors:{sync:async()=>({events:await f.c.folderSyncEvents()})},workspace:{call:async()=>{throw Error('storage failed');}}});
 const failed=await scheduler.runOnce();assert.equal(failed.errors,1);assert.equal(f.get(),null);
 scheduler.workspace={call:async()=>({inserted:false})};
 const ok=await scheduler.runOnce();assert.equal(ok.duplicates,1);assert.equal(ok.errors,0);
 assert.equal(f.get().cursor,'page2');assert.deepEqual(f.writes,['imap-folder-sync:owner@example.test']);
});
test('a complete pass restarts read-only reconciliation and preserves a completion timestamp',async()=>{
 const f=fixture();f.c.historyPage=async()=>({messages:[],done:true,next_cursor:''});
 const events=await f.c.folderSyncEvents();assert.equal(f.get(),null);await events.at(-1).commit();
 assert.equal(f.get().cursor,'');assert.ok(f.get().completed_at);assert.equal(f.get().revision,1);
});
test('overlapping folder scans conflict instead of overwriting each other',async()=>{
 const f=fixture(),a=await f.c.folderSyncEvents(),b=await f.c.folderSyncEvents();
 const result=await Promise.allSettled([a.at(-1).commit(),b.at(-1).commit()]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.match(result.find(r=>r.status==='rejected').reason.message,/imap_checkpoint_conflict/);
});
test('account change and non-advancing cursor prevent checkpoint persistence',async()=>{
 const f=fixture(),events=await f.c.folderSyncEvents();f.c.settings=()=>({user:'other@example.test'});
 await assert.rejects(events.at(-1).commit(),/hostinger_history_account_unavailable/);assert.equal(f.get(),null);
 const g=fixture();g.c.historyPage=async()=>({messages:[],done:false,next_cursor:''});
 await assert.rejects(g.c.folderSyncEvents(),/imap_cursor_not_advancing/);
});
