import test from 'node:test';
import assert from 'node:assert/strict';
import {globalSearch} from '../src/global-search.js';
test('global search bounds queries and pages before database access',async()=>{
 for(const args of [{q:'a'},{q:'ok',page:-1},{q:'ok',page:'1 OR 1=1'},{q:'x'.repeat(121)}])await assert.rejects(globalSearch(null,args));
});
test('global search parameterizes terms, preserves types and never matches identities',async()=>{
 const calls=[];const db={execute:async(sql,args)=>{calls.push({sql,args});return [Array.from({length:11},(_,i)=>({id:'id'+i,title:'Result'}))];}};
 const result=await globalSearch(db,{q:"test' UNION",page:2});
 assert.equal(calls.length,6);assert.ok(calls.every(x=>!x.sql.includes("test'")&&x.sql.includes('LIMIT 11 OFFSET 20')));
 assert.equal(result.groups.length,6);assert.equal(result.groups[0].items.length,10);assert.equal(result.has_more,true);assert.equal(result.identity_match,false);
 assert.ok(calls.find(x=>x.sql.includes('FROM files')).sql.includes('deleted_at IS NULL'));
});
test('phone search removes visual separators without automatic linking',async()=>{
 const calls=[];await globalSearch({execute:async(sql,args)=>{calls.push({sql,args});return [[]];}},{q:'050-123-4567'});
 assert.deepEqual(calls[0].args,['050-123-4567','0501234567','050-123-4567']);
});
