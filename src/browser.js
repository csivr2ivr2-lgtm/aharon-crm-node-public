/* Browser-only UI. Record data is escaped and never inserted into executable attributes. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={assistant:'העוזר האישי',spam:'דואר זבל',suggestions:'הצעות חכמות',reminders:'תזכורות',notifications:'התראות',files:'קבצים',home:'ראשי',inbox:'תיבת הודעות',clients:'לקוחות',projects:'פרויקטים',tasks:'משימות',systems:'מערכות',accounts:'חשבונות',connectors:'חיבורים',ai:'בינה מלאכותית',settings:'הגדרות'};
const entityNames={clients:'client',projects:'project',tasks:'task',systems:'system',accounts:'account'};
let view='home',records=[],conversation='',requestId='',editing=null;
let assistantMessages=[], pendingActions=[], showArchived=false;
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
  const d=await api('/api/inbox'+(view==='spam'?'?folder=spam':''));$('#content').innerHTML='<div class="panel">'+button('sync','סנכרון')+(d.items.length?d.items.map(c=>'<div class="row"><div><b>'+esc(c.title)+'</b><div class="muted">'+esc(channel(c))+' · '+esc(c.last_message_at)+'</div></div><div><span class="tag">'+Number(c.unread_count)+'</span> '+button('conversation','פתיחה',c.id)+'</div></div>').join(''):'<p class="empty">אין הודעות עדיין. יש לחבר חשבון ולסנכרן.</p>')+'</div>';return;
 }
 if(entityNames[view]){
  const d=await api('/api/'+view+(showArchived?'?include_archived=1':''));records=d.items;$('#content').innerHTML='<div class="panel">'+button('create','הוספה')+(['projects','systems'].includes(view)?button('toggle-archived',showArchived?'הסתר ארכיון':'הצג ארכיון'):'')+'</div><div class="panel">'+(records.map(x=>'<div class="row"><div><b>'+esc(x.name||x.title||x.did||x.label)+'</b><div class="muted">'+esc([statusLabel(x.status),x.email,x.phone,x.identifier,statusLabel(x.automation_mode),statusLabel(x.worker_state)].filter(Boolean).join(' · '))+'</div><div class="note">'+esc(x.description||x.notes||'')+'</div>'+(x.next_step?'<p>הצעד הבא: '+esc(x.next_step)+'</p>':'')+(x.worker_result?'<p class="draft note">'+esc(x.worker_result)+'</p>':'')+'</div><div>'+button('edit','עריכה',x.id||x.did)+button('notes','הערות',x.id||x.did)+(['projects','systems'].includes(view)?lifecycleButtons(x):'')+'</div></div>').join('')||'<p class="empty">אין רשומות.</p>')+'</div>';return;
 }
 if(view==='files'){await renderFiles();return;}
 if(view==='connectors'){
  const d=await api('/api/connectors');$('#content').innerHTML='<div class="panel">'+d.connectors.map(x=>'<div class="row"><div><b>'+esc(x.key)+'</b><p>'+esc(x.configured?'מוגדר':'לא מוגדר')+' · '+esc(x.status||'')+'</p>'+(x.accounts||[]).map(a=>'<p>'+esc(a.email)+'</p>').join('')+'</div></div>').join('')+'</div><div class="panel">'+button('google','הוסף חשבון Google')+'<p class="muted">אישור מאובטח לחיבור דואר, יומן וקבצים בחשבון שלך.</p>'+'</div><div class="panel"><h2>WhatsApp — חיבור טלפון</h2><p>פתח במכשיר את המכשירים המקושרים וסרוק את הקוד.</p><div id="wa"></div><div class="actions">'+button('wa-connect','חבר WhatsApp')+button('wa-connect','חיבור מחדש')+button('wa-refresh','רענון קוד סריקה')+button('wa-logout','ניתוק חשבון')+'</div></div>';await loadWa();$('#content').insertAdjacentHTML('beforeend','<form id="mailSetup" class="panel"><h2>הוסף דואר Hostinger</h2><p>החיבור נבדק לפני שמירת החשבון.</p><label>כתובת אימייל<input type="email" name="email" autocomplete="username" required></label><label>סיסמת הדואר<input type="password" name="password" autocomplete="new-password" required></label><button class="btn primary" type="submit">בדיקה וחיבור</button><p id="mailStatus" role="status"></p></form>');return;
 }
 if(view==='ai'){
  const d=await api('/api/ai/status');$('#content').innerHTML='<div class="panel"><p>מודל מקומי: '+esc(d.model)+'</p><p>מופעל: '+(d.enabled?'כן':'לא')+'</p><p>מצב: '+(d.loaded?'טעון':d.loading?'נטען':'יטען בבקשה הראשונה')+'</p><p>גיבוי חיצוני: '+(d.fallback_configured?'מוגדר':'לא מוגדר')+'</p><p>המודל מורד בבקשה הראשונה. טיוטות ותוצאות דורשות בדיקה שלך לפני שליחה.</p></div>';return;
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
 $('#content').innerHTML='<div class="panel actions"><label>לקוח<select id="convClient">'+options(clients.items,d.item.client_id)+'</select></label><label>פרויקט<select id="convProject">'+options(projects.items,d.item.project_id)+'</select></label>'+button('associate','שמירת שיוך')+'</div><div class="panel conversation">'+d.messages.map(m=>'<div class="bubble '+(m.direction==='out'?'out':'')+'"><b>'+esc(m.direction==='out'?'נשלח':'נכנס')+' · '+esc(m.sender)+'</b>'+classificationHtml(m)+'<div>'+esc(m.body)+'</div><div class="muted">'+esc(m.sent_at)+(m.cc?' · העתק: '+esc(m.cc):'')+'</div></div>').join('')+'</div><div class="panel"><label>תשובה<textarea id="reply"></textarea></label><label>הנחיה לבינה המלאכותית<input id="instruction"></label><div class="actions">'+button('draft','יצירת טיוטה מחדש')+button('save-draft','שמירת עריכה')+button('reject-draft','דחיית טיוטה')+button('send','אישור ושליחה')+'</div><p id="draftInfo" role="status">טיוטה אינה נשלחת אוטומטית.</p></div>';
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



function userError(code){const errors={confirmation_expired_or_used:'האישור פג תוקף או שכבר נעשה בו שימוש. בקש מהעוזר להכין את הפעולה מחדש.',destination_changed_request_new_confirmation:'פרטי הנמען השתנו. יש להכין את ההודעה מחדש ולקבל אישור חדש.',invalid_confirmation:'האישור אינו תקין. בקש להכין את הפעולה מחדש.',invalid_settings:'יש לבדוק את ערכי ההגדרות.',tool_permission_denied:'אין הרשאה לביצוע הפעולה.',not_found:'הרשומה לא נמצאה.',invalid_draft:'הטיוטה אינה זמינה לשליחה. יש לרענן את השיחה.',action_failed_review_required:'הפעולה לא הושלמה בוודאות. יש לבדוק את יומן הפעולות לפני ניסיון נוסף.',file_type_not_editable:'לא ניתן לערוך את סוג הקובץ הזה.',connection_failed:'החיבור נכשל. בדוק את פרטי החשבון.'};return errors[code]||(/[\u0590-\u05ff]/.test(String(code))?String(code):'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.');}
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
  const d=await api('/api/suggestions');records=d.items;$('#content').innerHTML='<div class="panel">'+(d.items.map(x=>'<div class="row"><div><b>'+esc(x.title||x.summary||statusLabel(x.type||x.kind))+'</b><p class="note">'+esc(x.reason||x.description||'')+'</p><p class="muted">רמת ביטחון: '+Math.round(Number(x.confidence||0)*100)+'% · '+esc(statusLabel(x.status))+'</p>'+previewArgs(x.payload||x.data||{})+'</div><div class="actions">'+(x.status==='pending'?button('suggestion-approve','אישור',x.id)+button('suggestion-ignore','התעלמות',x.id)+(String(x.type||x.kind).includes('project')?button('suggestion-merge','מיזוג לפרויקט',x.id):''):'')+'</div></div>').join('')||empty('אין הצעות שממתינות לבדיקה.'))+'</div>';return true;
 }
 if(page==='reminders'){
  const d=await api('/api/reminders');$('#content').innerHTML='<form id="reminderForm" class="panel"><h2>תזכורת חדשה</h2><div class="form-inline"><label>מה להזכיר?<input name="title" required maxlength="500"></label><label>מתי?<input name="due_at" type="datetime-local" required></label><button class="btn primary" type="submit">יצירה</button></div></form><div class="panel">'+(d.items.map(r=>'<div class="row"><div><b>'+esc(r.title)+'</b><p>'+esc(r.due_at)+' · '+esc(statusLabel(r.status))+'</p></div>'+(r.status!=='done'?button('reminder-done','בוצע',r.id):'')+'</div>').join('')||empty('אין תזכורות.'))+'</div>';return true;
 }
 if(page==='settings'){await renderSettings();return true;}
 return false;
}
function previewArgs(args){const fields={recipient:'נמען',client:'לקוח',account:'חשבון שולח',account_key:'מזהה חשבון',subject:'נושא',body:'תוכן',to:'נמען',client_id:'לקוח',project_id:'פרויקט',title:'כותרת',name:'שם',due_date:'תאריך יעד',did:'מספר מערכת',conversation_id:'שיחה',query:'חיפוש',notes:'הערות',description:'תיאור',content:'תוכן הקובץ',id:'מזהה',channel:'ערוץ'};return '<div class="note">'+Object.entries(args||{}).filter(([k])=>k!=='account_key').map(([k,v])=>esc(fields[k]||k)+': '+esc(typeof v==='object'?JSON.stringify(v):v)).join('\n')+'</div>';}
function renderChat(){
 const log=$('#chatLog');if(!log)return;
 log.innerHTML=assistantMessages.map(m=>'<div class="bubble '+(m.role==='user'?'out':'')+'"><b>'+esc(m.role==='user'?'אתה':'העוזר')+'</b><div class="note">'+esc(m.text)+'</div></div>').join('')+pendingActions.map(a=>'<div class="panel draft"><h3>'+esc(toolLabel(a.tool)||a.summary||'פעולה לבדיקה')+'</h3>'+previewArgs(a.preview||a.args)+'<div class="actions">'+(a.status==='pending'?button('assistant-confirm','אישור וביצוע',a.id)+button('assistant-dismiss','ביטול',a.id):'<span class="tag">'+esc(statusLabel(a.status))+'</span>')+'</div></div>').join('');log.scrollTop=log.scrollHeight;
}
async function renderFiles(q=''){
 const [d,c,p,t]=await Promise.all([api('/api/files?q='+encodeURIComponent(q)),api('/api/clients'),api('/api/projects'),api('/api/tasks')]);records=d.items;
 const options=items=>'<option value="">ללא שיוך</option>'+items.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.title)+'</option>').join('');
 $('#content').innerHTML='<div class="panel"><form id="fileSearch" class="form-inline"><label>חיפוש בשם ובתוכן<input name="q" value="'+esc(q)+'"></label><button class="btn" type="submit">חיפוש</button></form><label>קובץ חדש (עד 25MB)<input id="fileInput" type="file"></label><div class="settings-grid"><label>לקוח<select id="fileClient">'+options(c.items)+'</select></label><label>פרויקט<select id="fileProject">'+options(p.items)+'</select></label><label>משימה<select id="fileTask">'+options(t.items)+'</select></label></div><div class="actions">'+button('upload','העלאה')+button('file-create','יצירת קובץ טקסט')+'</div></div><div class="panel">'+(d.items.map(f=>'<div class="row"><div><a href="/api/files/'+encodeURIComponent(f.id)+'/download">'+esc(f.name)+'</a><p class="muted">'+Number(f.size_bytes)+' בתים · '+esc(f.index_status||'')+'</p></div><div class="actions">'+button('file-read','תוכן',f.id)+button('file-summary','סיכום',f.id)+button('file-rename','שינוי שם',f.id)+button('file-move','העברה לתיקייה',f.id)+button('file-associate','שמירת שיוכים',f.id)+button('file-edit','עריכת טקסט',f.id)+button('file-archive','ארכיון',f.id)+button('file-delete','מחיקה',f.id)+'</div></div>').join('')||empty('לא נמצאו קבצים.'))+'</div><div id="filePreview"></div>';
}
async function intelligenceAction(action,b){
 const id=b.dataset.id, patch=(url,data)=>api(url,{method:'PATCH',body:JSON.stringify(data)});
 if(action==='refresh-view'){await render(view);}
 else if(action==='security-audit'){const d=await api('/api/audit');$('#auditLog').innerHTML=d.items.map(x=>'<div class="row"><div><b>'+esc(x.action)+'</b><p>'+esc(x.reason||'')+'</p><span class="muted">'+esc(x.actor)+' · '+esc(x.created_at)+'</span></div></div>').join('')||empty('אין פעולות ביומן.');}
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
  if(action==='file-archive'||action==='file-delete'){if(!confirm(action==='file-delete'?'למחוק את הקובץ?':'להעביר את הקובץ לארכיון?'))return true;await post(path+'/lifecycle',{action:action==='file-delete'?'delete':'archive',confirmed:true});}
  await renderFiles();
 }
 else return false;
 return true;
}
document.addEventListener('submit',async e=>{
 const form=e.target;if(!['assistantForm','mailSetup','reminderForm','settingsForm','fileSearch'].includes(form.id))return;e.preventDefault();const submit=e.submitter;submit.disabled=true;$('#error').textContent='';
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
  if(form.id==='settingsForm'){await saveSettings(fields);$('#notice').textContent='ההגדרות נשמרו';}
 }catch(error){$('#error').textContent=error.message;}finally{submit.disabled=false;}
});
async function renderSettings(){
 const [d,jobs,accounts]=await Promise.all([api('/api/settings'),api('/api/jobs'),api('/api/accounts')]);const s=d.settings;
 const select=(name,label,values,current)=>'<label>'+label+'<select name="'+name+'">'+optionHtml(values,current)+'</select></label>';
 const modes=[['off','כבוי'],['suggest','הצעה לאישור'],['automatic','אוטומטי']];
 $('#content').innerHTML='<form id="settingsForm"><section class="panel"><h2>בינה מלאכותית</h2><div class="settings-grid">'+select('provider','ספק',[['auto','בחירה אוטומטית'],['local','מקומי'],['external','חיצוני']],s.ai.provider)+'<label>שם המודל<input name="model" value="'+esc(s.ai.model)+'"></label><label>מידת יצירתיות<input name="temperature" type="number" min="0" max="2" step="0.1" value="'+Number(s.ai.temperature)+'"></label><label>גודל ההקשר<input name="contextSize" type="number" min="2000" max="64000" value="'+Number(s.ai.contextSize)+'"></label>'+select('fallback','מעבר לספק גיבוי',[['true','מופעל'],['false','כבוי']],String(s.ai.fallback))+'</div></section><section class="panel"><h2>אוטומציות</h2><div class="settings-grid">'+Object.entries({clients:'יצירת לקוחות',projects:'יצירת פרויקטים',tasks:'יצירת משימות',drafts:'טיוטות תשובה',spam:'סינון ספאם',classification:'סיווג הודעות'}).map(([k,label])=>select(k,label,modes,s.automation[k])).join('')+'</div><p class="setting-help">מצב הצעה מחכה לאישור שלך. טיוטות אינן נשלחות מעצמן.</p></section><section class="panel"><h2>שליחת הודעות</h2>'+select('policy','מדיניות אישור',[['always_confirm','אישור לכל פעולה'],['confirm_sensitive','אישור לפעולות רגישות'],['auto_send_trusted','שליחה אוטומטית לאנשי קשר מהימנים'],['never_auto_send','לעולם לא לשלוח אוטומטית']],s.messaging.policy)+select('defaultAccountId','חשבון ברירת מחדל',[['','לפי השיחה'],...accounts.items.map(a=>[a.id,a.label||a.identifier])],s.messaging.defaultAccountId)+'<label>מזהי לקוחות מהימנים, מופרדים בפסיק<input name="trustedClientIds" value="'+esc(s.messaging.trustedClientIds.join(', '))+'"></label><label>חתימה<textarea name="signature">'+esc(s.messaging.signature)+'</textarea></label><p class="setting-help">שליחה לאיש קשר מהימן תלויה גם בהרשאות ובזיהוי חד משמעי של הנמען.</p></section><div class="panel"><button class="btn primary" type="submit">שמירת הגדרות</button></div></form><section class="panel"><h2>פעולות ברקע</h2>'+button('refresh-view','רענון מצב')+(jobs.items.map(j=>'<div class="row"><div><b>'+esc(jobLabel(j.type))+'</b><p>'+esc(statusLabel(j.status))+' · ניסיון '+Number(j.attempts)+' מתוך '+Number(j.max_attempts)+'</p>'+(j.last_error?'<p class="error">'+esc(j.last_error)+'</p>':'')+'</div>'+(j.status==='failed'?button('retry-job','ניסיון נוסף',j.id):'')+'</div>').join('')||empty('אין פעולות בתור.'))+'</section><section class="panel"><h2>אבטחה</h2><p>הגישה מוגנת בסיסמת המערכת. חיבורים פעילים מופיעים במסך החיבורים.</p>'+button('security-audit','הצגת יומן הפעולות')+'<div id="auditLog"></div></section>';
}
function jobLabel(type){return ({'message.process':'ניתוח הודעה','message.classify':'סיווג הודעה','inbox.intelligence':'ניתוח תיבת הודעות','file.index':'הכנת קובץ לחיפוש','draft.generate':'יצירת טיוטה','reminder.deliver':'הפעלת תזכורת'})[type]||'פעולת מערכת';}
async function saveSettings(f){return api('/api/settings',{method:'PATCH',body:JSON.stringify({ai:{provider:f.provider,model:f.model,temperature:Number(f.temperature),contextSize:Number(f.contextSize),fallback:f.fallback==='true'},automation:Object.fromEntries(['clients','projects','tasks','drafts','spam','classification'].map(k=>[k,f[k]])),messaging:{policy:f.policy,defaultAccountId:f.defaultAccountId,signature:f.signature,trustedClientIds:f.trustedClientIds.split(',').map(x=>x.trim()).filter(Boolean)}})});}
void render(location.hash.slice(1)||'home').catch(e=>$('#error').textContent=e.message);void realtime();
