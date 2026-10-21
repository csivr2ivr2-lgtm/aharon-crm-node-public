// Local CRM search only. A match is never an identity association.
const specs=[
 ['client','clients','name',"CONCAT_WS(' ',name,phone,email,company)",'1=1'],
 ['lead','sales_leads','title',"CONCAT_WS(' ',title,source,next_action)",'1=1'],
 ['conversation','conversations','title',"CONCAT_WS(' ',title,external_id)",'1=1'],
 ['task','tasks','title',"CONCAT_WS(' ',title,notes)",'1=1'],
 ['project','projects','name',"CONCAT_WS(' ',name,description,next_step)",'deleted_at IS NULL AND archived_at IS NULL'],
 ['file','files','name',"CONCAT_WS(' ',name,notes)",'deleted_at IS NULL AND archived_at IS NULL']
];
export async function globalSearch(db,{q='',page=0}={}){
 if(typeof q!=='string'||q.trim().length<2||q.length>120)throw Error('search_requires_2_to_120_characters');
 const offset=Number(page);if(!Number.isInteger(offset)||offset<0||offset>100)throw Error('invalid_search_page');
 const query=q.trim(),digits=query.replace(/[^0-9]/g,'');
 const groups=await Promise.all(specs.map(async([type,table,title,body,visibility])=>{
  const phone=type==='client'&&digits.length>=7&&/^[+0-9 ()-]+$/.test(query);
  const normalized="REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+','')";
  const match=phone?'(LOCATE(?, '+body+')>0 OR LOCATE(?, '+normalized+')>0)':'LOCATE(?, '+body+')>0';
  const values=phone?[query,digits,query]:[query,query];
  const [rows]=await db.execute('SELECT id,'+title+' AS title FROM '+table+' WHERE '+visibility+' AND '+match+' ORDER BY ('+title+'=?) DESC,id LIMIT 11 OFFSET '+(offset*10),values);
  return {type,items:rows.slice(0,10).map(x=>({id:String(x.id),title:String(x.title||'')})),has_more:rows.length>10};
 }));
 return {ok:true,query,page:offset,groups,has_more:groups.some(x=>x.has_more),identity_match:false};
}
