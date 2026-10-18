import {randomUUID} from 'node:crypto';
const cursor=v=>{if(typeof v!=='string'||!v||v.length>8192)throw Error('people_cursor_missing');return v;};
const fields='metadata,names,emailAddresses,phoneNumbers,organizations';
function personRecord(p){
 if(typeof p?.resourceName!=='string'||!/^people\/[^/]+$/.test(p.resourceName))throw Error('people_id_missing');
 if(p.metadata?.deleted===true)return {id:p.resourceName,available:false};
 // Provider values are evidence, not verified CRM identities. Never auto-merge.
 return {id:p.resourceName,available:true,etag:String(p.etag||''),name:p.names?.find(n=>n.metadata?.primary)?.displayName||p.names?.[0]?.displayName||'',
  emails:(p.emailAddresses||[]).map(e=>({value:String(e.value||''),verified:e.metadata?.verified===true})),
  phones:(p.phoneNumbers||[]).map(p=>({value:String(p.value||''),canonical:String(p.canonicalForm||''),verified:p.metadata?.verified===true})),
  organizations:(p.organizations||[]).map(o=>({name:String(o.name||''),title:String(o.title||'')}))};
}
export async function peopleSyncPage(people,state=null){
 const current=state||{version:1,mode:'full',anchor:'',page:'',generation:randomUUID()};
 if(current.version!==1||!['full','delta'].includes(current.mode)||!current.generation)throw Error('invalid_people_sync_state');
 if(current.mode==='delta')cursor(current.anchor);
 let data;
 try{
  data=(await people.people.connections.list({resourceName:'people/me',pageSize:100,personFields:fields,
   sources:['READ_SOURCE_TYPE_CONTACT'],requestSyncToken:true,
   ...(current.anchor?{syncToken:current.anchor}:{}),...(current.page?{pageToken:current.page}:{})})).data;
 }catch(error){
  const expired=(error?.response?.data?.error?.details||[]).some(d=>d.reason==='EXPIRED_SYNC_TOKEN');
  if(!expired||!state)throw error;
  return {...await peopleSyncPage(people,null),recovered:true};
 }
 if(data.nextPageToken){cursor(data.nextPageToken);if(data.nextPageToken===current.page)throw Error('people_cursor_not_advancing');}
 else cursor(data.nextSyncToken);
 const items=(data.connections||[]).map(personRecord);
 return {items,nextState:{...current,mode:data.nextPageToken?current.mode:'delta',
  page:data.nextPageToken||'',anchor:data.nextPageToken?current.anchor:data.nextSyncToken},recovered:false};
}
