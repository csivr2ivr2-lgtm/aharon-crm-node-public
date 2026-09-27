/* Browser-only UI. Record data is escaped and never inserted into executable attributes. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={files:'קבצים',home:'ראשי',inbox:'תיבת הודעות',clients:'לקוחות',projects:'פרויקטים',tasks:'משימות',systems:'מערכות',accounts:'חשבונות',connectors:'חיבורים',ai:'בינה מלאכותית',settings:'הגדרות'};
const entityNames={clients:'client',projects:'project',tasks:'task',systems:'system',accounts:'account'};
let view='home',records=[],conversation='',requestId='',editing=null;
const button=(action,label,id='')=>'<button type="button" class="btn" data-action="'+action+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';
const channel=c=>c.channel==='whatsapp'?'WhatsApp':String(c.integration_key||'').startsWith('hostinger:')?'Hostinger Email':'Gmail';
async function api(url,opt={}){
 const r=await fetch(url,{credentials:'same-origin',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
 const d=await r.json().catch(()=>({}));if(r.status===401){location.href='/';throw Error('נדרשת כניסה מחדש');}
 if(!r.ok||d.ok===false)throw Error(d.error||'הפעולה נכשלה');return d;
}
const post=(url,data={})=>api(url,{method:'POST',body:JSON.stringify(data)});
async function render(next){
 view=labels[next]?next:'home';conversation='';$('#title').textContent=labels[view];$('#error').textContent='';
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 $('#content').innerHTML='<div class="panel">טוען…</div>';
 if(view==='home'){
  const d=await api('/api/status');$('#content').innerHTML='<div class="grid">'+Object.entries(d.counts||{}).map(([k,n])=>'<div class="card"><div class="metric">'+Number(n)+'</div>'+esc(labels[k]||({conversations:'שיחות',messages:'הודעות'})[k]||k)+'</div>').join('')+'</div><div class="panel">'+button('sync','סנכרון הודעות')+'</div>';return;
 }
 if(view==='inbox'){
  const d=await api('/api/inbox');$('#content').innerHTML='<div class="panel">'+button('sync','סנכרון')+(d.items.length?d.items.map(c=>'<div class="row"><div><b>'+esc(c.title)+'</b><div class="muted">'+esc(channel(c))+' · '+esc(c.last_message_at)+'</div></div><div><span class="tag">'+Number(c.unread_count)+'</span> '+button('conversation','פתיחה',c.id)+'</div></div>').join(''):'<p class="empty">אין הודעות עדיין. יש לחבר חשבון ולסנכרן.</p>')+'</div>';return;
 }
 if(entityNames[view]){
  const d=await api('/api/'+view);records=d.items;$('#content').innerHTML='<div class="panel">'+button('create','הוספה')+'</div><div class="panel">'+(records.map(x=>'<div class="row"><div><b>'+esc(x.name||x.title||x.did||x.label)+'</b><div class="muted">'+esc([x.status,x.email,x.phone,x.identifier,x.automation_mode,x.worker_state].filter(Boolean).join(' · '))+'</div><div class="note">'+esc(x.description||x.notes||'')+'</div>'+(x.next_step?'<p>הצעד הבא: '+esc(x.next_step)+'</p>':'')+(x.worker_result?'<p class="draft note">'+esc(x.worker_result)+'</p>':'')+'</div><div>'+button('edit','עריכה',x.id||x.did)+button('notes','הערות',x.id||x.did)+'</div></div>').join('')||'<p class="empty">אין רשומות.</p>')+'</div>';return;
 }
 if(view==='files'){
  const d=await api('/api/files');$('#content').innerHTML='<div class="panel"><label>קובץ חדש (עד 25MB)<input id="fileInput" type="file"></label>'+button('upload','העלאה')+'</div><div class="panel">'+d.items.map(f=>'<div class="row"><a href="/api/files/'+encodeURIComponent(f.id)+'/download">'+esc(f.name)+'</a><span>'+Number(f.size_bytes)+' בתים</span></div>').join('')+'</div>';return;
 }
 if(view==='connectors'){
  const d=await api('/api/connectors');$('#content').innerHTML='<div class="panel">'+d.connectors.map(x=>'<div class="row"><div><b>'+esc(x.key)+'</b><p>'+esc(x.configured?'מוגדר':'לא מוגדר')+' · '+esc(x.status||'')+'</p>'+(x.accounts||[]).map(a=>'<p>'+esc(a.email)+'</p>').join('')+'</div></div>').join('')+'</div><div class="panel">'+button('google','חיבור חשבון Google')+'</div><div class="panel"><h2>WhatsApp</h2><div id="wa"></div><div class="actions">'+button('wa-connect','חיבור')+button('wa-refresh','רענון קוד סריקה')+button('wa-logout','ניתוק חשבון')+'</div></div>';await loadWa();return;
 }
 if(view==='ai'){
  const d=await api('/api/ai/status');$('#content').innerHTML='<div class="panel"><p>מודל מקומי: '+esc(d.model)+'</p><p>מופעל: '+(d.enabled?'כן':'לא')+'</p><p>מצב: '+(d.loaded?'טעון':d.loading?'נטען':'יטען בבקשה הראשונה')+'</p><p>תיקיית מטמון: <bdi>'+esc(d.cache)+'</bdi></p><p>גיבוי חיצוני: '+(d.fallback_configured?'מוגדר':'לא מוגדר')+'</p><p>המודל מורד בבקשה הראשונה. טיוטות ותוצאות דורשות בדיקה שלך לפני שליחה.</p></div>';return;
 }
 $('#content').innerHTML='<div class="panel"><h2>הגדרות מערכת</h2><p>סיסמאות, חיבור למסד הנתונים והגדרות הספקים מנוהלים במשתני הסביבה של Hostinger.</p><p>חיבורי Google ו־WhatsApp מנוהלים במסך החיבורים. הגדרות המודל מוצגות במסך הבינה המלאכותית.</p><p>הודעות נשלחות רק בלחיצה מפורשת על שליחה. גם משימות AI יוצרות תוצאה לבדיקה בלבד.</p></div>';
}
const schemas={
 clients:[['name','שם'],['email','אימייל'],['phone','טלפון'],['company','חברה'],['notes','הערות','textarea'],['project_ids','פרויקטים משויכים','projects']],
 projects:[['name','שם'],['status','מצב'],['category','קטגוריה'],['description','תיאור','textarea'],['next_step','הצעד הבא','textarea']],
 tasks:[['title','כותרת'],['status','מצב',['open','in_progress','done','cancelled']],['priority','עדיפות',['normal','low','high','urgent']],['due_date','תאריך יעד','date'],['automation_mode','מצב עבודה',['manual','ai','ai_draft']],['notes','הערות','textarea'],['project_ids','פרויקטים משויכים','projects']],
 systems:[['did','מספר מערכת'],['status','מצב'],['project_id','פרויקט','project'],['client_id','לקוח','client'],['notes','הערות','textarea']],
 accounts:[['type','סוג',['email','whatsapp','other']],['label','שם החשבון'],['identifier','כתובת או מזהה'],['notes','הערות','textarea'],['project_ids','פרויקטים משויכים','projects']]
};
async function editRecord(id=''){
 const record=records.find(x=>String(x.id||x.did)===id)||{};editing={view,id};
 const [p,c]=await Promise.all([api('/api/projects'),api('/api/clients')]);
 $('#editTitle').textContent=(id?'עריכת ':'הוספת ')+labels[view];$('#editError').textContent='';
 $('#fields').innerHTML=schemas[view].map(([name,label,type])=>{
  const value=record[name]??(Array.isArray(type)?type[0]:'');let input;
  if(type==='textarea')input='<textarea name="'+name+'">'+esc(value)+'</textarea>';
  else if(['project','projects','client'].includes(type)){
   const list=type==='client'?c.items:p.items,selected=Array.isArray(value)?value:[value];
   input='<select name="'+name+'" '+(type==='projects'?'multiple':'')+'>'+(type==='projects'?'':'<option value="">ללא שיוך</option>')+list.map(x=>'<option value="'+esc(x.id)+'" '+(selected.includes(x.id)?'selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select>';
  }else if(Array.isArray(type))input='<select name="'+name+'">'+type.map(o=>'<option '+(o===value?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select>';
  else input='<input name="'+name+'" type="'+(type==='date'?'date':'text')+'" value="'+esc(value)+'" '+(['name','title','did','label','identifier'].includes(name)?'required':'')+' '+(name==='did'&&id?'readonly':'')+'>';
  return '<label>'+label+input+'</label>';
 }).join('');$('#editor').showModal();
}
$('#editForm').onsubmit=async e=>{
 e.preventDefault();const b=e.submitter;b.disabled=true;
 try{const form=new FormData(e.target),data=Object.fromEntries(form);if(schemas[editing.view].some(x=>x[0]==='project_ids'))data.project_ids=form.getAll('project_ids');
 await api('/api/'+editing.view+(editing.id?'/'+encodeURIComponent(editing.id):''),{method:editing.id?'PATCH':'POST',body:JSON.stringify(data)});$('#editor').close();await render(view);
 }catch(error){$('#editError').textContent=error.message;}finally{b.disabled=false;}
};
async function showNotes(id){
 const type=entityNames[view],d=await api('/api/notes?entity_type='+type+'&entity_id='+encodeURIComponent(id));
 const body=prompt('הערות קיימות:\n'+d.items.map(n=>n.body).join('\n\n')+'\n\nהערה חדשה:');if(body?.trim())await post('/api/notes',{entity_type:type,entity_id:id,body});
}
async function openConversation(id){
 const [d,clients,projects,drafts]=await Promise.all([api('/api/conversations/'+encodeURIComponent(id)),api('/api/clients'),api('/api/projects'),api('/api/conversations/'+encodeURIComponent(id)+'/drafts')]);
 conversation=id;requestId=crypto.randomUUID();$('#title').textContent=d.item.title||'שיחה';
 const options=(items,selected)=>'<option value="">ללא שיוך</option>'+items.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(x.name)+'</option>').join('');
 $('#content').innerHTML='<div class="panel actions"><label>לקוח<select id="convClient">'+options(clients.items,d.item.client_id)+'</select></label><label>פרויקט<select id="convProject">'+options(projects.items,d.item.project_id)+'</select></label>'+button('associate','שמירת שיוך')+'</div><div class="panel conversation">'+d.messages.map(m=>'<div class="bubble '+(m.direction==='out'?'out':'')+'"><b>'+esc(m.direction==='out'?'נשלח':'נכנס')+' · '+esc(m.sender)+'</b><div>'+esc(m.body)+'</div><div class="muted">'+esc(m.sent_at)+(m.cc?' · העתק: '+esc(m.cc):'')+'</div></div>').join('')+'</div><div class="panel"><label>תשובה<textarea id="reply"></textarea></label><label>הנחיה לבינה המלאכותית<input id="instruction"></label><div class="actions">'+button('draft','יצירת טיוטת AI')+button('send','שליחה')+'</div><p id="draftInfo" role="status">טיוטה אינה נשלחת אוטומטית.</p></div>';
 const draft=drafts.items.find(x=>x.status==='draft');if(draft){$('#reply').value=draft.body;$('#reply').dataset.draftId=draft.id;}
 await post('/api/conversations/'+encodeURIComponent(id)+'/read');
 $('.conversation').scrollTop=$('.conversation').scrollHeight;
}
async function loadWa(){const d=await api('/api/whatsapp/status');$('#wa').innerHTML='<p>'+esc(d.status)+'</p>'+(d.qr&&d.qr.startsWith('data:image/png;base64,')?'<img alt="קוד לחיבור WhatsApp" src="'+esc(d.qr)+'" width="260">':'');}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;$('#error').textContent='';
 if(b.dataset.view){location.hash=b.dataset.view;return;}
 const action=b.dataset.action;if(!action)return;b.disabled=true;
 try{
  if(action==='close-editor')$('#editor').close();
  if(action==='create'||action==='edit')await editRecord(b.dataset.id);
  if(action==='notes')await showNotes(b.dataset.id);
  if(action==='conversation')await openConversation(b.dataset.id);
  if(action==='sync'){const d=await post('/api/sync');$('#notice').textContent='יובאו '+d.imported+' הודעות; שגיאות: '+d.errors;await render(view);}
  if(action==='upload'){const file=$('#fileInput').files[0];if(!file)return;const data=new FormData();data.append('file',file);const r=await fetch('/api/files',{method:'POST',body:data,credentials:'same-origin'});if(!r.ok)throw Error('העלאת הקובץ נכשלה');await render('files');}
  if(action==='google'){const d=await post('/api/google/auth-url');location.href=d.url;}
  if(action==='wa-connect'){await post('/api/whatsapp/connect');await loadWa();}
  if(action==='wa-refresh')await loadWa();
  if(action==='wa-logout'&&confirm('לנתק את חשבון WhatsApp?')){await post('/api/whatsapp/logout');await loadWa();}
  if(action==='associate'){await api('/api/conversations/'+encodeURIComponent(conversation),{method:'PATCH',body:JSON.stringify({client_id:$('#convClient').value,project_id:$('#convProject').value})});$('#notice').textContent='השיוך נשמר';}
  if(action==='draft'){
   $('#draftInfo').textContent='יוצר טיוטה. בטעינה הראשונה נדרשת הורדת מודל…';
   const d=await post('/api/conversations/'+encodeURIComponent(conversation)+'/draft',{instruction:$('#instruction').value});$('#reply').value=d.draft;$('#reply').dataset.draftId=d.id;$('#draftInfo').textContent='טיוטה מוכנה לעריכה. מקור: '+d.provider;
  }
  if(action==='send'){
   const body=$('#reply').value.trim();if(!body)return;
   await post('/api/conversations/'+encodeURIComponent(conversation)+'/send',{body,draft_id:$('#reply').dataset.draftId||'',request_id:requestId});await openConversation(conversation);
  }
 }catch(error){$('#error').textContent=error.message;}finally{b.disabled=false;}
});
window.addEventListener('hashchange',()=>render(location.hash.slice(1)).catch(e=>$('#error').textContent=e.message));
async function realtime(){try{const d=await post('/api/ws-ticket'),url=new URL('/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',d.ticket);const socket=new WebSocket(url);socket.onmessage=e=>{const event=JSON.parse(e.data);if(event.type!=='connected')$('#notice').textContent='המידע עודכן ברקע. ניתן לרענן את המסך.';};socket.onclose=()=>setTimeout(realtime,5000);}catch{setTimeout(realtime,15000);}}
void render(location.hash.slice(1)||'home').catch(e=>$('#error').textContent=e.message);void realtime();
