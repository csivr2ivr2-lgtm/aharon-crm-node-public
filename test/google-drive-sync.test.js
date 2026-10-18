import test from 'node:test';
import assert from 'node:assert/strict';
import {driveSyncPage} from '../src/google-drive-sync.js';
import {syncProviderMirror,listProviderMirror} from '../src/provider-mirror.js';
test('Drive anchors changes before full crawl and keeps version identifiers as strings',async()=>{
 const calls=[];
 const api={changes:{getStartPageToken:async()=>{calls.push('anchor');return {data:{startPageToken:'100'}};}},files:{list:async p=>{calls.push(p);return {data:{files:[{id:'f',version:'900719925474099399',capabilities:{canEdit:true}}],nextPageToken:p.pageToken?undefined:'next'}};}}};
 const first=await driveSyncPage(api),last=await driveSyncPage(api,first.nextState);
 assert.equal(calls[0],'anchor');assert.equal(last.nextState.anchor,'100');assert.equal(last.nextState.mode,'delta');
 assert.equal(first.items[0].version,'900719925474099399');
 assert.equal(calls[2].pageToken,'next');
});
test('Drive changes retain anchor across pages and represent permission loss as unavailable',async()=>{
 const calls=[],api={changes:{list:async p=>{calls.push(p);return {data:{changes:[{fileId:'gone',removed:true},{fileId:'f',file:{id:'f',name:'Updated'}}],...(p.pageToken==='100'?{nextPageToken:'p2'}:{newStartPageToken:'200'})}};}}};
 const state={version:1,mode:'delta',anchor:'100',page:'',generation:'g'};
 const first=await driveSyncPage(api,state),last=await driveSyncPage(api,first.nextState);
 assert.equal(first.nextState.anchor,'100');assert.equal(calls[1].pageToken,'p2');
 assert.equal(last.nextState.anchor,'200');assert.deepEqual(first.items[0],{id:'gone',available:false});
});
test('Drive malformed payload and transient failure cannot yield a successful checkpoint',async()=>{
 const state={version:1,mode:'delta',anchor:'100',page:'',generation:'g'};
 await assert.rejects(driveSyncPage({changes:{list:async()=>({data:{changes:[{fileId:'a',file:{id:'b'}}],newStartPageToken:'200'}})}},state),/drive_change_id_mismatch/);
 await assert.rejects(driveSyncPage({changes:{list:async()=>{throw Error('rate_limited');}}},state),/rate_limited/);
});
test('provider mirror rejects concurrent checkpoint writes and never commits failed pages',async()=>{
 const calls=[],db={execute:async()=>[[]],getConnection:async()=>({beginTransaction:async()=>{},execute:async sql=>sql.startsWith('SELECT revision')?[[{revision:1}]]:[[]],commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>{}})};
 await assert.rejects(syncProviderMirror({provider:'google.drive',account_id:'a',db,fetchPage:async()=>({items:[],nextState:{generation:'g'}})}),/provider_checkpoint_conflict/);
 assert.deepEqual(calls,['rollback']);
});
test('provider mirror retrieval scopes both account and provider before search',async()=>{
 const scopes=[],db={execute:async(sql,args)=>{scopes.push(args);return [[]];}};
 await listProviderMirror({provider:'google.drive',account_id:'a',db});
 await listProviderMirror({provider:'google.drive',account_id:'b',db});
 await listProviderMirror({provider:'google.people',account_id:'a',db});
 assert.equal(new Set(scopes.map(x=>x[0])).size,3);
});

test('Drive incomplete full searches fail closed rather than skipping unseen files',async()=>{
 const api={changes:{getStartPageToken:async()=>({data:{startPageToken:'100'}})},files:{list:async()=>({data:{files:[],incompleteSearch:true}})}};
 await assert.rejects(driveSyncPage(api),/drive_incomplete_search/);
});
test('Drive expired cursor restarts with a fresh generation without deleting cached records',async()=>{
 const api={changes:{getStartPageToken:async()=>({data:{startPageToken:'fresh'}}),list:async()=>{throw {code:410};}},files:{list:async()=>({data:{files:[]}})}};
 const result=await driveSyncPage(api,{version:1,mode:'delta',anchor:'old',page:'',generation:'old'});
 assert.equal(result.recovered,true);assert.notEqual(result.nextState.generation,'old');assert.equal(result.nextState.anchor,'fresh');
});
