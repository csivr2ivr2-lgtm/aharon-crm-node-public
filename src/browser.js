/* Browser-only UI. Record data is escaped and never inserted into executable attributes. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={followups:'מעקבים',knowledge:'ידע עסקי',assistant:'העוזר האישי',spam:'דואר זבל',suggestions:'הצעות חכמות',reminders:'תזכורות',notifications:'התראות',files:'קבצים',home:'ראשי',inbox:'תיבת הודעות',clients:'לקוחות',projects:'פרויקטים',tasks:'משימות',systems:'מערכות',accounts:'חשבונות',connectors:'חיבורים',ai:'בינה מלאכותית',settings:'הגדרות'};
const entityNames={clients:'client',projects:'project',tasks:'task',systems:'system',accounts:'account'};
let view='home',records=[],conversation='',requestId='',editing=null;
let knowledgeCandidates=[],knowledgeArticles=[],knowledgeEditing=null;
let assistantMessages=[], pendingActions=[], showArchived=false, showArchivedFiles=false, fileQuery='';
const button=(action,label,id='')=>'<button type="button" class="btn" data-action="'+action+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';
const channel=c=>c.channel==='whatsapp'?'WhatsApp':String(c.integration_key||'').startsWith('hostinger:')?'Hostinger Email':'Gmail';
async function api(url,opt={}){
 const r=await fetch(url,{credentials:'same-origin',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
 const d=await r.json().catch(()=>({}));if(r.status===401){location.href='/';throw Error('נדרשת כניסה מחדש');}
 if(!r.ok||d.ok===false)throw Error(userError(d.error));return d;
}
const post=(url,data={})=>api(url,{method:'POST',body:JSON.stringify(data)});
async function render(next){
 view=labels[next]?next:'home';conversation='';$('#title').textContent=labels[view];$('#error').textContent='';
 document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 $('#content').innerHTML='<div class="panel">טוען…</div>';
 if(view==='home'){
  const d=await api('/api/status');$('#content').innerHTML='<div class="grid">'+Object.entries(d.counts||{}).map(([k,n])=>'<div class="card"><div class="metric">'+Number(n)+'</div>'+esc(labels[k]||({conversations:'שיחות',messages:'הודעות'})[k]||k)+'</div>').join('')+'</div><div class="panel">'+button('sync','סנכרון הודעות')+'</div>';return;
 }
 if(await renderIntelligence(view))return;
 if(view==='inbox'||view==='spam'){
  const d=await api('/api/inbox'+(view==='spam'?'?folder=spam':''));$('#content').innerHTML='<div class="panel">'+button('sync','סנכרון')+(d.items.length?d.items.map(c=>'<div class="row"><div><b>'+esc(c.title)+'</b><div class="muted">'+esc(channel(c))+' · '+esc(c.last_message_at)+'</div></div><div>'+inboxState(c)+' '+button('conversation','פתיחה',c.id)+'</div></div>').join(''):'<p class="empty">אין הודעות עדיין. יש לחבר חשבון ולסנכרן.</p>')+'</div>';return;
 }
 if(entityNames[view]){
  const d=await api('/api/'+view+(showArchived?'?include_archived=1':''));records=d.items;$('#content').innerHTML='<div class="panel">'+button('create','הוספה')+(['projects','systems'].includes(view)?button('toggle-archived',showArchived?'הסתר ארכיון':'הצג ארכיון'):'')+'</div><div class="panel">'+(records.map(x=>'<div class="row"><div><b>'+esc(x.name||x.title||x.did||x.label)+'</b><div class="muted">'+esc([statusLabel(x.status),x.email,x.phone,x.identifier,statusLabel(x.automation_mode),statusLabel(x.worker_state)].filter(Boolean).join(' · '))+'</div><div class="note">'+esc(x.description||x.notes||'')+'</div>'+(x.next_step?'<p>הצעד הבא: '+esc(x.next_step)+'</p>':'')+(x.worker_result?'<p class="draft note">'+esc(x.worker_result)+'</p>':'')+'</div><div>'+button('edit','עריכה',x.id||x.did)+button('notes','הערות',x.id||x.did)+(['projects','systems'].includes(view)?lifecycleButtons(x):'')+'</div></div>').join('')||'<p class="empty">אין רשומות.</p>')+'</div>';return;
 }
 if(view==='files'){await renderFiles();return;}
 if(view==='connectors'){
  const d=await api('/api/connectors');$('#content').innerHTML='<div class="panel">'+d.connectors.map(x=>'<div class="row"><div><b>'+esc(({google:'Google', 'hostinger-mail':'דואר Hostinger',whatsapp:'WhatsApp'})[x.key]||x.key)+'</b><p>'+esc(x.configured?'מוגדר':'לא מוגדר')+' · '+esc(statusLabel(x.status))+'</p>'+(x.accounts||[]).map(a=>'<p>'+esc(a.email)+' '+button('google-disconnect','ניתוק החשבון',a.id)+'</p>').join('')+(x.key==='hostinger-mail'&&x.configured?'<p>'+esc(x.account)+' '+button('hostinger-disconnect','ניתוק הדואר')+'</p>':'')+'</div></div>').join('')+'</div><div class="panel">'+button('google','הוסף חשבון Google')+'<p class="muted">אישור מאובטח לחיבור דואר, יומן וקבצים בחשבון שלך.</p>'+'</div><div class="panel"><h2>WhatsApp — חיבור טלפון</h2><p>פתח במכשיר את המכשירים המקושרים וסרוק את הקוד.</p><div id="wa"></div><div class="actions">'+button('wa-connect','חבר WhatsApp')+button('wa-reconnect','חיבור מחדש')+button('wa-refresh','רענון קוד סריקה')+button('wa-disconnect','ניתוק זמני')+button('wa-delete-session','מחיקת החיבור השמור')+'</div></div>';await loadWa();$('#content').insertAdjacentHTML('beforeend','<form id="mailSetup" class="panel"><h2>הוסף דואר Hostinger</h2><p>החיבור נבדק לפני שמירת החשבון.</p><label>כתובת אימייל<input type="email" name="email" autocomplete="username" required></label><label>סיסמת הדואר<input type="password" name="password" autocomplete="new-password" required></label><button class="btn primary" type="submit">בדיקה וחיבור</button><p id="mailStatus" role="status"></p></form>');return;
 }
 if(view==='ai'){await renderLocalAi();return;}
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
  }else if(Array.isArray(type))input='<select name="'+name+'">'+type.map(o=>'<option value="'+esc(o)+'" '+(o===value?'selected':'')+'>'+esc(({manual:'ידני',ai:'טיפול חכם',ai_draft:'טיוטה חכמה',normal:'רגילה',low:'נמוכה',high:'גבוהה',urgent:'דחופה',open:'פתוח',in_progress:'בטיפול',done:'הושלם',cancelled:'בוטל',email:'דואר',whatsapp:'WhatsApp',other:'אחר'})[o]||o)+'</option>').join('')+'</select>';
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
 $('#content').innerHTML='<div class="panel actions"><label>לקוח<select id="convClient">'+options(clients.items,d.item.client_id)+'</select></label><label>פרויקט<select id="convProject">'+options(projects.items,d.item.project_id)+'</select></label>'+button('associate','שמירת שיוך')+'</div><div class="panel conversation">'+d.messages.map(m=>'<div class="bubble '+(m.direction==='out'?'out':'')+'"><b>'+esc(m.direction==='out'?'נשלח':'נכנס')+' · '+esc(m.sender)+'</b>'+classificationHtml(m)+'<div>'+esc(m.body)+'</div><div class="muted">'+esc(m.sent_at)+(m.cc?' · העתק: '+esc(m.cc):'')+'</div>'+button('knowledge-propose','הפק נוהל כללי',m.id)+'</div>').join('')+'</div><div class="panel"><label>תשובה<textarea id="reply"></textarea></label><label>הנחיה לבינה המלאכותית<input id="instruction"></label><div class="actions">'+button('draft','יצירת טיוטה מחדש')+button('save-draft','שמירת עריכה')+button('reject-draft','דחיית טיוטה')+button('send','אישור ושליחה')+'</div><p id="draftInfo" role="status">טיוטה אינה נשלחת אוטומטית.</p></div>';
 const draft=drafts.items.find(x=>x.status==='draft');if(draft){$('#reply').value=draft.body;$('#reply').dataset.draftId=draft.id;}
 await post('/api/conversations/'+encodeURIComponent(id)+'/read');
 $('.conversation').scrollTop=$('.conversation').scrollHeight;
}
async function loadWa(){const d=await api('/api/whatsapp/status');$('#wa').innerHTML='<p>'+esc(statusLabel(d.status))+'</p>'+(d.qr&&d.qr.startsWith('data:image/png;base64,')?'<img alt="קוד לחיבור WhatsApp" src="'+esc(d.qr)+'" width="260">':'');}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;$('#error').textContent='';
 if(b.dataset.view){location.hash=b.dataset.view;return;}
 const action=b.dataset.action;if(!action)return;b.disabled=true;
 try{
  if(await intelligenceAction(action,b))return;
  if(action==='close-editor')$('#editor').close();
  if(action==='create'||action==='edit')await editRecord(b.dataset.id);
  if(action==='notes')await showNotes(b.dataset.id);
  if(action==='conversation')await openConversation(b.dataset.id);
  if(action==='sync'){const d=await post('/api/sync');$('#notice').textContent='יובאו '+d.imported+' הודעות; שגיאות: '+d.errors;await render(view);}
  if(action==='upload'){const file=$('#fileInput').files[0];if(!file)return;const data=new FormData();data.append('file',file);const r=await fetch('/api/files',{method:'POST',body:data,credentials:'same-origin'});if(!r.ok)throw Error('העלאת הקובץ נכשלה');const result=await r.json();await api('/api/files/'+encodeURIComponent(result.id),{method:'PATCH',body:JSON.stringify({client_id:$('#fileClient').value,project_id:$('#fileProject').value,task_id:$('#fileTask').value})});await render('files');}
  if(action==='google'){const d=await post('/api/google/auth-url');const target=new URL(d.url);if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw Error('כתובת ההתחברות אינה תקינה');location.href=target.href;}
  if(action==='wa-connect'){await post('/api/whatsapp/connect');await loadWa();}
  if(action==='wa-reconnect'){await post('/api/whatsapp/reconnect');await loadWa();}
  if(action==='wa-disconnect'&&confirm('לנתק זמנית את WhatsApp? ניתן להתחבר מחדש בלי למחוק את החיבור השמור.')){await post('/api/whatsapp/disconnect');await loadWa();}
  if(action==='wa-delete-session'&&confirm('למחוק את החיבור השמור של WhatsApp? לחיבור הבא תידרש סריקה חדשה.')){await api('/api/whatsapp/session',{method:'DELETE'});await loadWa();}
  if(action==='google-disconnect'&&confirm('לנתק את חשבון Google הזה מהמערכת?')){await api('/api/google/accounts/'+encodeURIComponent(b.dataset.id),{method:'DELETE'});await render('connectors');}
  if(action==='hostinger-disconnect'&&confirm('לנתק את חשבון הדואר של Hostinger?')){await post('/api/hostinger/disconnect');await render('connectors');}
  if(action==='wa-refresh')await loadWa();
  if(action==='wa-logout'&&confirm('לנתק את חשבון WhatsApp?')){await post('/api/whatsapp/logout');await loadWa();}
  if(action==='associate'){await api('/api/conversations/'+encodeURIComponent(conversation),{method:'PATCH',body:JSON.stringify({client_id:$('#convClient').value,project_id:$('#convProject').value})});$('#notice').textContent='השיוך נשמר';}
  if(action==='draft'){
   $('#draftInfo').textContent='יוצר טיוטה. בטעינה הראשונה נדרשת הורדת מודל…';
   const d=await post('/api/conversations/'+encodeURIComponent(conversation)+'/draft',{instruction:$('#instruction').value});$('#reply').value=d.draft;$('#reply').dataset.draftId=d.id;$('#draftInfo').textContent='טיוטה מוכנה לעריכה. מקור: '+d.provider;
  }
  if(action==='send'){
   const body=$('#reply').value.trim();if(!body||!confirm('לשלוח את ההודעה הבאה?\n\n'+body))return;
   await post('/api/conversations/'+encodeURIComponent(conversation)+'/send',{body,confirmed:true,draft_id:$('#reply').dataset.draftId||'',request_id:requestId});await openConversation(conversation);
  }
 }catch(error){$('#error').textContent=error.message;}finally{b.disabled=false;}
});
window.addEventListener('hashchange',()=>render(location.hash.slice(1)).catch(e=>$('#error').textContent=e.message));
async function realtime(){try{const d=await post('/api/ws-ticket'),url=new URL('/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',d.ticket);const socket=new WebSocket(url);socket.onmessage=e=>{const event=JSON.parse(e.data);if(event.type!=='connected')$('#notice').textContent='המידע עודכן ברקע. ניתן לרענן את המסך.';};socket.onclose=()=>setTimeout(realtime,5000);}catch{setTimeout(realtime,15000);}}



function userError(code){const errors={external_ai_required:'לצ׳אט, לטיוטות ולניתוח מורכב נדרש ספק AI חיצוני. הגדר ספק חיצוני בהגדרות השרת.',external_ai_model_required:'יש להגדיר מודל כתיבה חיצוני, בנפרד ממודל Tiny המקומי.',knowledge_private_data:'התוכן מכיל פרטים אישיים או מזהים. יש להסיר אותם לפני שמירה.',knowledge_review_required:'נדרשת בדיקה ואישור שהתוכן כללי ומתאים לשיתוף בין שיחות.',invalid_knowledge_content:'יש למלא כותרת עד 255 תווים ותוכן עד 12000 תווים.',invalid_knowledge_extraction:'לא הופק נוהל כללי תקין מההודעה. אפשר לנסות הודעה אחרת.',confirmation_expired_or_used:'האישור פג תוקף או שכבר נעשה בו שימוש. בקש מהעוזר להכין את הפעולה מחדש.',destination_changed_request_new_confirmation:'פרטי הנמען השתנו. יש להכין את ההודעה מחדש ולקבל אישור חדש.',invalid_confirmation:'האישור אינו תקין. בקש להכין את הפעולה מחדש.',invalid_settings:'יש לבדוק את ערכי ההגדרות.',tool_permission_denied:'אין הרשאה לביצוע הפעולה.',not_found:'הרשומה לא נמצאה.',invalid_draft:'הטיוטה אינה זמינה לשליחה. יש לרענן את השיחה.',action_failed_review_required:'הפעולה לא הושלמה בוודאות. יש לבדוק את יומן הפעולות לפני ניסיון נוסף.',file_type_not_editable:'לא ניתן לערוך את סוג הקובץ הזה.',connection_failed:'החיבור נכשל. בדוק את פרטי החשבון.'};return errors[code]||(/[\u0590-\u05ff]/.test(String(code))?String(code):'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.');}
function toolLabel(name){return ({send_email:'שליחת דואר',send_whatsapp:'שליחת WhatsApp',create_client:'יצירת לקוח',update_client:'עדכון לקוח',create_project:'יצירת פרויקט',update_project:'עדכון פרויקט',archive_project:'העברה לארכיון',create_task:'יצירת משימה',update_task:'עדכון משימה',update_system:'עדכון מערכת',create_draft:'יצירת טיוטה',create_file:'יצירת קובץ',update_file:'עדכון קובץ',create_reminder:'יצירת תזכורת'})[name];}
const statusNames={manual:'ידני',ai:'טיפול חכם',ai_draft:'טיוטה חכמה',queued:'בתור',active:'פעיל',in_progress:'בטיפול',cancelled:'בוטל',normal:'רגיל',spam:'ספאם',suspicious:'חשוד',automated:'אוטומטי',marketing:'שיווקי',system:'מערכת',unknown:'לא ידוע',pending:'ממתין',completed:'הושלם',failed:'נכשל',running:'פועל',connected:'מחובר',connecting:'מתחבר',disconnected:'מנותק',reconnecting:'מתחבר מחדש',error:'שגיאה',open:'פתוח',done:'הושלם',archived:'בארכיון',deleted:'נמחק',draft:'טיוטה'};
const statusLabel=value=>statusNames[value]||value||'';
const empty=text=>'<p class="empty">'+esc(text)+'</p>';
const lifecycleButtons=x=>'<div class="actions">'+button('relations','קשרים',x.id||x.did)+button(x.archived_at||x.deleted_at?'restore':'archive',x.archived_at||x.deleted_at?'שחזור':'ארכיון',x.id||x.did)+button('delete','מחיקה',x.id||x.did)+(x.deleted_at?button('hard_delete','מחיקה לצמיתות',x.id||x.did):'')+'</div>';
function classificationHtml(m){if(m.direction==='out')return '';return '<div class="muted">'+esc(statusLabel(m.classification||'unknown'))+(m.classification_score!=null?' · '+Math.round(Number(m.classification_score)*100)+'%':'')+' '+esc(m.classification_reason||'')+'</div><div class="actions">'+button('spam-feedback','ספאם',m.id)+button('normal-feedback','לא ספאם',m.id)+'</div>';}
function optionHtml(values,current){return values.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(label)+'</option>').join('');}
async function renderIntelligence(page){
 if(page==='assistant'){
  $('#content').innerHTML='<div class="panel"><p>אפשר לשאול על לקוחות, הודעות, משימות וקבצים. פעולות שמחייבות אישור יוצגו לבדיקה לפני הביצוע.</p><div id="chatLog" class="chat-log" role="log" aria-live="polite"></div><form id="assistantForm"><label>איך אפשר לעזור?<textarea name="message" required maxlength="12000" placeholder="מי מחכה לתשובה שלי?"></textarea></label><button class="btn primary" type="submit">שליחה לעוזר</button></form></div>';renderChat();return true;
 }
 if(page==='notifications'){
  const d=await api('/api/notifications');$('#content').innerHTML='<div class="panel">'+(d.items.map(n=>'<div class="row"><div><b>'+esc(n.title||statusLabel(n.type))+'</b><p class="note">'+esc(n.body||n.message||'')+'</p><span class="muted">'+esc(n.created_at)+'</span></div>'+(!n.is_read?button('notification-read','סימון כנקרא',n.id):'<span class="tag">נקרא</span>')+'</div>').join('')||empty('אין התראות.'))+'</div>';return true;
 }
 if(page==='suggestions'){
  const d=await api('/api/suggestions');records=d.items;$('#content').innerHTML='<div class="panel">'+(d.items.map(x=>'<div class="row"><div><b>'+esc(x.title||x.summary||({client:'לקוח חדש',client_update:'עדכון פרטי לקוח',project:'פרויקט חדש',project_update:'עדכון פרויקט',task:'משימה חדשה',system:'שיוך מערכת'})[x.type]||statusLabel(x.type||x.kind))+'</b><p class="note">'+esc(x.reason||x.description||'')+'</p><p class="muted">רמת ביטחון: '+Math.round(Number(x.confidence||0)*100)+'% · '+esc(statusLabel(x.status))+'</p>'+previewArgs(x.payload||x.data||{})+'</div><div class="actions">'+(x.status==='pending'?button('suggestion-approve','אישור',x.id)+button('suggestion-ignore','התעלמות',x.id)+((x.type||x.kind)==='project'?button('suggestion-merge','מיזוג לפרויקט',x.id):''):'')+'</div></div>').join('')||empty('אין הצעות שממתינות לבדיקה.'))+'</div>';return true;
 }
 if(page==='reminders'){
  const d=await api('/api/reminders');$('#content').innerHTML='<form id="reminderForm" class="panel"><h2>תזכורת חדשה</h2><div class="form-inline"><label>מה להזכיר?<input name="title" required maxlength="500"></label><label>מתי?<input name="due_at" type="datetime-local" required></label><button class="btn primary" type="submit">יצירה</button></div></form><div class="panel">'+(d.items.map(r=>'<div class="row"><div><b>'+esc(r.title)+'</b><p>'+esc(r.due_at)+' · '+esc(statusLabel(r.status))+'</p></div>'+(r.status!=='done'?button('reminder-done','בוצע',r.id):'')+'</div>').join('')||empty('אין תזכורות.'))+'</div>';return true;
 }
 if(page==='followups'){await renderFollowups();return true;}
 if(page==='knowledge'){await renderKnowledge();return true;}
 if(page==='settings'){await renderSettings();return true;}
 return false;
}
function previewArgs(args){const fields={company:'חברה',role:'תפקיד',evidence:'מקור בהודעה',confidence:'רמת ביטחון',source_message_id:'הודעת מקור',next_step:'הצעד הבא',origin:'מקור',provider:'ספק',status:'מצב',recipient:'נמען',client:'לקוח',account:'חשבון שולח',account_key:'מזהה חשבון',subject:'נושא',body:'תוכן',to:'נמען',client_id:'לקוח',project_id:'פרויקט',title:'כותרת',name:'שם',due_date:'תאריך יעד',did:'מספר מערכת',conversation_id:'שיחה',query:'חיפוש',notes:'הערות',description:'תיאור',content:'תוכן הקובץ',id:'מזהה',channel:'ערוץ'};return '<div class="note">'+Object.entries(args||{}).filter(([k])=>k!=='account_key').map(([k,v])=>esc(fields[k]||k)+': '+esc(typeof v==='object'?JSON.stringify(v):v)).join('\n')+'</div>';}
function renderChat(){
 const log=$('#chatLog');if(!log)return;
 log.innerHTML=assistantMessages.map(m=>'<div class="bubble '+(m.role==='user'?'out':'')+'"><b>'+esc(m.role==='user'?'אתה':'העוזר')+'</b><div class="note">'+esc(m.text)+'</div></div>').join('')+pendingActions.map(a=>'<div class="panel draft"><h3>'+esc(toolLabel(a.tool)||a.summary||'פעולה לבדיקה')+'</h3>'+previewArgs(a.preview||a.args)+'<div class="actions">'+(a.status==='pending'?button('assistant-confirm','אישור וביצוע',a.id)+button('assistant-dismiss','ביטול',a.id):'<span class="tag">'+esc(statusLabel(a.status))+'</span>')+'</div></div>').join('');log.scrollTop=log.scrollHeight;
}
async function renderFiles(q=fileQuery){
 fileQuery=q;
 const [d,c,p,t]=await Promise.all([api('/api/files?q='+encodeURIComponent(q)+(showArchivedFiles?'&include_archived=1':'')),api('/api/clients'),api('/api/projects'),api('/api/tasks')]);records=d.items;
 const options=items=>'<option value="">ללא שיוך</option>'+items.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.title)+'</option>').join('');
 $('#content').innerHTML='<div class="panel"><form id="fileSearch" class="form-inline"><label>חיפוש בשם ובתוכן<input name="q" value="'+esc(q)+'"></label><button class="btn" type="submit">חיפוש</button></form><label>קובץ חדש (עד 25MB)<input id="fileInput" type="file"></label><div class="settings-grid"><label>לקוח<select id="fileClient">'+options(c.items)+'</select></label><label>פרויקט<select id="fileProject">'+options(p.items)+'</select></label><label>משימה<select id="fileTask">'+options(t.items)+'</select></label></div><div class="actions">'+button('upload','העלאה')+button('file-create','יצירת קובץ טקסט')+button('toggle-file-archive',showArchivedFiles?'הסתר קבצים בארכיון ובסל המחזור':'הצג ארכיון וסל מחזור')+'</div></div><div class="panel">'+(d.items.map(f=>'<div class="row"><div><a href="/api/files/'+encodeURIComponent(f.id)+'/download">'+esc(f.name)+'</a><p class="muted">'+Number(f.size_bytes)+' בתים · '+esc(statusLabel(f.index_status))+(f.deleted_at?' · בסל המחזור':f.archived_at?' · בארכיון':'')+'</p></div><div class="actions">'+button('file-read','תוכן',f.id)+button('file-summary','סיכום',f.id)+button('file-rename','שינוי שם',f.id)+button('file-move','העברה לתיקייה',f.id)+button('file-associate','שמירת שיוכים',f.id)+button('file-edit','עריכת טקסט',f.id)+(f.archived_at||f.deleted_at?button('file-restore','שחזור',f.id):button('file-archive','ארכיון',f.id))+(!f.deleted_at?button('file-delete','מחיקה',f.id):'')+'</div></div>').join('')||empty('לא נמצאו קבצים.'))+'</div><div id="filePreview"></div>';
}
async function intelligenceAction(action,b){
 const id=b.dataset.id, patch=(url,data)=>api(url,{method:'PATCH',body:JSON.stringify(data)});
 if(action==='local-ai-test'){await post('/api/ai/test');await render('ai');}
 else if(action==='refresh-view'){await render(view);}
 else if(action==='followup-remind'||action==='followup-draft'){
  const draft=action==='followup-draft';await post('/api/followups/'+encodeURIComponent(id)+'/remind',{mode:draft?'draft_follow_up':'remind'});await render('followups');$('#notice').textContent=draft?'בקשת טיוטת המעקב נוספה לתור. כשהטיוטה תהיה מוכנה היא תופיע בשיחה לבדיקה.':'תזכורת המעקב נשמרה.';
 }
 else if(action==='knowledge-propose'){await post('/api/knowledge/candidates',{sourceMessageId:id});await render('knowledge');$('#notice').textContent='הנוהל נוצר כהצעה בלבד. יש לבדוק ולערוך אותו לפני אישור.';}
 else if(action==='knowledge-review'||action==='knowledge-edit'){
  const candidate=action==='knowledge-review',item=(candidate?knowledgeCandidates:knowledgeArticles).find(x=>String(x.id)===id);if(!item)return true;knowledgeEditing={id,candidate};renderKnowledgeEditor(item);
 }
 else if(action==='knowledge-cancel'){knowledgeEditing=null;$('#knowledgeEditor').innerHTML='';}
 else if(action==='knowledge-archive'){if(!confirm('להעביר את הנוהל לארכיון ולהפסיק להשתמש בו בתשובות?'))return true;await patch('/api/knowledge/'+encodeURIComponent(id),{archived:true});await render('knowledge');}
 else if(action==='security-audit'){const d=await api('/api/audit');$('#auditLog').innerHTML=d.items.map(x=>'<div class="row"><div><b>'+esc(x.action)+'</b><p>'+esc(x.reason||'')+'</p><span class="muted">'+esc(x.actor)+' · '+esc(x.created_at)+'</span></div></div>').join('')||empty('אין פעולות ביומן.');}
 else if(action==='toggle-file-archive'){showArchivedFiles=!showArchivedFiles;await renderFiles();}
 else if(action==='toggle-archived'){showArchived=!showArchived;await render(view);}
 else if(['archive','restore','delete','hard_delete','relations'].includes(action)){
  const d=await api('/api/'+view+'/'+encodeURIComponent(id)+'/relations');
  const related=d.relations||d;const summary=Object.entries(related).filter(([k])=>k!=='ok').map(([k,v])=>(labels[k]||k)+': '+(Array.isArray(v)?v.length:typeof v==='object'?JSON.stringify(v):v)).join('\n');
  if(action==='relations'){alert('קשרים לרשומה:\n'+summary);return true;}
  const text={archive:'להעביר לארכיון?',restore:'לשחזר את הרשומה?',delete:'למחוק את הרשומה? היא תישמר למחיקה רכה ושחזור.',hard_delete:'למחוק לצמיתות? לא ניתן לשחזר פעולה זו.'}[action];
  if(!confirm(text+'\n\nקשרים:\n'+summary))return true;
  let detachRelations=false;if(action==='hard_delete'){detachRelations=confirm('לנתק במפורש את הקשרים לרשומה בזמן המחיקה? ביטול ישאיר את הרשומה ללא שינוי.');if(!detachRelations)return true;}
  await post('/api/'+view+'/'+encodeURIComponent(id)+'/lifecycle',{action,confirmed:true,detachRelations});await render(view);
 }
 else if(action==='assistant-confirm'){
  const a=pendingActions.find(x=>x.id===id);if(!a||a.status!=='pending')return true;
  const result=await post('/api/assistant/actions/'+encodeURIComponent(id)+'/confirm',{confirmed:true,confirmation_token:a.confirmation_token});a.status='completed';delete a.confirmation_token;assistantMessages.push({role:'assistant',text:result.reply||(result.result?.client_name?'ההודעה נשלחה אל '+result.result.client_name+' ('+result.result.recipient+').':'הפעולה בוצעה.')});renderChat();
 }
 else if(action==='assistant-dismiss'){pendingActions=pendingActions.filter(x=>x.id!==id);renderChat();}
 else if(action==='notification-read'){await post('/api/notifications/'+encodeURIComponent(id)+'/read');await render(view);}
 else if(action.startsWith('suggestion-')){
  const decision=action.slice(11);let project_id='';
  if(decision==='merge'){const p=await api('/api/projects');const name=prompt('בחר פרויקט למיזוג לפי המזהה:\n'+p.items.map(x=>x.id+' — '+x.name).join('\n'));if(!name)return true;project_id=name.trim();if(!p.items.some(x=>x.id===project_id))throw Error('יש לבחור מזהה פרויקט מהרשימה');}
  await post('/api/suggestions/'+encodeURIComponent(id)+'/resolve',{decision,project_id});await render(view);
 }
 else if(action==='reminder-done'){await patch('/api/reminders/'+encodeURIComponent(id),{status:'done'});await render(view);}
 else if(action==='retry-job'){await post('/api/jobs/'+encodeURIComponent(id)+'/retry');await render(view);}
 else if(action==='spam-feedback'||action==='normal-feedback'){await post('/api/messages/'+encodeURIComponent(id)+'/feedback',{classification:action==='spam-feedback'?'spam':'normal'});await openConversation(conversation);}
 else if(action==='save-draft'||action==='reject-draft'){
  const draftId=$('#reply').dataset.draftId;if(!draftId)throw Error('אין טיוטה שמורה בשיחה. יש ליצור טיוטה תחילה.');
  await patch('/api/drafts/'+encodeURIComponent(draftId),action==='reject-draft'?{status:'rejected'}:{body:$('#reply').value});$('#draftInfo').textContent=action==='reject-draft'?'הטיוטה נדחתה':'העריכה נשמרה';if(action==='reject-draft'){$('#reply').value='';delete $('#reply').dataset.draftId;}
 }
 else if(action.startsWith('file-')){
  const path='/api/files/'+encodeURIComponent(id), relations={client_id:$('#fileClient').value,project_id:$('#fileProject').value,task_id:$('#fileTask').value};
  if(action==='file-create'){const name=prompt('שם הקובץ כולל סיומת txt, md, json או csv:','document.txt');if(!name)return true;const content=prompt('תוכן הקובץ:');if(content===null)return true;await post('/api/files/text',{name,content,...relations});}
  if(action==='file-read'){const d=await api(path+'/content');$('#filePreview').innerHTML='<div class="panel file-preview">'+esc(d.content||d.text||'לא זמין תוכן טקסט לחיפוש.')+'</div>';return true;}
  if(action==='file-summary'){const d=await post('/api/assistant/chat',{message:'סכם את הקובץ בעל המזהה '+id,file_id:id});$('#filePreview').innerHTML='<div class="panel file-preview">'+esc(d.reply)+'</div>';return true;}
  if(action==='file-edit'){const d=await api(path+'/content');const content=prompt('עריכת תוכן הקובץ:',d.content||d.text||'');if(content===null)return true;await patch(path,{content});}
  if(action==='file-rename'){const name=prompt('שם חדש:',records.find(x=>x.id===id)?.name||'');if(!name)return true;await patch(path,{name});}
  if(action==='file-move'){const folder=prompt('שם התיקייה בתוך מערכת הקבצים:');if(folder===null)return true;await patch(path,{folder});}
  if(action==='file-associate')await patch(path,relations);
  if(['file-archive','file-delete','file-restore'].includes(action)){if(!confirm({'file-delete':'להעביר את הקובץ לסל המחזור? ניתן לשחזר אותו.', 'file-archive':'להעביר את הקובץ לארכיון?', 'file-restore':'לשחזר את הקובץ?'}[action]))return true;await post(path+'/lifecycle',{action:action.slice(5),confirmed:true});}
  await renderFiles();
 }
 else return false;
 return true;
}
document.addEventListener('submit',async e=>{
 const form=e.target;if(!['assistantForm','mailSetup','reminderForm','settingsForm','fileSearch','knowledgeForm'].includes(form.id))return;e.preventDefault();const submit=e.submitter;submit.disabled=true;$('#error').textContent='';
 try{
  const fields=Object.fromEntries(new FormData(form));
  if(form.id==='assistantForm'){
   assistantMessages.push({role:'user',text:fields.message});renderChat();const d=await post('/api/assistant/chat',{message:fields.message});assistantMessages.push({role:'assistant',text:d.reply||'הבקשה טופלה.'});pendingActions.push(...(d.actions||[]));form.reset();renderChat();
  }
  if(form.id==='mailSetup'){
   $('#mailStatus').textContent='בודק את חיבור הדואר…';await post('/api/hostinger/accounts',fields);form.reset();$('#mailStatus').textContent='החשבון חובר בהצלחה.';
  }
  if(form.id==='reminderForm'){fields.due_at=new Date(fields.due_at).toISOString();await post('/api/reminders',fields);await render('reminders');}
  if(form.id==='fileSearch')await renderFiles(fields.q);
  if(form.id==='knowledgeForm')await saveKnowledge(fields);
  if(form.id==='settingsForm'){await saveSettings(fields);$('#notice').textContent='ההגדרות נשמרו';}
 }catch(error){$('#error').textContent=error.message;}finally{submit.disabled=false;}
});
async function renderSettings(){
 const [d,jobs,accounts,background,security]=await Promise.all([api('/api/settings'),api('/api/jobs'),api('/api/accounts'),api('/api/background/status'),api('/api/security/status')]);const s=d.settings;
 const select=(name,label,values,current)=>'<label>'+label+'<select name="'+name+'">'+optionHtml(values,current)+'</select></label>';
 const modes=[['off','כבוי'],['suggest','הצעה לאישור'],['automatic','אוטומטי']];
 $('#content').innerHTML='<form id="settingsForm"><section class="panel"><h2>בינה מלאכותית</h2><div class="settings-grid">'+select('generativeProvider','ספק לכתיבה ולצ׳אט',[['external','חיצוני'],['disabled','כבוי']],s.ai.generativeProvider||'external')+'<label>מודל כתיבה חיצוני<input name="externalModel" value="'+esc(s.ai.externalModel||'')+'"></label><label>מודל Tiny מקומי — סיווג וחילוץ בלבד<input name="localModel" value="'+esc(s.ai.localModel||'')+'"></label><label>מידת יצירתיות<input name="temperature" type="number" min="0" max="2" step="0.1" value="'+Number(s.ai.temperature)+'"></label><label>גודל ההקשר<input name="contextSize" type="number" min="2000" max="64000" value="'+Number(s.ai.contextSize)+'"></label>'+select('fallback','מעבר לספק גיבוי',[['true','מופעל'],['false','כבוי']],String(s.ai.fallback))+'</div></section><section class="panel"><h2>אוטומציות</h2><div class="settings-grid">'+Object.entries({clients:'יצירת לקוחות',projects:'יצירת פרויקטים',tasks:'יצירת משימות',drafts:'טיוטות תשובה',spam:'סינון ספאם',classification:'סיווג הודעות',followups:'מעקבים אוטומטיים'}).map(([k,label])=>select(k,label,modes,s.automation[k]||(k==='followups'?'suggest':'off'))).join('')+'</div><p class="setting-help">מצב הצעה מחכה לאישור שלך. טיוטות אינן נשלחות מעצמן.</p><div class="settings-grid"><label>המתנה לתשובה (שעות)<input name="waitingHours" type="number" min="1" max="2160" value="'+Number(s.followups?.waitingHours??48)+'"></label><label>משימה באיחור (שעות)<input name="overdueHours" type="number" min="0" max="2160" value="'+Number(s.followups?.overdueHours??24)+'"></label>'+select('followupMode','פעולת מעקב',[['remind','תזכורת בלבד'],['draft_follow_up','טיוטת המשך לשיחה']],s.followups?.mode||'remind')+'</div></section><section class="panel"><h2>שליחת הודעות</h2>'+select('policy','מדיניות אישור',[['always_confirm','אישור לכל פעולה'],['confirm_sensitive','אישור לפעולות רגישות'],['auto_send_trusted','שליחה אוטומטית לאנשי קשר מהימנים'],['never_auto_send','לעולם לא לשלוח אוטומטית']],s.messaging.policy)+select('defaultAccountId','חשבון ברירת מחדל',[['','לפי השיחה'],...accounts.items.map(a=>[a.id,a.label||a.identifier])],s.messaging.defaultAccountId)+'<label>מזהי לקוחות מהימנים, מופרדים בפסיק<input name="trustedClientIds" value="'+esc(s.messaging.trustedClientIds.join(', '))+'"></label><label>חתימה<textarea name="signature">'+esc(s.messaging.signature)+'</textarea></label><p class="setting-help">שליחה לאיש קשר מהימן תלויה גם בהרשאות ובזיהוי חד משמעי של הנמען.</p></section><div class="panel"><button class="btn primary" type="submit">שמירת הגדרות</button></div></form><section class="panel"><h2>פעולות ברקע</h2>'+backgroundStatus(background)+button('refresh-view','רענון מצב')+(jobs.items.map(j=>'<div class="row"><div><b>'+esc(jobLabel(j.type))+'</b><p>'+esc(statusLabel(j.status))+' · ניסיון '+Number(j.attempts)+' מתוך '+Number(j.max_attempts)+'</p>'+(j.last_error?'<p class="error">'+esc(j.last_error)+'</p>':'')+'</div>'+(j.status==='failed'?button('retry-job','ניסיון נוסף',j.id):'')+'</div>').join('')||empty('אין פעולות בתור.'))+'</section><section class="panel"><h2>אבטחה</h2>'+securityStatus(security)+'<p>חיבורים פעילים מופיעים במסך החיבורים.</p>'+button('security-audit','הצגת יומן הפעולות')+'<div id="auditLog"></div></section>';
}
function inboxState(c){const unread=Number(c.unread_count)||0;return '<span class="tag">'+(unread?unread+' לא נקראו':'נקרא')+'</span> '+(c.last_message_direction==='in'?'<span class="tag">ממתין לתשובה שלך</span>':c.last_message_direction==='out'?'<span class="tag">ממתין לתשובת הצד השני</span>':'');}
function backgroundStatus(s){return '<p role="status">'+(!s.enabled?'עיבוד ברקע כבוי':s.running?'עיבוד ברקע פועל כעת':'עיבוד ברקע פעיל וממתין לעבודה')+'</p><p>ממתינות: '+Number(s.queued||0)+' · נכשלו: '+Number(s.failed||0)+'</p>'+(s.last_error?'<p class="error">'+esc(s.last_error)+'</p>':'');}
function securityStatus(s){const failed=Array.isArray(s.failed_attempts)?s.failed_attempts.reduce((n,x)=>n+Number(x.count||0),0):Number(s.failed_attempts||0);return '<p>מצב כניסה: '+(s.locked?'נעול':'פתוח ומוגן בסיסמה')+'</p><p>ניסיונות כניסה שנכשלו: '+failed+'</p><p>כתובות רשת חסומות: '+(Array.isArray(s.blocked_ips)?s.blocked_ips.map(esc).join(', ')||'אין':Number(s.blocked_ips||0))+'</p>';}
function jobLabel(type){return ({'message.process':'ניתוח הודעה','message.classify':'סיווג הודעה','inbox.intelligence':'ניתוח תיבת הודעות','file.index':'הכנת קובץ לחיפוש','draft.generate':'יצירת טיוטה','reminder.deliver':'הפעלת תזכורת'})[type]||'פעולת מערכת';}
async function saveSettings(f){return api('/api/settings',{method:'PATCH',body:JSON.stringify({ai:{localModel:f.localModel,externalModel:f.externalModel,generativeProvider:f.generativeProvider,temperature:Number(f.temperature),contextSize:Number(f.contextSize),fallback:f.fallback==='true'},automation:Object.fromEntries(['clients','projects','tasks','drafts','spam','classification','followups'].map(k=>[k,f[k]])),followups:{waitingHours:Number(f.waitingHours??48),overdueHours:Number(f.overdueHours??24),mode:f.followupMode||'remind'},messaging:{policy:f.policy,defaultAccountId:f.defaultAccountId,signature:f.signature,trustedClientIds:f.trustedClientIds.split(',').map(x=>x.trim()).filter(Boolean)}})});}
void render(location.hash.slice(1)||'home').catch(e=>$('#error').textContent=e.message);void realtime();

async function renderFollowups(){
 const d=await api('/api/followups');$('#content').innerHTML='<section class="panel"><p>שיחות שממתינות לתשובה ומשימות באיחור. יצירת טיוטה מאפשרת לבדוק ולערוך לפני שליחה.</p>'+button('refresh-view','רענון')+'</section><section class="panel">'+(d.items.map(x=>'<div class="row"><div><b>'+esc(x.title)+'</b><p class="note">'+esc(x.reason||'')+'</p><p class="muted">'+esc(x.due_at||x.anchor_at||'')+'</p></div><div class="actions">'+button('followup-remind','יצירת תזכורת',x.id)+(x.conversation_id?button('followup-draft','טיוטת המשך',x.id)+button('conversation','פתיחת השיחה',x.conversation_id):'')+'</div></div>').join('')||empty('אין כרגע מעקבים שדורשים טיפול.'))+'</section>';
}
async function renderKnowledge(){
 const [articles,candidates]=await Promise.all([api('/api/knowledge'),api('/api/knowledge/candidates')]);knowledgeArticles=articles.items.filter(x=>x.status!=='archived');knowledgeCandidates=candidates.items.filter(x=>x.status==='pending');knowledgeEditing=null;
 const rows=(items,candidate)=>items.map(x=>'<article class="panel"><h3>'+esc(x.title)+'</h3><p class="note">'+esc(x.body)+'</p><div class="actions">'+button(candidate?'knowledge-review':'knowledge-edit',candidate?'בדיקה ועריכה לפני אישור':'עריכת נוהל',x.id)+(!candidate?button('knowledge-archive','ארכיון',x.id):'')+'</div></article>').join('');
 $('#content').innerHTML='<section class="panel"><p>נהלים כלליים שניתן להשתמש בהם בשיחות אחרות. להפקת הצעה, פתח הודעה ולחץ על "הפק נוהל כללי".</p><p>רק תוכן שעברת עליו ואישרת לשימוש כללי נכנס למאגר. הסר שמות, פרטי קשר, מזהים ומידע מסחרי פרטי או ייחודי ללקוח.</p></section><div id="knowledgeEditor"></div><h2>הצעות לבדיקה</h2>'+(rows(knowledgeCandidates,true)||empty('אין הצעות שממתינות לבדיקה.'))+'<h2>נהלים מאושרים</h2>'+(rows(knowledgeArticles,false)||empty('עדיין אין נהלים מאושרים.'));
}
function renderKnowledgeEditor(item){
 $('#knowledgeEditor').innerHTML='<form id="knowledgeForm" class="panel"><h2>בדיקת נוהל לשימוש כללי</h2><label>כותרת<input name="title" required maxlength="255" value="'+esc(item.title)+'"></label><label>תוכן כללי<textarea name="body" required maxlength="12000" rows="10">'+esc(item.body)+'</textarea></label><label><input type="checkbox" name="reviewed" required> עברתי על הנוסח, הסרתי מידע אישי, מידע מסחרי פרטי ופרטים ייחודיים ללקוח, והוא מתאים לשימוש בשיחות אחרות.</label><div class="actions"><button type="submit" class="btn primary">אישור ושמירת הנוהל</button>'+button('knowledge-cancel','ביטול')+'</div></form>';
}
async function saveKnowledge(fields){
 if(!knowledgeEditing)return;
 if(fields.reviewed!=='on')throw Error('יש לעבור על הנוסח ולאשר שהוא מתאים לשימוש כללי.');
 const title=String(fields.title||'').trim(),body=String(fields.body||'').trim();if(!title||!body)throw Error('יש למלא כותרת ותוכן.');
 if(!confirm('לאשר את הנוהל הערוך לשימוש בשיחות אחרות? יש לוודא שאין בו מידע אישי או מידע ייחודי ללקוח.'))return;
 const {id,candidate}=knowledgeEditing;await api('/api/knowledge/'+(candidate?'candidates/':'')+encodeURIComponent(id)+(candidate?'/approve':''),{method:candidate?'POST':'PATCH',body:JSON.stringify({title,body,reviewed:true})});await render('knowledge');$('#notice').textContent='הנוהל אושר ונשמר לשימוש כללי.';
}

let localAiRefresh=null;
async function renderLocalAi(){
 clearTimeout(localAiRefresh);
 const d=await api('/api/ai/status');if(view!=='ai')return;
 const memory=m=>m?['rss','heapUsed','external'].map(k=>({rss:'זיכרון פיזי',heapUsed:'זיכרון JavaScript',external:'זיכרון חיצוני'})[k]+': '+(Number(m[k]||0)/1048576).toFixed(1)+' MB').join(' · '):'טרם נמדד';
 const states={idle:'ממתין לטעינה',loaded:'טעון',loading:'נטען',failed:'נכשל'};
 $('#content').innerHTML='<div class="panel"><h2>Tiny Local AI — מודל מקומי זעיר</h2><p>שימוש: סיווג וחילוץ בסיסי בלבד. צ׳אט וטיוטות דורשים ספק חיצוני.</p><p>מודל מוגדר: '+esc(d.model)+'</p><p>מקור הטוקנייזר: '+esc(d.tokenizer_source||'—')+'</p><p>המודל שנוסה: '+esc(d.attempted_model||'טרם נוסה')+'</p><p>הטוקנייזר שנוסה: '+esc(d.attempted_tokenizer||'טרם נוסה')+'</p><p>כימות (dtype): '+esc(d.dtype||'—')+'</p><p>מופעל: '+(d.enabled?'כן':'לא')+'</p><p role="status">מצב מנוע: '+esc(states[d.state]||'ממתין לטעינה')+'</p><p>זמן טעינה: '+(d.load_duration_ms==null?'טרם נמדד':(Number(d.load_duration_ms)/1000).toFixed(1)+' שניות')+'</p><p>זמן יצירת פלט: '+(d.inference_duration_ms==null?'טרם נמדד':(Number(d.inference_duration_ms)/1000).toFixed(2)+' שניות')+'</p><p>השהיה לאחר כשל: '+Math.ceil(Number(d.cooldown_remaining_ms||0)/1000)+' שניות</p><p>תחילת טעינה: '+esc(d.started_at||'—')+'</p><p>סיום טעינה: '+esc(d.finished_at||'—')+'</p>'+(d.error?'<p class="error">'+esc(d.error.message)+' ('+esc(d.error.code)+')</p>':'')+'<p>Inference: '+esc(d.inference_status||'idle')+'</p><p>Label validation: '+esc(d.structured_status||'idle')+'</p>'+ (d.output_error?'<p class="error">'+esc(d.output_error.message)+'</p>':'')+'<h2>זיכרון התהליכים לפני ואחרי הטעינה</h2><p>CRM לפני: '+esc(memory(d.memory_before))+'</p><p>CRM אחרי: '+esc(memory(d.memory_after))+'</p><p>תהליך המודל לפני: '+esc(memory(d.worker_memory_before))+'</p><p>תהליך המודל אחרי: '+esc(memory(d.worker_memory_after))+'</p><p>זיכרון שיא בתהליך המודל: '+(d.worker_memory_peak==null?'טרם נמדד':(Number(d.worker_memory_peak)/1048576).toFixed(1)+' MB')+'</p><p>אחרי יצירת פלט: '+esc(memory(d.worker_memory_inference_after))+'</p><p>MB = מגה־בייט. במקרה של קריסת התהליך ייתכן שלא תהיה מדידת סיום.</p><button class="btn" data-action="local-ai-test" '+(!d.enabled||d.loading||d.test_running||d.cooldown_remaining_ms>0?'disabled':'')+'>בדיקת מודל מקומי (Test Local AI)</button> '+button('refresh-view','רענון מצב')+'<p role="status">'+(d.test_running?'בדיקת טעינה וסיווג הודעה מתבצעת ברקע…':d.test_result?.ok?'הבדיקה הצליחה: כל ההחלטות תאמו לתשובות הצפויות.':d.test_result?.error?esc(d.test_result.error.message):'')+ '</p>'+(d.test_result?.cases||[]).map(g=>'<h3>'+esc(g.language==='en'?'English':'עברית')+'</h3>'+g.decisions.map(c=>'<p>'+esc(c.workload)+': '+esc(c.label||c.error?.code||'—')+' '+(c.matched?'✓':'✗')+' | '+esc(c.inference_ms??'—')+' ms | Peak RSS: '+(c.peak_rss==null?'—':(c.peak_rss/1048576).toFixed(1))+' MB</p><p>Test raw output:</p><pre>'+esc(c.raw_output||'')+'</pre>').join('')).join('')+'<p>משך הבדיקה הכולל: '+esc(d.test_result?.total_duration_ms??'—')+' ms</p>' +'<p>הבדיקה משתמשת בטקסט קבוע בלבד, ללא נתוני לקוחות וללא ספק גיבוי.</p><p>גיבוי חיצוני: '+(d.fallback_configured?'מוגדר':'לא מוגדר')+'</p></div>';
 if(d.loading||d.loaded||d.test_running||d.cooldown_remaining_ms>0)localAiRefresh=setTimeout(()=>{if(view==='ai')void renderLocalAi().catch(()=>{$('#error').textContent='לא ניתן לרענן את מצב המודל.';});},2000);
}
