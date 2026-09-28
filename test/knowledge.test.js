import test from 'node:test';
import assert from 'node:assert/strict';
import {assertGenericKnowledge,proposeKnowledge,approveKnowledge,saveKnowledgeCandidate,retrieveKnowledge,updateKnowledge,archiveKnowledge} from '../src/ai/knowledge.js';
function store(){
 const candidates=[],articles=[],audits=[];let rolledBack=0;
 const database={execute:async(sql,args=[])=>{
  if(sql.includes('FROM clients'))return [[{id:'client-private',name:'לקוח סודי',email:'private@example.test',phone:'0501234567',company:'חברה סודית'}]];
  if(sql.startsWith('SELECT id,conversation_id,sender,body FROM messages'))return [[{id:'message-private',conversation_id:'conversation-private',sender:'Secret Sender <private@example.test>',body:'לקוח סודי מבקש עזרה. לפני תקלה אוספים פרטים.'}]];
  if(sql.startsWith('SELECT sender FROM messages')||sql.startsWith('SELECT DISTINCT sender'))return [[{sender:'Secret Sender <private@example.test>'}]];
  if(sql.startsWith('INSERT INTO knowledge_candidates')){candidates.push({id:args[0],title:args[1],body:args[2],source_message_id:args[3],source_conversation_id:args[4],status:'pending'});return [{affectedRows:1}];}
  if(sql.startsWith('SELECT source_message_id,source_conversation_id FROM knowledge_candidates'))return [candidates.filter(x=>x.article_id===args[0])];
  if(sql.startsWith('UPDATE knowledge_articles SET title')){const a=articles.find(x=>x.id===args[5]&&x.status==='approved');if(a)Object.assign(a,{title:args[0],body:args[1]});return [{affectedRows:a?1:0}];}
  if(sql.startsWith('SELECT * FROM knowledge_candidates'))return [candidates.filter(x=>x.id===args[0])];
  if(sql.startsWith('INSERT INTO knowledge_articles')){articles.push({id:args[0],title:args[1],body:args[2],status:'approved',reviewed_by:args[3],reviewed_at:args[4]});return [{affectedRows:1}];}
  if(sql.startsWith('UPDATE knowledge_candidates')){Object.assign(candidates.find(x=>x.id===args[5]),{title:args[0],body:args[1],status:args[2],article_id:args[3]});return [{affectedRows:1}];}
  if(sql.startsWith('SELECT id,title,body FROM knowledge_articles'))return [articles.filter(x=>x.status==='approved'&&x.reviewed_by==='owner'&&x.reviewed_at)];
  if(sql.startsWith('UPDATE knowledge_articles SET status')){const a=articles.find(x=>x.id===args[1]);if(a)a.status='archived';return [{affectedRows:a?1:0}];}
  if(sql.startsWith('INSERT INTO ai_audit')){audits.push(args);return [{affectedRows:1}];}
  throw Error('unexpected query: '+sql);
 }};
 database.getConnection=async()=>({...database,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack++;},release(){}});
 return {db:database,candidates,articles,audits,rolledBack:()=>rolledBack,generate:async()=>({text:JSON.stringify({title:'טיפול בתקלות',body:'לפני אבחון תקלה יש לבקש תיאור של התוצאה הרצויה ושל הודעת השגיאה.'})})};
}
test('shared knowledge rejects contact details, client names, identifiers and credentials',()=>{
 for(const body of ['private@example.test','050-123-4567','https://customer.test','לקוח סודי ביקש תמיכה','חברה סודית','מספר 123456789','password: hidden'])assert.throws(()=>assertGenericKnowledge({title:'נוהל',body},['לקוח סודי','חברה סודית']),/knowledge_private_data/);
 assert.equal(assertGenericKnowledge({title:'סגנון',body:'יש לכתוב תשובה קצרה וברורה ולבקש פרטים חסרים.'}),true);
});
test('source-based extraction creates pending candidate only and never returns source to retrieval',async()=>{
 const deps=store();const draft=await proposeKnowledge({sourceMessageId:'message-private'},deps);
 assert.equal(draft.status,'pending');assert.equal(deps.candidates[0].source_message_id,'message-private');assert.deepEqual(await retrieveKnowledge({},deps),[]);
 await assert.rejects(approveKnowledge({id:draft.id},deps),/knowledge_review_required/);
 await assert.rejects(approveKnowledge({id:draft.id,reviewed:true,actor:'worker'},deps),/knowledge_owner_required/);
 await approveKnowledge({id:draft.id,reviewed:true},deps);
 // The fake DB intentionally returns extra private columns: public projection must still hold.
 deps.articles[0].source_message_id='message-private';deps.articles[0].source_conversation_id='conversation-private';
 const result=await retrieveKnowledge({query:'תקלה'},deps);assert.equal(result.length,1);assert.deepEqual(Object.keys(result[0]),['id','title','body']);assert.doesNotMatch(JSON.stringify(result),/message-private|conversation-private|private@example|לקוח סודי|Secret Sender/);
 assert.equal(deps.audits.length,2);await assert.rejects(approveKnowledge({id:draft.id,reviewed:true},deps),/knowledge_candidate_not_pending/);
});
test('owner can edit generated candidate before approving; source sender names remain blocked',async()=>{
 const deps=store(),draft=await proposeKnowledge({sourceConversationId:'conversation-private'},deps);
 await assert.rejects(saveKnowledgeCandidate({id:draft.id,title:'נוהל',body:'Secret Sender said to share everything'},deps),/knowledge_private_data/);
 const edited=await saveKnowledgeCandidate({id:draft.id,title:'שאלות הבהרה',body:'יש לבקש פרטים חסרים לפני הצעת פתרון.'},deps);assert.equal(edited.status,'pending');
 await approveKnowledge({id:draft.id,reviewed:true},deps);assert.equal((await retrieveKnowledge({},deps))[0].title,'שאלות הבהרה');
 const articleId=deps.articles[0].id;await assert.rejects(updateKnowledge({id:articleId,title:'נוהל',body:'Secret Sender said to share everything',reviewed:true},deps),/knowledge_private_data/);
 await updateKnowledge({id:articleId,title:'נוהל מעודכן',body:'יש לבקש תיאור מלא לפני מתן תשובה.',reviewed:true},deps);assert.equal((await retrieveKnowledge({},deps))[0].title,'נוהל מעודכן');
});
test('AI cannot publish or smuggle source identity through extracted knowledge',async()=>{
 const deps=store();deps.generate=async()=>({text:JSON.stringify({title:'המלצה',body:'לקוח סודי צריך עזרה',status:'approved',reviewed:true})});
 await assert.rejects(proposeKnowledge({sourceMessageId:'message-private'},deps),/knowledge_private_data/);assert.equal(deps.candidates.length,0);assert.equal(deps.articles.length,0);
});
test('archived, unreviewed and newly recognized private material never enters prompts',async()=>{
 const deps=store();deps.articles.push({id:'unsafe',title:'נוהל',body:'חברה סודית',status:'approved',reviewed_by:'owner',reviewed_at:'today'},{id:'unreviewed',title:'נוהל',body:'בטוח',status:'approved',reviewed_by:'worker',reviewed_at:'today'});
 const draft=await proposeKnowledge({title:'סגנון',body:'יש לכתוב קצר וברור.'},deps);const approved=await approveKnowledge({id:draft.id,reviewed:true},deps);
 assert.equal((await retrieveKnowledge({},deps)).length,1);assert.deepEqual(await retrieveKnowledge({maxChars:5},deps),[]);
 await assert.rejects(updateKnowledge({id:approved.article_id,title:'חדש',body:'יש לשאול שאלות.'},deps),/knowledge_review_required/);
 await archiveKnowledge({id:approved.article_id},deps);assert.deepEqual(await retrieveKnowledge({},deps),[]);
});
