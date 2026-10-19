/* Browser-only UI. Record data is escaped and never inserted into executable attributes. */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={followups:'מעקבים',knowledge:'ידע עסקי',assistant:'העוזר האישי',spam:'דואר זבל',suggestions:'הצעות חכמות',reminders:'תזכורות',notifications:'התראות',files:'קבצים',home:'ראשי',inbox:'תיבת הודעות',sent:'נשלחו',drafts:'טיוטות',updates:'עדכונים ומערכת',clients:'לקוחות',projects:'פרויקטים',tasks:'משימות',systems:'מערכות',accounts:'חשבונות',connectors:'חיבורים',ai:'בינה מלאכותית',settings:'הגדרות'};
const entityNames={clients:'client',projects:'project',tasks:'task',systems:'system',accounts:'account'};
let view='home',records=[],conversation='',requestId='',editing=null;
let knowledgeCandidates=[],knowledgeArticles=[],knowledgeEditing=null;
let assistantMessages=[], pendingActions=[], showArchived=false, showArchivedFiles=false, fileQuery='';
let visitRecorded=false;
let entityLayout='list',entityFilters={query:'',status:''};
let workView='inbox',workCursor='',workDone=false,workFilters={},workPending=new Map(),conversationWork=null;
let inboxItems=[],inboxQuery='',inboxFilter='all',assistantBusy=false;
let sentCursor='',sentItems=[],sentDone=false;
let conversationOutbox=new Map();
function phoneForDisplay(value){
 const original=String(value||'').trim();
  if(/@lid$/i.test(original)||original.startsWith('איש קשר WhatsApp (מזהה פרטי'))return 'מספר WhatsApp לא זמין';
  if(/@g\.us$/i.test(original))return 'קבוצת WhatsApp · '+original.split('@')[0].slice(-4);
  const raw=original.replace(/@s\.whatsapp\.net$/i,'');
 if(!/^\+?[0-9 ()\-.]{9,24}$/.test(raw))return String(value||'');
 const number=raw.replace(/\D/g,'');
 if(/^972[2-9]\d{7,8}$/.test(number))return '0'+number.slice(3);
 if(/^0[2-9]\d{7,8}$/.test(number))return number;
 return number.length>=9&&number.length<=15?'+'+number:String(value||'');
}
const displayContact=(value,kind)=>kind==='whatsapp'?phoneForDisplay(value):String(value||'');
let assistantSession='',assistantSessions=[];
let historyTriageCursor=readHistoryCursor(),conversationReplyEligible=true;
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
  await renderWorkDashboard();
  try{await renderRecentChangesBrief();}catch{ $('#content').insertAdjacentHTML('beforeend','<section class="panel"><p class="muted">סקירת 24 השעות האחרונות אינה זמינה כרגע. תור העבודה עדיין פועל.</p></section>'); }
  return;
 }
 if(await renderIntelligence(view))return;
 if(view==='sent'){await renderSentMessages();return;}
 if(view==='drafts'){await renderDraftOverview();return;}
 if(view==='inbox'||view==='spam'||view==='updates'){
  if(view==='spam')workView='spam';else if(view==='updates')workView='updates';else if(['spam','updates'].includes(workView))workView='inbox';
  await renderWorkInbox();return;
 }
 if(['tasks','projects'].includes(view)){
  const d=await api('/api/'+view+(showArchived?'?include_archived=1':''));records=d.items;
  const {renderWorkView}=await import('/assets/work-views.js');
  $('#content').innerHTML=renderWorkView({items:records,layout:entityLayout,...entityFilters,
   statusLabel,button,renderRow:x=>'<div class="row"><div><b>'+esc(x.name||x.title||x.did||x.label)+'</b><div class="muted">'+esc([statusLabel(x.status),x.email,x.phone,x.identifier,statusLabel(x.automation_mode),statusLabel(x.worker_state)].filter(Boolean).join(' · '))+'</div><div class="note">'+esc(x.description||x.notes||'')+'</div>'+(x.next_step?'<p>הצעד הבא: '+esc(x.next_step)+'</p>':'')+(x.worker_result?'<p class="draft note">'+esc(x.worker_result)+'</p>':'')+'</div><div>'+(view==='clients'?button('client-360','תיק לקוח 360°',x.id):'')+button('edit','עריכה',x.id||x.did)+button('notes','הערות',x.id||x.did)+(['projects','systems'].includes(view)?lifecycleButtons(x):'')+'</div></div>'});
  if(view==='projects')$('#content').insertAdjacentHTML('afterbegin','<div class="panel">'+button('toggle-archived',showArchived?'הסתר ארכיון':'הצג ארכיון')+'</div>');
  return;
 }
 if(entityNames[view]){
  const d=await api('/api/'+view+(showArchived?'?include_archived=1':''));records=d.items;$('#content').innerHTML='<div class="panel">'+button('create','הוספה')+(['projects','systems'].includes(view)?button('toggle-archived',showArchived?'הסתר ארכיון':'הצג ארכיון'):'')+'</div><div class="panel">'+(records.map(x=>'<div class="row"><div><b>'+esc(x.name||x.title||x.did||x.label)+'</b><div class="muted">'+esc([statusLabel(x.status),x.email,x.phone,x.identifier,statusLabel(x.automation_mode),statusLabel(x.worker_state)].filter(Boolean).join(' · '))+'</div><div class="note">'+esc(x.description||x.notes||'')+'</div>'+(x.next_step?'<p>הצעד הבא: '+esc(x.next_step)+'</p>':'')+(x.worker_result?'<p class="draft note">'+esc(x.worker_result)+'</p>':'')+'</div><div>'+(view==='clients'?button('client-360','תיק לקוח 360°',x.id):'')+button('edit','עריכה',x.id||x.did)+button('notes','הערות',x.id||x.did)+(['projects','systems'].includes(view)?lifecycleButtons(x):'')+'</div></div>').join('')||'<p class="empty">אין רשומות.</p>')+'</div>';return;
 }
 if(view==='files'){await renderFiles();return;}
 if(view==='connectors'){
  const d=await api('/api/connectors');$('#content').innerHTML='<div class="panel">'+d.connectors.map(x=>'<div class="row"><div><b>'+esc(({google:'Google', 'hostinger-mail':'דואר Hostinger',whatsapp:'WhatsApp'})[x.key]||x.key)+'</b><p>'+esc(x.configured?'מוגדר':'לא מוגדר')+' · '+esc(statusLabel(x.status))+'</p>'+(x.accounts||[]).map(a=>'<p>'+esc(a.email)+' '+button('gmail-folders','תוויות ותיקיות',a.id)+' '+button('google-status','מצב סנכרון והרשאות',a.id)+' '+button('google-calendar','יומן Google',a.id)+' '+button('google-drive','חיפוש Drive',a.id)+' '+button('drive-mirror','שינויי Drive',a.id)+' '+button('people-mirror','אנשי קשר Google',a.id)+' '+button('people-permission','הרשאת קריאת אנשי קשר',a.id)+' '+button('google-disconnect','ניתוק החשבון',a.id)+'</p>').join('')+(x.key==='hostinger-mail'&&x.configured?'<p>'+esc(x.account)+' '+button('hostinger-folders','תיקיות דואר')+' '+button('hostinger-disconnect','ניתוק הדואר')+'</p>':'')+'</div></div>').join('')+'</div><div class="panel">'+button('google','הוסף חשבון Google')+'<p class="muted">אישור מאובטח לחיבור דואר, יומן וקבצים בחשבון שלך.</p>'+'</div><div class="panel"><h2>WhatsApp — חשבונות מקושרים</h2><p>לכל מספר סשן נפרד. קוד הקישור מוצג כאן ומוזן בטלפון הראשי.</p><div id="wa"></div><form id="waPairForm"><label>מספר WhatsApp חדש עם קידומת מדינה וללא +<input name="phone_number" inputmode="numeric" pattern="[1-9][0-9]{7,14}" required autocomplete="tel" placeholder="972501234567"></label><button class="btn primary" type="submit">הוסף חשבון וקבל קוד קישור</button><p class="muted">בטלפון: WhatsApp ← מכשירים מקושרים ← קישור מכשיר ← קישור באמצעות מספר טלפון.</p></form></div>';await loadWa();$('#content').insertAdjacentHTML('beforeend','<section id="providerFolders" class="panel" role="region" aria-label="תיקיות ספק דואר" hidden></section>');$('#content').insertAdjacentHTML('beforeend','<form id="mailSetup" class="panel"><h2>הוסף דואר Hostinger</h2><p>החיבור נבדק לפני שמירת החשבון.</p><label>כתובת אימייל<input type="email" name="email" autocomplete="username" required></label><label>סיסמת הדואר<input type="password" name="password" autocomplete="new-password" required></label><button class="btn primary" type="submit">בדיקה וחיבור</button><p id="mailStatus" role="status"></p></form>');return;
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
function formatDate(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(d):String(value||'');}
function renderInboxItems(){
 const root=$('#inboxItems');if(!root)return;
 const q=inboxQuery.trim().toLowerCase();
 const rows=inboxItems.filter(x=>(inboxFilter!=='unread'||Number(x.unread_count||0)>0)&&(!q||[x.title,x.channel,x.integration_key].some(v=>String(v||'').toLowerCase().includes(q))));
 root.innerHTML=rows.map(x=>'<article class="inbox-item"><span class="inbox-avatar">'+esc(String(x.title||'ש').charAt(0))+'</span><div class="inbox-copy"><strong>'+esc(displayContact(x.title||x.external_id||'שיחה ללא נושא',x.channel))+'</strong><span class="muted">'+esc(channel(x))+' · '+esc(formatDate(x.last_message_at))+'</span>'+inboxState(x)+'</div>'+(Number(x.unread_count||0)>0?'<span class="unread-count">'+Number(x.unread_count)+'</span>':'')+button('conversation','פתיחה',x.id)+'</article>').join('')||'<div class="empty-state"><i class="bi bi-inbox"></i><p>לא נמצאו שיחות מתאימות</p></div>';
 root.closest('.inbox-hub')?.querySelectorAll('[data-action="inbox-filter"]').forEach(btn=>{btn.classList.toggle('active',btn.dataset.id===inboxFilter);btn.setAttribute('aria-pressed',String(btn.dataset.id===inboxFilter));});
}
const syncErrorLabel=code=>({auth_expired:'נדרש חיבור חשבון מחדש',gmail_api_disabled:'Gmail API כבוי בפרויקט Google Cloud – יש להפעילו',gmail_scope_missing:'חסרה הרשאת Gmail – יש לחבר את החשבון מחדש עם הרשאות קריאת דואר',permission_denied:'Google החזיר 403 – יש לבדוק הרשאות, API ומגבלות בפרויקט',rate_limited:'חריגה זמנית ממכסת בקשות',connection_failed:'כשל תקשורת',database_schema_error:'תקלה במבנה מסד הנתונים',db_conflict:'התנגשות בכתיבת הודעה',invalid_message_date:'תאריך הודעה לא תקין',provider_unavailable:'ספק הדואר לא זמין',unknown_error:'שגיאה לא מזוהה – יש לבדוק יומן שרת'})[code]||'שגיאת סנכרון';
function showSyncReport(d){
 const issues=(d.issues||[]).map(i=>'<div class="sync-issue"><b>'+esc(i.source||'חיבור')+'</b><span>'+esc(i.account_id||'')+'</span><span>'+esc(syncErrorLabel(i.error))+' · '+esc(i.stage||'sync')+'</span></div>').join('');
 $('#syncReport')?.remove();
 $('#notice').insertAdjacentHTML('afterend','<section id="syncReport" class="sync-report" role="status"><b>תוצאות סנכרון</b><p>'+Number(d.imported||0)+' חדשות · '+Number(d.duplicates||0)+' קיימות · '+Number(d.errors||0)+' שגיאות</p>'+(issues?'<details open><summary>פירוט שגיאות לפי חשבון</summary>'+issues+'</details>':'<p class="status-ok">לא דווחו שגיאות.</p>')+'</section>');
}
async function showCompose(){
 document.querySelector('#outboundDialog')?.remove();
 const accounts=await api('/api/accounts');
 const available=(accounts.items||[]).filter(a=>a.status==='active'&&/^(google|hostinger|whatsapp):/.test(String(a.integration_key||'')));
 // The dialog must open even if there are no CRM clients or connected sending accounts.
 const chooser=optionHtml([['','בחר חשבון שולח'],...available.map(a=>[a.id,(a.label||a.identifier)+' · '+a.identifier])],'');
 const html='<style>#outboundDialog [hidden]{display:none!important}#outboundDialog{width:min(94vw,570px);max-height:90vh;overflow:auto;padding:24px;border:1px solid #ccc;border-radius:16px;box-shadow:0 18px 65px #0004;background:var(--panel,#fff);color:var(--text,#222)}#outboundDialog::backdrop{background:#0b1629aa;backdrop-filter:blur(3px)}#outboundDialog form{display:grid;gap:12px}#outboundDialog input,#outboundDialog select,#outboundDialog textarea{display:block;width:100%;padding:10px;border-radius:8px}#outboundDialog .composer-actions{display:flex;flex-wrap:wrap;gap:8px}</style>'+
 '<dialog id="outboundDialog" aria-labelledby="composeTitle"><form id="outboundForm"><h2 id="composeTitle">הודעה חדשה</h2>'+
 '<label>ערוץ<select name="channel" id="composeChannel"><option value="email">דוא״ל</option><option value="whatsapp">WhatsApp</option></select></label>'+
 '<label>חשבון שולח<select name="account_id" id="composeAccount" required>'+chooser+'</select></label>'+
 '<label id="composeRecipientLabel">כתובת דוא״ל של הנמען<input name="recipient" type="email" maxlength="255" autocomplete="off" placeholder="name@example.com" required></label>'+
 '<label id="composeSubjectLabel">נושא<input name="subject" maxlength="500" required></label>'+
 '<label id="composeBodyLabel">תוכן הדוא״ל<textarea name="body" maxlength="20000" rows="7" required></textarea></label>'+
 '<p class="muted">שום הודעה לא תישלח לפני הצגת הנמען, החשבון והתוכן ואישור מפורש שלך.</p>'+
 '<div class="composer-actions"><button type="submit" class="btn primary">בדיקה והמשך לאישור</button>'+button('compose-close','ביטול')+'</div><p id="composeStatus" role="status"></p></form></dialog>';
 $('#content').insertAdjacentHTML('beforeend',html);
 const dialog=$('#outboundDialog');dialog.dataset.accounts=JSON.stringify(available.map(a=>({id:a.id,kind:String(a.integration_key||'').split(':')[0],label:a.label||a.identifier,identifier:a.identifier||''})));
 dialog.showModal();refreshCompose();
}
function refreshCompose(){
 const dialog=$('#outboundDialog');if(!dialog)return;
 const channel=dialog.querySelector('#composeChannel').value,account=dialog.querySelector('#composeAccount');
 const available=JSON.parse(dialog.dataset.accounts||'[]').filter(a=>channel==='email'?['google','hostinger'].includes(a.kind):a.kind==='whatsapp');
 const previous=account.value;
 account.innerHTML=optionHtml([['','בחר חשבון שולח'],...available.map(a=>[a.id,a.identifier&&a.identifier!==a.label?a.label+' · '+a.identifier:a.label])],previous);
 const recipient=dialog.querySelector('[name="recipient"]'),subject=dialog.querySelector('#composeSubjectLabel');
 dialog.querySelector('#composeRecipientLabel').firstChild.textContent=channel==='email'?'כתובת דוא״ל של הנמען':'מספר WhatsApp של הנמען';
 recipient.type=channel==='email'?'email':'tel';recipient.placeholder=channel==='email'?'name@example.com':'0501234567 או +972501234567';
 subject.hidden=channel!=='email';subject.querySelector('input').required=channel==='email';
 dialog.querySelector('#composeTitle').textContent=channel==='email'?'דוא״ל חדש':'הודעת WhatsApp חדשה';
 dialog.querySelector('#composeBodyLabel').firstChild.textContent=channel==='email'?'תוכן הדוא״ל':'הודעת WhatsApp';
}
async function showMergeDialog(){
 const current=await api('/api/conversations/'+encodeURIComponent(conversation)),available=await api('/api/conversations?limit=200');
 const choices=(available.items||[]).filter(x=>x.id!==conversation&&x.account_id===current.item.account_id&&x.channel===current.item.channel);
 if(!choices.length)throw Error('אין שיחות נוספות באותו חשבון ובאותו ערוץ.');
 document.querySelector('#threadMergeDialog')?.remove();
 const options=optionHtml([['','בחר שיחה יעד'],...choices.map(x=>[x.id,(x.title||x.external_id||x.id)+' · '+formatDate(x.last_message_at)])],'');
 $('#content').insertAdjacentHTML('beforeend','<dialog id="threadMergeDialog"><form id="threadMergeForm" class="panel"><h3>איחוד שיחות</h3><p>כל ההודעות יעברו לשיחה הנבחרת. ניתן לאחד רק מאותו חשבון וערוץ.</p><label>שיחת יעד<select name="target_id" required>'+options+'</select></label><button type="submit" class="btn primary">איחוד לאחר אישור</button>'+button('thread-close','ביטול')+'<p id="threadMergeStatus" role="status"></p></form></dialog>');
 $('#threadMergeDialog').showModal();
}

function providerStateHtml(message){
 if(!['google.gmail','hostinger.imap'].includes(message.source)||!message.provider_state_json)return '';
 try{
  const state=typeof message.provider_state_json==='string'?JSON.parse(message.provider_state_json):message.provider_state_json;
  if(message.source==='hostinger.imap'){
   if(state.protocol!=='imap')return '<p class="muted">מצב IMAP לא ידוע</p>';
   const read=state.unread===true?'לא נקרא אצל הספק':state.unread===false?'נקרא אצל הספק':'מצב קריאה לא ידוע';
   return '<p class="muted">'+esc('Hostinger · תצפית אחרונה: '+state.folder+' · '+read+' · UID '+state.uid+' / '+state.uid_validity+' · '+formatDate(state.observed_at))+'</p>';
  }
  const names={INBOX:'דואר נכנס',SENT:'נשלחו',DRAFT:'טיוטה',TRASH:'אשפה',SPAM:'ספאם',STARRED:'מסומן בכוכב',IMPORTANT:'חשוב'};
  const labels=Array.isArray(state.labels)?state.labels.filter(x=>x!=='UNREAD').map(x=>names[x]||x).join(' · '):'';
  return '<p class="muted">'+esc('Gmail: '+(state.available===false?'ההודעה אינה זמינה אצל הספק; העותק המקומי נשמר':(state.unread?'לא נקרא אצל הספק':'נקרא אצל הספק')+(labels?' · '+labels:'')))+'</p>';
 }catch{return '<p class="muted">מצב הדואר אצל הספק לא ידוע</p>';}
}
async function showGoogleStatus(id){
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;
 root.hidden=false;root.textContent='טוען מצב סנכרון…';
 const d=await api('/api/google/status?account_id='+encodeURIComponent(id)),p=d.account.permissions||{};
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h2>Gmail — סנכרון והרשאות</h2><p>'+esc(d.account.email)+'</p><p>'+esc(d.incremental_enabled?'סנכרון מדורג פעיל':'סנכרון מדורג כבוי; מתבצע polling רגיל')+'</p><p>'+esc('שלב: '+({full:'סריקה ראשונית',delta:'שינויים בלבד',not_started:'טרם התחיל'}[d.sync.mode]||'לא ידוע'))+'</p><p>'+esc('סנכרון מוצלח אחרון: '+(d.sync.checked_at?formatDate(d.sync.checked_at):'אין checkpoint'))+'</p><p>'+esc(p.known?'הרשאות שניתנו: '+[p.gmail_read?'קריאה':'',p.gmail_send?'שליחה':'',p.gmail_modify?'שינוי תוויות':''].filter(Boolean).join(' · '):'הרשאות החשבון אינן ידועות; פעולות חדשות חסומות')+'</p><p>'+esc(d.writes_enabled?'פעולות שינוי תוויות מופעלות בכפוף להרשאה ולאישור':'פעולות שינוי תוויות כבויות')+'</p>'+
 '<p>הרחבת הרשאה היא לבחירתך: Gmail modify מאפשר קריאה, כתיבה, שליחה ושינוי מצב. ההרשאה ניתנת במסך Google לחשבון זה בלבד.</p>'+button('google-permission','בקשת הרשאה לשינוי מצב Gmail',id);
}

async function openConversation(id){
 const [d,clients,projects,drafts]=await Promise.all([api('/api/conversations/'+encodeURIComponent(id)),api('/api/clients'),api('/api/projects'),api('/api/conversations/'+encodeURIComponent(id)+'/drafts')]);
 conversationWork=(await api('/api/inbox/work/'+encodeURIComponent(id))).item;
 conversation=id;requestId=crypto.randomUUID();conversationOutbox=new Map((d.messages||[]).filter(m=>m.direction==='out').map(m=>[m.id,m]));$('#title').textContent=d.item.title||'שיחה';
 const newestInbound=[...(d.messages||[])].reverse().find(m=>m.direction==='in');
 conversationReplyEligible=!['spam','suspicious','marketing','system','reaction'].includes(conversationWork.message_type);

 const options=(items,selected)=>'<option value="">ללא שיוך</option>'+items.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(x.name)+'</option>').join('');
 const messages=(d.messages||[]).map(m=>'<article class="message '+(m.direction==='out'?'out':'in')+'"><div class="message-meta"><span>'+esc(m.direction==='out'?'נשלח':'מאת '+displayContact(m.sender_display||m.sender,d.item.channel))+'</span><time>'+esc(formatDate(m.sent_at))+'</time></div>'+classificationHtml(m)+providerStateHtml(m)+'<div class="message-text">'+esc(m.body||'')+'</div>'+(m.cc?'<small>העתק: '+esc(m.cc)+'</small>':'')+'<div class="message-tools"><label><input type="checkbox" class="thread-pick" value="'+esc(m.id)+'">בחר להפרדה</label>'+(m.direction==='out'&&d.item.channel==='whatsapp'?'<span class="muted">'+esc(({server:'נשלח לשרת',delivered:'נמסר',read:'נקרא',played:'נוגן'})[m.delivery_status]||'קריאה לא אומתה')+'</span>':'')+(m.deletion_status?'<span class="muted">'+esc(m.deletion_status==='requested'?'בקשת מחיקה נשלחה · לא אומת אצל הלקוח':'מצב המחיקה דורש בדיקה')+'</span>':'')+(m.can_delete_for_everyone?button('conversation-delete-for-all','מחק לכולם',m.id):'')+(m.source==='google.gmail'?button('gmail-message-actions','פעולות Gmail',m.id):'')+(m.body_html?button('mail-html','תצוגת דואר מעוצבת',m.id):'')+button('knowledge-propose','הפק נוהל',m.id)+'</div></article>').join('');
 $('#content').innerHTML='<section class="conversation-layout"><div class="conversation-main"><header class="conversation-header"><div>'+button('back-inbox','← חזרה לתיבה')+button('thread-merge','אחד עם שיחה אחרת')+button('thread-split','הפרד הודעות מסומנות')+button('conversation-attachments','קבצים מצורפים',id)+'<h2>'+esc(displayContact(d.item.title||d.item.external_id||'שיחה',d.item.channel))+'</h2><p class="muted">כל ההודעות והטיוטות בשיחה אחת</p></div><span class="tag">'+esc(channel(d.item))+'</span></header><div class="chat-timeline conversation" role="log" aria-label="הודעות בשיחה">'+(messages||'<p class="empty">אין הודעות עדיין.</p>')+'</div><section class="reply-composer"><h3>כתיבת תשובה</h3><label class="sr-only" for="reply">תשובה</label><textarea id="reply" rows="5" placeholder="הקלד תשובה או בקש הצעת נוסח…"></textarea><label for="instruction">הנחיה לעוזר (רשות)</label><input id="instruction" placeholder="למשל: קצר, מקצועי וענייני"><div class="reply-variants"><span class="muted">הצעות לפי ההיסטוריה והמידע המשויך:</span>'+button('reply-suggestion','קצרה','short')+button('reply-suggestion','מקצועית','professional')+button('reply-suggestion','ידידותית','friendly')+button('reply-suggestion','מפורטת','detailed')+button('reply-suggestion','מעקב ידידותי','followup')+'</div><div class="composer-actions">'+button('draft','הצע תשובה')+button('save-draft','שמור טיוטה')+button('reject-draft','דחה')+button('send','אישור ושליחה')+'</div><p id="draftInfo" class="muted" role="status">'+(conversationReplyEligible?'טיוטות מבוססות על הקשר ה־CRM, וללא שליחה אוטומטית.':'ההודעה האחרונה סווגה כעדכון או כחשודה; הצעות AI הושבתו עד לשינוי הסיווג.')+'</p></section></div><aside class="conversation-sidebar"><h3>פרטי השיחה</h3><label>לקוח<select id="convClient">'+options(clients.items,d.item.client_id)+'</select></label><label>פרויקט<select id="convProject">'+options(projects.items,d.item.project_id)+'</select></label>'+button('associate','שמור שיוך')+'</aside></section>';
 $('.conversation-sidebar').insertAdjacentHTML('beforeend','<div class="workflow-controls"><p>'+esc(workLabels[conversationWork.handling_state]||'דורש בדיקה')+'</p>'+button('work-done','טופל',id)+button('work-waiting','מחכה ללקוח',id)+button('work-noaction','לא דורש תשובה',id)+button('work-auto','איפוס החלטות ידניות',id)+'</div>');
 const draft=(drafts.items||[]).find(x=>x.status==='draft');if(draft){$('#reply').value=draft.body;$('#reply').dataset.draftId=draft.id;}
 await post('/api/conversations/'+encodeURIComponent(id)+'/read');
 const timeline=$('.conversation');if(timeline)timeline.scrollTop=timeline.scrollHeight;
}

async function showConversationAttachments(id){
 const result=await api('/api/conversations/'+encodeURIComponent(id)+'/attachments');
 if(conversation!==id)return;
 document.querySelector('#attachmentInfoDialog')?.remove();
 const rows=(result.items||[]).map(a=>'<article class="row"><div><strong>'+esc(a.filename)+'</strong><p class="muted">'+
  esc(a.mime_type)+' · '+(a.size_bytes==null?'גודל לא ידוע':Number(a.size_bytes).toLocaleString('he-IL')+' בתים')+
  ' · '+esc(formatDate(a.sent_at))+'</p></div>'+(result.downloads_enabled&&['google.gmail','hostinger.imap'].includes(a.source)?'<a class="btn" download href="/api/conversations/'+encodeURIComponent(id)+'/attachments/'+encodeURIComponent(a.message_id)+'/'+encodeURIComponent(a.ordinal)+'/download">הורדה מהספק</a>':'<span class="muted">מידע על קובץ בלבד</span>')+'</article>').join('');
 const dialog='<dialog id="attachmentInfoDialog" aria-label="קבצים מצורפים" style="width:min(94vw,760px);max-height:85vh;overflow:auto;padding:16px;border-radius:16px"><h2>קבצים מצורפים</h2>'+
  '<p class="muted">פרטי קבצים מהדוא״ל. כשההורדה מאופשרת, הקובץ נקרא מהספק בלחיצה בלבד (עד 10MB לקובץ). קובץ שהועבר או השתנה עשוי לדרוש סנכרון מחדש.</p>'+
  (rows||'<p class="empty">אין מידע על קבצים מצורפים בשיחה שנשמרה.</p>')+
  (result.limited?'<p class="muted">מוצגים עד 100 פריטים.</p>':'')+
  '<form method="dialog"><button class="btn">סגירה</button></form></dialog>';
 document.body.insertAdjacentHTML('beforeend',dialog);document.querySelector('#attachmentInfoDialog')?.showModal();
}

async function showProviderFolders(provider,accountId=''){
 const path=provider==='gmail'?'/api/google/folders?account_id='+encodeURIComponent(accountId):'/api/hostinger/folders';
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;
 root.hidden=false;root.textContent='טוען תיקיות ממקור הדואר…';
 const result=await api(path);
 const count=n=>n===null||n===undefined?'לא דווח':Number(n).toLocaleString('he-IL');
 const names={inbox:'דואר נכנס',sent:'נשלחו',drafts:'טיוטות',trash:'אשפה',spam:'ספאם',unread:'לא נקראו',custom:'תיקייה'};
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h3>'+esc(provider==='gmail'?'תוויות Gmail':'תיקיות Hostinger')+'</h3><p class="muted">נתוני הספק בלבד · קריאה בלבד · ספירת לא נקראו אינה זהה למצב הקריאה ב־CRM</p>'+
  '<div class="folder-grid">'+(result.folders||[]).map(f=>
   '<article class="row"><div><strong>'+esc(f.name)+'</strong><p class="muted">'+esc(names[f.kind]||'תיקייה')+'</p></div>'+
   '<div><span>'+esc(count(f.messages_total))+' הודעות</span> · <strong>'+esc(count(f.messages_unread))+' לא נקראו</strong></div></article>'
  ).join('')+'</div>'+(result.limited?'<p class="muted">הרשימה מוגבלת; יש תיקיות נוספות שלא הוצגו.</p>':'');
}

async function showCalendarMirror(accountId,sync=false){
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;root.hidden=false;root.textContent='טוען מצב יומן…';
 if(sync)await post('/api/google/calendar/sync',{account_id:accountId});
 const d=await api('/api/google/calendar/cache?account_id='+encodeURIComponent(accountId));
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h3>עותק מקומי · Google Calendar</h3><p>מקור: היומן הראשי של החשבון שנבחר. מופעים חוזרים נשמרים לפי הגדרת הסדרה.</p><p>'+esc('עדכון מוצלח: '+(d.sync.checked_at?formatDate(d.sync.checked_at):'טרם סונכרן'))+'</p>'+
 button('calendar-sync',d.sync.has_next_page?'סנכרן את הדף הבא':'בדוק שינויים ביומן',accountId)+
 (d.events||[]).map(e=>'<article class="row"><div><strong>'+esc(e.summary||'אירוע ללא כותרת')+'</strong><p>'+esc(e.start?.dateTime||e.start?.date||'ללא מועד')+' · '+esc(e.start?.timeZone||'')+'</p><p>'+esc(e.status==='cancelled'?'בוטל אצל הספק':e.status)+'</p><small>'+esc('Google Calendar · '+e.id)+'</small></div></article>').join('')+
 (d.limited?'<p>מוצגים 100 אירועים לכל היותר.</p>':'');
}

async function showGoogleCalendar(accountId){
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;
 root.hidden=false;root.textContent='טוען אירועים מהיומן…';
 const result=await api('/api/google/calendar?account_id='+encodeURIComponent(accountId));
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h3>יומן Google · אירועים קרובים</h3>'+button('calendar-mirror','סנכרון יומן מקומי',accountId)+
  '<p class="muted">קריאה בלבד, מהחשבון שנבחר. יצירה או שינוי אירועים אינם מופעלים.</p>'+
  ((result.events||[]).length?(result.events||[]).map(e=>'<article class="row"><div><strong>'+esc(e.summary||'אירוע ללא כותרת')+
   '</strong><p class="muted">'+esc(formatDate(e.start))+' · '+esc(e.location||'ללא מיקום')+'</p></div></article>').join(''):'<p class="muted">לא נמצאו אירועים בתקופה שנבדקה.</p>');
}
function prepareDriveSearch(accountId){
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;
 root.hidden=false;
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h3>חיפוש קבצים ב־Google Drive</h3><p class="muted">מחפש שמות קבצים בלבד בהרשאות הקריאה הקיימות. לא מעתיק או משנה קבצים.</p>'+
  '<label>שם קובץ<input id="driveQuery" maxlength="100" autocomplete="off" placeholder="הקלד לפחות שתי אותיות"></label>'+
  button('drive-search-run','חפש ב־Drive',accountId)+'<div id="driveResults" role="status"></div>';
 $('#driveQuery')?.focus();
}

async function showPeopleMirror(accountId,sync=false){
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;root.hidden=false;root.textContent='טוען אנשי קשר…';
 if(sync)await post('/api/google/people/sync',{account_id:accountId});
 const d=await api('/api/google/people/cache?account_id='+encodeURIComponent(accountId));
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h3>אנשי קשר Google</h3><p>מקור: החשבון שנבחר. אנשי הקשר אינם ממוזגים אוטומטית עם לקוחות CRM. פרטי קשר אינם אימות זהות.</p>'+
 '<p>'+esc('עדכון מוצלח: '+(d.sync.checked_at?formatDate(d.sync.checked_at):'טרם סונכרן'))+'</p>'+
 button('people-sync',d.sync.has_next_page?'סנכרן את הדף הבא':'בדוק שינויים באנשי קשר',accountId)+
 (d.items||[]).map(p=>'<article class="row"><div><strong>'+esc(p.name||'ללא שם')+'</strong><p>'+esc((p.emails||[]).map(e=>e.value).join(' · '))+'</p><p>'+esc((p.phones||[]).map(e=>e.value).join(' · '))+'</p><small>'+esc('Google Contacts · '+p.id)+'</small></div></article>').join('')+
 (!(d.items||[]).length?'<p>אין אנשי קשר בעותק המסונכרן. ניתן לבדוק שינויים.</p>':'')+
 (d.limited?'<p>מוצגים 100 אנשי קשר לכל היותר.</p>':'');
}

async function showDriveMirror(accountId,sync=false){
 const root=$('#providerFolders');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;root.hidden=false;root.textContent='טוען שינויי Drive…';
 if(sync)await post('/api/google/drive/sync',{account_id:accountId});
 const d=await api('/api/google/drive/cache?account_id='+encodeURIComponent(accountId));
 const link=file=>{try{const u=new URL(file.webViewLink);if(u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password)return '<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">פתח את הקובץ המקורי</a>';}catch{}return '';};
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML='<h3>Google Drive · פרטי קבצים מסונכרנים</h3><p>קריאה בלבד. תוכן הקבצים אינו מועתק. קבצים שהוסרו או שאינם נגישים אינם מוצגים.</p><p>'+esc('עדכון מוצלח: '+(d.sync.checked_at?formatDate(d.sync.checked_at):'טרם סונכרן'))+'</p>'+
 button('drive-sync',d.sync.has_next_page?'סנכרן את הדף הבא':'בדוק שינויים ב־Drive',accountId)+
 (d.items||[]).map(f=>'<article class="row"><div><strong>'+esc(f.name||'קובץ')+'</strong><p>'+esc(f.mimeType)+' · '+esc(formatDate(f.modifiedTime))+'</p><small>'+esc('Google Drive · '+f.id+' · גרסה '+(f.version||'לא ידועה'))+'</small><p>'+link(f)+'</p></div></article>').join('')+
 (d.limited?'<p>מוצגים 100 קבצים לכל היותר. החיפוש אצל הספק זמין במסך חיפוש Drive.</p>':'');
}

async function showDriveSearch(accountId){
 const q=String($('#driveQuery')?.value||'').trim();
 if(q.length<2||q.length>100)throw Error('יש להזין 2–100 תווים לחיפוש.');
 const root=$('#driveResults');if(!root)return;const request=crypto.randomUUID();root.dataset.providerRequest=request;
 const result=await api('/api/google/drive-search?account_id='+encodeURIComponent(accountId)+'&q='+encodeURIComponent(q));
 if(!root.isConnected||root.dataset.providerRequest!==request)return;
 root.innerHTML=(result.files||[]).length?(result.files||[]).map(f=>'<article class="row"><div><strong>'+esc(f.name||'קובץ')+
  '</strong><p class="muted">'+esc(f.mimeType||'')+' · '+esc(formatDate(f.modifiedTime))+'</p></div></article>').join(''):
  '<p class="muted">לא נמצאו קבצים מתאימים או שאין גישה אליהם בחשבון הנבחר.</p>';
}

async function showClient360(clientId){
 const info=await api('/api/clients/'+encodeURIComponent(clientId)+'/overview');
 document.querySelector('#client360Dialog')?.remove();
 const client=info.client;
 const groups=[
  ['conversations','שיחות',x=>(x.title||x.external_id||'שיחה')+' · '+(x.channel||'')+' · '+formatDate(x.last_message_at)],
  ['projects','פרויקטים',x=>(x.name||'פרויקט')+' · '+(x.status||'')],
  ['tasks','משימות',x=>(x.title||'משימה')+' · '+(x.status||'')+(x.due_date?' · יעד '+x.due_date:'')],
  ['files','קבצים',x=>x.name||'קובץ'],
  ['reminders','תזכורות',x=>(x.title||'תזכורת')+' · '+(x.status||'')+' · '+formatDate(x.due_at)],
  ['notes','הערות',x=>x.body||''],
  ['activities','פעילות',x=>(x.title||x.event||'אירוע')+' · '+formatDate(x.created_at)]
 ];
 const sections=groups.map(([key,title,format])=>'<section class="panel"><h3>'+esc(title)+' · '+(info[key]||[]).length+'</h3>'+
  ((info[key]||[]).length?'<ul>'+(info[key]||[]).map(x=>'<li>'+esc(format(x))+'</li>').join('')+'</ul>':'<p class="muted">אין פריטים משויכים ישירות.</p>')+'</section>').join('');
 const html='<dialog id="client360Dialog" aria-label="כרטיס לקוח 360" style="width:min(94vw,1040px);max-height:90vh;overflow:auto;border-radius:18px;padding:18px">'+
 '<header class="row"><div><h2>'+esc(client.name||'כרטיס לקוח')+'</h2><p class="muted">'+esc([client.company,client.email,client.phone].filter(Boolean).join(' · '))+'</p></div>'+
 button('client-360-close','סגירה')+'</header><p class="muted">מידע מתוך CRM, עם שיוך מפורש בלבד. אין זיהוי אוטומטי לפי שם דומה או מספר חלקי.</p>'+
 '<div class="client-360-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px">'+sections+'</div>'+
 '<p class="muted">עד 20–40 פריטים מכל סוג מוצגים בכרטיס. לא מוצגים כאן נתוני ספק שטרם סונכרנו.</p></dialog>';
 document.body.insertAdjacentHTML('beforeend',html);
 $('#client360Dialog').showModal();
}

async function loadWa(){
 const d=await api('/api/whatsapp/status');
 $('#wa').innerHTML=(d.sessions||[]).map(s=>{
  const code=s.pairing_code?'<p role="status">קוד קישור: <strong dir="ltr">'+esc(s.pairing_code)+'</strong></p>':'';
  const qr=s.qr&&s.qr.startsWith('data:image/png;base64,')?'<img alt="QR לקישור" width="220" src="'+esc(s.qr)+'">':'';
  const error=s.last_error?'<p class="error">'+esc(userError(s.last_error))+'</p>':'';
  const held=['logged_out','recovery_required'].includes(s.status);
  const recovery=s.recovery||{};
  const recoveryInfo=held?'<p class="error"><strong>חיבור WhatsApp דורש התאוששות.</strong> קוד ניתוק: '+esc(recovery.disconnect_code??'לא ידוע')+'. נתוני האימות נשמרים; אין למחוק סשן או לנסות להתחבר שוב ושוב. גיבויים: '+Number(recovery.backup_count||0)+'.</p>':'';
  const recoverButtons=held?button('wa-recovery-status','בדוק מצב וגיבויים',s.id)+(s.status==='logged_out'?button('wa-recovery-probe','ניסיון התאוששות חד־פעמי',s.id):''):button('wa-connect','חיבור',s.id)+button('wa-reconnect','חיבור מחדש',s.id);
  return '<div class="panel"><b>'+esc(s.label||s.id)+'</b><p>'+esc(held?(s.status==='logged_out'?'ההרשאה נדחתה ב־WhatsApp':'נדרש בירור סשן'):statusLabel(s.status))+'</p>'+recoveryInfo+code+qr+error+'<div class="actions">'+recoverButtons+button('wa-refresh','רענן מצב',s.id)+button('wa-identities','זיהוי מספרים',s.id)+button('wa-history-status','סטטוס היסטוריה',s.id)+(held?'':button('wa-history','השלמת היסטוריה',s.id)+button('wa-disconnect','ניתוק זמני',s.id)+button('wa-delete-session','מחיקת סשן',s.id))+'</div></div>';
 }).join('')||'<p>אין עדיין חשבונות WhatsApp מחוברים.</p>';
}

document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;$('#error').textContent='';
 if(b.dataset.view){location.hash=b.dataset.view;return;}
 const action=b.dataset.action;if(!action)return;const id=b.dataset.id;b.disabled=true;
 try{
  if(action.startsWith('work-')){await workAction(action,id);return;}
  if(await intelligenceAction(action,b))return;
  if(action==='compose-close'){document.querySelector('#outboundDialog')?.remove();return;}
  if(action==='thread-close'){document.querySelector('#threadMergeDialog')?.remove();return;}
  if(action==='thread-merge'){await showMergeDialog();return;}
  if(action==='thread-split'){
   const selected=[...document.querySelectorAll('.thread-pick:checked')].map(x=>x.value);
   if(!selected.length)throw Error('בחר הודעה אחת או יותר להפרדה.');
   if(!confirm('להפריד '+selected.length+' הודעות לשיחה חדשה? הפעולה לא מוחקת הודעות.'))return;
   const r=await post('/api/conversations/split',{conversation_id:conversation,message_ids:selected});
   await openConversation(r.conversation_id);$('#notice').textContent='נוצרה שיחה נפרדת עם '+r.moved+' הודעות.';return;
  }
   if(action==='close-editor')$('#editor').close();
  if(action==='entity-layout'){if(['list','kanban','calendar','month'].includes(id)){entityLayout=id;await render(view);}return;}
  if(action==='create'||action==='edit')await editRecord(b.dataset.id);
  if(action==='notes')await showNotes(b.dataset.id);
  if(action==='conversation')await openConversation(b.dataset.id);
  if(action==='gmail-message-actions'){
   document.querySelector('#gmailActionDialog')?.remove();
   const dialog=document.createElement('dialog');dialog.id='gmailActionDialog';dialog.setAttribute('aria-label','פעולות Gmail');
   dialog.innerHTML='<h2>פעולות Gmail</h2><p>השינוי חל על הודעה זו אצל Google. מצב הטיפול ב־CRM נשאר נפרד.</p><label for="gmailAction">פעולה</label><select id="gmailAction"><option value="read">סמן כנקרא</option><option value="unread">סמן כלא נקרא</option><option value="archive">העבר לארכיון</option><option value="inbox">החזר לדואר נכנס</option><option value="star">הוסף כוכב</option><option value="unstar">הסר כוכב</option></select>'+button('gmail-message-confirm','אישור שינוי ב־Gmail',id)+'<form method="dialog"><button class="btn">ביטול</button></form><p id="gmailActionStatus" role="status"></p>';
   document.body.append(dialog);dialog.showModal();return;
  }
  if(action==='gmail-message-confirm'){
   const selected=$('#gmailAction').value,status=$('#gmailActionStatus');status.textContent='מעדכן אצל Google…';
   try{await api('/api/conversations/'+encodeURIComponent(conversation)+'/messages/'+encodeURIComponent(id)+'/gmail-state',{method:'POST',body:{action:selected,confirmed:true}});
    status.textContent='השינוי התקבל ב־Google. התצוגה המקומית תתעדכן בסנכרון הבא.';
   }catch(error){status.textContent=userError(error.message);}return;
  }
  if(action==='mail-html'){
   const current=conversation,result=await api('/api/conversations/'+encodeURIComponent(current)+'/messages/'+encodeURIComponent(id)+'/html');
   if(conversation!==current)return;
   document.querySelector('#mailHtmlDialog')?.remove();
   const dialog=document.createElement('dialog');dialog.id='mailHtmlDialog';dialog.setAttribute('aria-label','תצוגת דואר מעוצבת');
   dialog.style.cssText='width:min(94vw,900px);height:80vh;padding:16px;border-radius:16px';
   const note=document.createElement('p');note.textContent='תצוגה מסוננת: תמונות חיצוניות, קישורים פעילים וסקריפטים חסומים.';
   const frame=document.createElement('iframe');frame.title='תוכן הודעת הדואר';frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.style.cssText='width:100%;height:80%;border:0';frame.srcdoc=result.document;
   const form=document.createElement('form');form.method='dialog';const close=document.createElement('button');close.className='btn';close.textContent='סגירה';form.append(close);
   dialog.append(note,frame,form);document.body.append(dialog);dialog.showModal();return;
  }
  if(action==='conversation-attachments'){await showConversationAttachments(id);return;}
  if(action==='client-360'){await showClient360(id);return;}
  if(action==='client-360-close'){document.querySelector('#client360Dialog')?.close();document.querySelector('#client360Dialog')?.remove();return;}
  if(action==='google-status'){await showGoogleStatus(id);return;}
  if(action==='people-mirror'){await showPeopleMirror(id);return;}
  if(action==='people-sync'){await showPeopleMirror(id,true);return;}
  if(action==='people-permission'){
   if(!confirm('לבקש הרשאת קריאה לאנשי הקשר בחשבון זה? פרטי הקשר יישמרו ב־CRM לקריאה בלבד, ללא מיזוג לקוחות אוטומטי. אפשר לבטל במסך Google.'))return;
   const d=await post('/api/google/permission-url',{account_id:id,confirmed:true,purpose:'contacts_read'}),target=new URL(d.url);
   if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw Error('כתובת ההתחברות אינה תקינה');
   location.href=target.href;return;
  }
  if(action==='google-permission'){
   if(!confirm('לבקש הרשאת Gmail modify? הרשאה זו מאפשרת קריאה, כתיבה, שליחה ושינוי מצב בתיבה. תוכל לאשר או לבטל במסך Google.'))return;
   const d=await post('/api/google/permission-url',{account_id:id,confirmed:true}),target=new URL(d.url);
   if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw Error('כתובת ההתחברות אינה תקינה');
   location.href=target.href;return;
  }
  if(action==='gmail-folders'){await showProviderFolders('gmail',id);return;}
  if(action==='calendar-mirror'){await showCalendarMirror(id);return;}
  if(action==='calendar-sync'){await showCalendarMirror(id,true);return;}
  if(action==='google-calendar'){await showGoogleCalendar(id);return;}
  if(action==='drive-mirror'){await showDriveMirror(id);return;}
  if(action==='drive-sync'){await showDriveMirror(id,true);return;}
  if(action==='google-drive'){prepareDriveSearch(id);return;}
  if(action==='drive-search-run'){await showDriveSearch(id);return;}
  if(action==='hostinger-folders'){await showProviderFolders('hostinger');return;}
  if(action==='back-inbox'){location.hash='inbox';await render('inbox');}
  if(action==='inbox-filter'){inboxFilter=b.dataset.id;renderInboxItems();}
  if(action==='assistant-prompt'){const examples={waiting:'מי מהלקוחות מחכה לתשובה ממני?',urgent:'אילו משימות דחופות עדיין פתוחות?',new:'סכם את הפניות החדשות שקיבלתי'};const t=$('#assistantMessage');if(t){t.value=examples[b.dataset.id]||'';t.focus();}}
  if(action==='compose-new'){await showCompose();return;}
  if(action==='sent-more'){await loadSentBatch();return;}
  if(action==='sent-refresh'){await renderSentMessages();return;}
  if(action==='sent-delete-for-all'){await requestSentDeletion(id);return;}
  if(action==='conversation-delete-for-all'){await deleteConversationMessage(id);return;}
  if(action==='draft-refresh'){await renderDraftOverview();return;}
   if(action==='history-sync'){
    await post('/api/history-sync/start');
    const info=await api('/api/history-sync/status');
    $('#notice').textContent='סנכרון היסטורי מופעל ברקע עבור '+info.items.length+' חשבונות. מצב: '+info.items.map(x=>x.provider+' '+x.state+' ('+x.imported+' יובאו)').join(' · ');return;
   }
   if(action==='historical-triage'){
   const preview=await post('/api/inbox/history/triage',{cursor:historyTriageCursor,limit:200,dry_run:true});
   const description=preview.preview.map(x=>x.subject+' → '+statusLabel(x.classification)+' ('+x.reason+')').join('\n');
   if(!confirm('תצוגה מקדימה: '+preview.scanned+' הודעות, '+preview.proposed+' שינויי תיקייה.\n'+description+'\nלהחיל את המנה הזו?'))return;
   const report=await post('/api/inbox/history/triage',{confirmed:true,dry_run:false,cursor:historyTriageCursor,limit:200});
   historyTriageCursor=report.done?'':report.next_cursor;saveHistoryCursor(historyTriageCursor);
   await render(view);$('#notice').textContent='נסרקו '+report.scanned+' הודעות · '+report.updated+' שונו.'+(report.done?' הסריקה הושלמה.':' לחץ שוב לתצוגה מקדימה של המנה הבאה.');
  }
  if(action==='sync'){const d=await post('/api/sync');if(view==='inbox'||view==='spam'||view==='updates')await render(view);showSyncReport(d);}
  if(action==='upload'){const file=$('#fileInput').files[0];if(!file)return;const data=new FormData();data.append('file',file);const r=await fetch('/api/files',{method:'POST',body:data,credentials:'same-origin'});if(!r.ok)throw Error('העלאת הקובץ נכשלה');const result=await r.json();await api('/api/files/'+encodeURIComponent(result.id),{method:'PATCH',body:JSON.stringify({client_id:$('#fileClient').value,project_id:$('#fileProject').value,task_id:$('#fileTask').value})});await render('files');}
  if(action==='google'){const d=await post('/api/google/auth-url');const target=new URL(d.url);if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw Error('כתובת ההתחברות אינה תקינה');location.href=target.href;}
  if(action==='wa-connect'){await post('/api/whatsapp/connect',{session_id:id});await loadWa();}
  if(action==='wa-reconnect'){await post('/api/whatsapp/reconnect',{session_id:id});await loadWa();}
  if(action==='wa-disconnect'&&confirm('לנתק זמנית את הסשן הזה בלבד?')){await post('/api/whatsapp/disconnect',{session_id:id});await loadWa();}
  if(action==='wa-delete-session'&&confirm('למחוק לצמיתות את פרטי הקישור של הסשן הזה בלבד?')){await api('/api/whatsapp/session',{method:'DELETE',body:JSON.stringify({session_id:id})});await loadWa();}
  if(action==='google-disconnect'&&confirm('לנתק את חשבון Google הזה מהמערכת?')){await api('/api/google/accounts/'+encodeURIComponent(b.dataset.id),{method:'DELETE'});await render('connectors');}
  if(action==='hostinger-disconnect'&&confirm('לנתק את חשבון הדואר של Hostinger?')){await post('/api/hostinger/disconnect');await render('connectors');}
  if(action==='wa-recovery-status'){
   const info=await api('/api/whatsapp/recovery/status?session_id='+encodeURIComponent(id));
   const hold=info.quarantine;
   $('#notice').textContent='מצב התאוששות WhatsApp: '+(info.registered_auth_present?'נתוני אימות רשומים קיימים':'לא נמצאו נתוני אימות רשומים')+' · '+String(info.backup_count||0)+' גיבויים מקומיים · '+(hold?'הסגר '+String(hold.reason)+' (קוד '+String(hold.code||'לא ידוע')+')':'אין רישום הסגר')+'. גיבוי לא מחזיר הרשאה ש־WhatsApp ביטלה.';
   await loadWa();
  }
  if(action==='wa-recovery-probe'){
   const info=await api('/api/whatsapp/recovery/status?session_id='+encodeURIComponent(id));
   if(!info.registered_auth_present)throw Error('אין נתוני אימות רשומים שאפשר לנסות לשחזר מהם ללא מכשיר ראשי.');
   if(!confirm('לנסות חיבור חד־פעמי באמצעות נתוני האימות הקיימים?\\n\\nלא יימחקו קבצים, לא יישלחו הודעות ולא תתבצע סריקת QR. אם WhatsApp ביטלה את ההרשאה בפועל, הניסיון לא יצליח ולא ניתן יהיה לחזור עליו שוב אוטומטית.'))return;
   const result=await post('/api/whatsapp/recovery/probe',{session_id:id,confirmed:true});
   $('#notice').textContent=result.started?'ניסיון התאוששות חד־פעמי התחיל. רענן מצב כדי לבדוק את התשובה מ־WhatsApp.':'לא התחיל ניסיון התאוששות.';
   await loadWa();
  }
  if(action==='wa-refresh')await loadWa();
  if(action==='wa-identities'){
   const result=await post('/api/whatsapp/identities/refresh',{session_id:id});
   $('#notice').textContent='בדיקת זהויות WhatsApp: '+String(result.resolved||0)+' מיפויים נמצאו, '+String(result.unresolved||0)+' ללא מספר זמין, '+String(result.failed||0)+' שגיאות. הפעולה לא שולחת הודעות.';
  }
  if(action==='wa-history-status'){
   const info=await api('/api/whatsapp/history/status?session_id='+encodeURIComponent(id));
   const c=info.summary||{};
   $('#notice').textContent='היסטוריית WhatsApp: '+String(c.chats||0)+' צ׳אטים · '+String(c.imported||0)+' הודעות יובאו · '+String(c.duplicates||0)+' כפילויות · '+String(c.failed||0)+' שגיאות · כיסוי חלקי או לא מאומת.';
  }
  if(action==='wa-history'){
   const result=await post('/api/whatsapp/history/request',{session_id:id,limit:5});
   const descriptions={
    not_connected:'החשבון אינו מחובר כרגע. יש להתחבר מחדש לחשבון הנכון.',
    no_chats_available:'לא נמצאו צ׳אטים אישיים עם עוגן הודעה זמין עבור החשבון הזה. WhatsApp טרם סיפקה נתונים שמאפשרים בקשת היסטוריה.',
    no_usable_anchors:'נמצאו צ׳אטים, אבל אין בהם מזהה ותאריך של הודעה אמיתית שניתן להשתמש בהם לבקשת היסטוריה.',
    cooldown:'כבר נשלחו בקשות עבור הצ׳אטים הזמינים ב־24 השעות האחרונות. לא נשלחו בקשות כפולות.',
    unsupported_api:'גרסת החיבור אינה תומכת בפונקציית בקשת היסטוריה.',
    request_failed:'כל ניסיונות שליחת הבקשות נכשלו. יש לבדוק חיבור ויומן שגיאות.',
    no_confirmed_requests:'ניסיונות הבקשה לא התקבלו באישור ברור.'
   };
   const d=result.diagnostics||{};
   const extra=' (צ׳אטים במסד: '+String(d.stored_chats||0)+', עוגני הודעה חיים: '+String(d.live_anchors||0)+', ללא עוגן: '+String(d.no_anchor||0)+', בהמתנה: '+String(d.cooldown||0)+').';
   $('#notice').textContent=Number(result.requested)>0?
    'נשלחו '+String(result.requested)+' מתוך '+String(result.attempted||0)+' בקשות היסטוריה. WhatsApp אינה מבטיחה החזרת ההודעות.':
    'לא נשלחה בקשת היסטוריה: '+(descriptions[result.reason]||'הסיבה אינה ידועה. בדוק סטטוס החיבור.')+extra;
  }
  if(action==='wa-logout'&&confirm('לנתק את החשבון המקושר?')){await post('/api/whatsapp/logout',{session_id:id});await loadWa();}
  if(action==='associate'){await api('/api/conversations/'+encodeURIComponent(conversation),{method:'PATCH',body:JSON.stringify({client_id:$('#convClient').value,project_id:$('#convProject').value})});$('#notice').textContent='השיוך נשמר';}
  if(action==='reply-suggestion'){
   if(!conversationReplyEligible)throw Error('לא ניתן להציע תשובה להודעת מערכת, ספאם או הודעה חשודה לפני שינוי הסיווג.');
   const variant={professional:'נסח תשובה מקצועית ועניינית על סמך מידע מאומת בלבד.',friendly:'נסח תשובה ידידותית ללא המצאת פרטים או התחייבויות.',short:'נסח תשובה קצרה, ברורה ואנושית; רק לפי המידע והבקשה של הלקוח.',detailed:'נסח תשובה מקצועית ומפורטת; השתמש אך ורק בעובדות מה־CRM של הלקוח.',followup:'נסח מעקב שירותי וידידותי לפי ההיסטוריה, ללא הבטחות שלא סוכמו.'}[id];
   if(!variant)throw Error('סגנון טיוטה לא מוכר.');
   $('#instruction').value=variant;
   $('#draftInfo').textContent='מכין הצעת תשובה על בסיס היסטוריית השיחה והלקוח…';
   const d=await post('/api/conversations/'+encodeURIComponent(conversation)+'/draft',{instruction:variant});
   $('#reply').value=d.draft;$('#reply').dataset.draftId=d.id;$('#draftInfo').textContent='הצעה מוכנה לעריכה ולאישור. לא נשלחה הודעה.';
  }
  if(action==='draft'){
   if(!conversationReplyEligible)throw Error('יש לסווג את ההודעה כלא ספאם לפני יצירת טיוטה חכמה.');
   $('#draftInfo').textContent='יוצר טיוטה באמצעות ספק AI חיצוני…';
   const d=await post('/api/conversations/'+encodeURIComponent(conversation)+'/draft',{instruction:$('#instruction').value});$('#reply').value=d.draft;$('#reply').dataset.draftId=d.id;$('#draftInfo').textContent='טיוטה מוכנה לעריכה. מקור: '+d.provider;
  }
  if(action==='send'){
   const body=$('#reply').value.trim();if(!body||!confirm('לשלוח את ההודעה הבאה?\n\n'+body))return;
   await post('/api/conversations/'+encodeURIComponent(conversation)+'/send',{body,confirmed:true,draft_id:$('#reply').dataset.draftId||'',request_id:requestId});await openConversation(conversation);
  }
 }catch(error){$('#error').textContent=error.message;}finally{b.disabled=false;}
});
window.addEventListener('hashchange',()=>navigateHash().catch(e=>$('#error').textContent=e.message));
let inboxRealtimeTimer=null,lastInboxAutoRefresh=0;
function scheduleRealtimeInboxRefresh(event){
 if(!['message.new','message.sent','ai.inbox','external.event'].includes(event?.type))return false;
 if(event.type==='external.event'&&event.payload?.type!=='message')return false;
 if(!['inbox','spam','updates'].includes(view))return false;
 const notice=$('#notice');
 const safeToRefresh=()=>{
  const form=$('#workSearch');
  // Do not reset a user's filter edits, active conversation task or loaded older pages.
  return !!form&&!form.contains(document.activeElement)&&!document.querySelector('dialog[open]')&&
   workPending.size===0&&inboxItems.length<=50&&window.scrollY<240&&
   !String($('#workCoverage')?.textContent||'').includes('סורק שיחות');
 };
 if(!safeToRefresh()){if(notice)notice.textContent='נקלט עדכון חדש. לרענון בלי לאבד את מצב העבודה לחץ על רענון התיבה.';return true;}
 clearTimeout(inboxRealtimeTimer);
 const delay=Math.max(900,7000-(Date.now()-lastInboxAutoRefresh));
 inboxRealtimeTimer=setTimeout(()=>{
  if(!['inbox','spam','updates'].includes(view)||!safeToRefresh())return;
  void renderWorkInbox().then(()=>{
   lastInboxAutoRefresh=Date.now();
   if(notice)notice.textContent='תיבת ההודעות עודכנה אוטומטית.';
  }).catch(()=>{if(notice)notice.textContent='התקבל עדכון חדש. הרענון האוטומטי נכשל; לחץ על רענון התיבה.';});
 },delay);
 return true;
}
async function realtime(){try{const d=await post('/api/ws-ticket'),url=new URL('/ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',d.ticket);const socket=new WebSocket(url);socket.onmessage=e=>{let event;try{event=JSON.parse(e.data);}catch{return;}if(event.type==='connected')return;if(scheduleRealtimeInboxRefresh(event))return;const notice=$('#notice');if(notice)notice.textContent='המידע עודכן ברקע. ניתן לרענן את המסך.';};socket.onclose=()=>setTimeout(realtime,5000);}catch{setTimeout(realtime,15000);}}



function userError(code){const errors={mail_html_disabled:'תצוגת HTML כבויה עד לאימות בסביבת בדיקה.',mail_html_unavailable:'לא נשמר תוכן HTML להודעה זו. תצוגת הטקסט זמינה.',mail_downloads_disabled:'הורדת קבצים כבויה עד לאימות בסביבת בדיקה.',gmail_read_permission_required:'אין לחשבון הרשאת קריאת Gmail מאומתת. יש לאשר את ההרשאה בחיבור החשבון.',gmail_send_permission_required:'אין לחשבון הרשאת שליחת Gmail מאומתת. ההודעה לא נשלחה; יש לאשר הרשאה מתאימה בחיבור החשבון.',people_sync_disabled:'סנכרון אנשי קשר כבוי עד להפעלה ואימות בסביבת בדיקה.',contacts_read_permission_required:'נדרשת הרשאת קריאת אנשי קשר. ניתן לבקש אותה בכפתור ההרשאה לחשבון שנבחר.',drive_sync_disabled:'סנכרון Drive המקומי כבוי עד להפעלה ואימות בסביבת בדיקה.',drive_metadata_permission_required:'אין לחשבון הרשאת קריאת פרטי קבצים מאומתת.',provider_checkpoint_conflict:'סנכרון נוסף הסתיים במקביל. ניתן לנסות שוב.',calendar_sync_disabled:'סנכרון היומן המקומי כבוי עד להפעלה ואימות בסביבת בדיקה.',calendar_read_permission_required:'לחשבון זה אין הרשאת קריאת יומן מאומתת.',calendar_checkpoint_conflict:'סנכרון נוסף הסתיים במקביל. אפשר לבדוק שינויים מחדש.',gmail_writes_disabled:'שינוי מצב הודעות Gmail כבוי בהגדרות המערכת.',gmail_modify_permission_required:'נדרשת הרשאת Gmail modify מפורשת לחשבון שנבחר.',google_consent_account_mismatch:'נבחר חשבון Google אחר. ההרשאה לא נשמרה; יש לבחור את החשבון המקורי.',inbox_cursor_expired_refresh:'תוקף רשימת ההודעות פג. לחץ על רענון התיבה.',inbox_cursor_filter_mismatch:'המסנן השתנה. לחץ על רענון התיבה.',invalid_inbox_cursor:'יש לרענן את התיבה כדי להמשיך.',inbox_revision_conflict:'מצב הפנייה השתנה בחלון אחר. רענן ונסה שוב.',assistant_read_unavailable:'לא ניתן לקבוע מי ממתין: הסריקה חלקית או שיש כשל בנתונים או בסנכרון. בדוק בתיבת העבודה.',ai_provider_unauthorized:'Groq דחה את מפתח ה-API או שהגישה למודל אינה מורשית. בדוק את המפתח ב-Hostinger.',ai_rate_limited:'הגעת למגבלת הבקשות של ספק ה-AI. המתן ונסה שוב.',ai_provider_unavailable:'ספק ה-AI אינו זמין כרגע או שהשרת לא הצליח להתחבר אליו.',ai_model_not_found:'שם מודל ה-AI אינו זמין. בדוק שהגדרת openai/gpt-oss-20b.',ai_request_rejected:'ספק ה-AI דחה את הבקשה. בדוק את שם המודל ואת התאימות שלו.',ai_provider_rejected_request:'ספק ה-AI דחה את הבקשה. יש לבדוק את הגדרות המודל.',ai_context_too_large:'כמות המידע שנשלחה למודל גדולה מדי. נסה בקשה קצרה יותר.',assistant_context_budget_too_small:'תקציב ההקשר של העוזר קטן מדי. הגדל את Context Size בהגדרות.',invalid_assistant_response:'המודל החזיר תשובה בפורמט לא תקין. נסה שוב.',empty_ai_response:'המודל לא החזיר טקסט. נסה שוב.',ai_provider_configuration_invalid:'הגדרות ספק ה-AI ב-Hostinger אינן תקינות.',ai_diagnostic_throttled:'אפשר להריץ בדיקת AI אחת בכל 30 שניות.',ai_unexpected_error:'אירעה תקלה בשרת בזמן בדיקת AI. יש לבדוק את הלוג.',external_ai_required:'לצ׳אט, לטיוטות ולניתוח מורכב נדרש ספק AI חיצוני. הגדר ספק חיצוני בהגדרות השרת.',external_ai_model_required:'יש להגדיר מודל כתיבה חיצוני, בנפרד ממודל Tiny המקומי.',knowledge_private_data:'התוכן מכיל פרטים אישיים או מזהים. יש להסיר אותם לפני שמירה.',knowledge_review_required:'נדרשת בדיקה ואישור שהתוכן כללי ומתאים לשיתוף בין שיחות.',invalid_knowledge_content:'יש למלא כותרת עד 255 תווים ותוכן עד 12000 תווים.',invalid_knowledge_extraction:'לא הופק נוהל כללי תקין מההודעה. אפשר לנסות הודעה אחרת.',confirmation_expired_or_used:'האישור פג תוקף או שכבר נעשה בו שימוש. בקש מהעוזר להכין את הפעולה מחדש.',destination_changed_request_new_confirmation:'פרטי הנמען השתנו. יש להכין את ההודעה מחדש ולקבל אישור חדש.',invalid_confirmation:'האישור אינו תקין. בקש להכין את הפעולה מחדש.',invalid_settings:'יש לבדוק את ערכי ההגדרות.',tool_permission_denied:'אין הרשאה לביצוע הפעולה.',not_found:'הרשומה לא נמצאה.',invalid_draft:'הטיוטה אינה זמינה לשליחה. יש לרענן את השיחה.',action_failed_review_required:'הפעולה לא הושלמה בוודאות. יש לבדוק את יומן הפעולות לפני ניסיון נוסף.',file_type_not_editable:'לא ניתן לערוך את סוג הקובץ הזה.',connection_failed:'החיבור נכשל. בדוק את פרטי החשבון.',invalid_whatsapp_pairing_number:'הזן מספר בינלאומי, ספרות בלבד, כולל קידומת מדינה.',whatsapp_not_enabled:'חיבור WhatsApp אינו מופעל בשרת.',whatsapp_already_connected:'WhatsApp כבר מחובר. אין צורך בקוד נוסף.',whatsapp_pairing_in_progress:'קישור WhatsApp כבר מתבצע. נסה שוב לאחר סיומו.',whatsapp_pairing_failed:'לא הצלחנו לקבל קוד קישור. בדוק את המספר והחיבור ונסה שוב.'};return errors[code]||(/[\u0590-\u05ff]/.test(String(code))?String(code):'הפעולה נכשלה. בדוק את הנתונים ונסה שוב.');}
function toolLabel(name){return ({send_email:'שליחת דואר',send_whatsapp:'שליחת WhatsApp',create_client:'יצירת לקוח',update_client:'עדכון לקוח',create_project:'יצירת פרויקט',update_project:'עדכון פרויקט',archive_project:'העברה לארכיון',create_task:'יצירת משימה',update_task:'עדכון משימה',update_system:'עדכון מערכת',create_draft:'יצירת טיוטה',create_file:'יצירת קובץ',update_file:'עדכון קובץ',create_reminder:'יצירת תזכורת'})[name];}
const statusNames={manual:'ידני',ai:'טיפול חכם',ai_draft:'טיוטה חכמה',queued:'בתור',active:'פעיל',in_progress:'בטיפול',cancelled:'בוטל',normal:'רגיל',spam:'ספאם',suspicious:'חשוד',automated:'אוטומטי',marketing:'שיווקי',system:'מערכת',unknown:'לא ידוע',pending:'ממתין',completed:'הושלם',failed:'נכשל',running:'פועל',connected:'מחובר',pairing_pending:'מבקש קוד',pairing_code_ready:'קוד מוכן להזנה בטלפון',qr_required:'נדרש QR',connecting:'מתחבר',disconnected:'מנותק',reconnecting:'מתחבר מחדש',error:'שגיאה',open:'פתוח',done:'הושלם',archived:'בארכיון',deleted:'נמחק',draft:'טיוטה'};
const statusLabel=value=>statusNames[value]||value||'';
const empty=text=>'<p class="empty">'+esc(text)+'</p>';
const lifecycleButtons=x=>'<div class="actions">'+button('relations','קשרים',x.id||x.did)+button(x.archived_at||x.deleted_at?'restore':'archive',x.archived_at||x.deleted_at?'שחזור':'ארכיון',x.id||x.did)+button('delete','מחיקה',x.id||x.did)+(x.deleted_at?button('hard_delete','מחיקה לצמיתות',x.id||x.did):'')+'</div>';
function classificationHtml(m){if(m.direction==='out')return '';return '<div class="muted">'+esc(statusLabel(m.classification||'unknown'))+(m.classification_score!=null?' · '+Math.round(Number(m.classification_score)*100)+'%':'')+' '+esc(m.classification_reason||'')+'</div><div class="actions">'+button('spam-feedback','ספאם',m.id)+button('normal-feedback','לא ספאם',m.id)+'</div>';}
function optionHtml(values,current){return values.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(label)+'</option>').join('');}
async function renderIntelligence(page){
 if(page==='assistant'){
  $('#content').innerHTML='<section class="assistant-layout"><aside class="assistant-history" aria-label="היסטוריית שיחות"><div class="assistant-history-head"><h3>השיחות שלי</h3>'+button('assistant-new','+ שיחה חדשה')+button('owner-memory','זיכרון אישי')+'</div><label>חיפוש שיחות<input id="assistantHistorySearch" type="search"></label><div id="assistantSessions" class="assistant-session-list"></div><p class="muted">השיחות נשמרות בשרת באופן פרטי.</p></aside><div class="assistant-workspace"><header class="assistant-header"><div class="assistant-mark"><i class="bi bi-stars" aria-hidden="true"></i></div><div><p class="eyebrow">Aharon AI</p><h2>העוזר העסקי שלך</h2><p>פעולות לאישור מופיעות לצד ההודעה שיצרה אותן, גם בשיחות קודמות.</p></div></header><div class="assistant-prompts">'+button('assistant-prompt','מי מחכה לתשובה?','waiting')+button('assistant-prompt','משימות דחופות','urgent')+button('assistant-prompt','פניות חדשות','new')+'</div><div id="chatLog" class="assistant-transcript" role="log" aria-live="polite" aria-label="שיחה עם העוזר"></div><form id="assistantForm" class="assistant-composer"><label class="sr-only" for="assistantMessage">הודעה לעוזר</label><textarea id="assistantMessage" name="message" rows="2" maxlength="12000" required placeholder="מה תרצה לבדוק או לעשות?"></textarea><button class="btn primary" type="submit"><i class="bi bi-arrow-up" aria-hidden="true"></i> שלח</button></form><p class="assistant-disclaimer">פעולות שמשנות נתונים נשמרות במקומן עד לאישור, ביטול או פקיעת התוקף.</p></div></section>';
  await loadAssistantSessions();return true;
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

async function openOwnerMemory(){
 document.getElementById('ownerMemoryDialog')?.remove();
 const d=await api('/api/owner-memories');
 const dialog=document.createElement('dialog');dialog.id='ownerMemoryDialog';
 const kinds=[['preference','העדפה'],['decision','החלטה'],['project','פרויקט'],['fact','עובדה'],['inference','השערה לא מאומתת'],['temporary','מידע זמני — 7 ימים']];
 dialog.innerHTML='<section class="panel" style="min-width:min(560px,85vw);max-height:80vh;overflow:auto"><h2>זיכרון אישי</h2><p>פרטים שהזנת בעצמך וזמינים לעוזר בשיחות עתידיות לפי הקשר. שום מידע מהודעות של לקוחות לא נשמר כאן אוטומטית.</p><form id="ownerMemoryForm"><input type="hidden" name="id"><input type="hidden" name="revision"><label>סוג זיכרון<select name="kind">'+kinds.map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select></label><label>נושא<input name="subject" required maxlength="160"></label><label>מה לזכור<textarea name="body" required maxlength="2500" rows="4"></textarea></label><div class="actions"><button type="submit" class="btn primary">שמירה</button><button type="button" class="btn" id="ownerMemoryClear">זיכרון חדש</button><button type="button" class="btn" id="ownerMemoryClose">סגירה</button></div></form><div id="ownerMemoryItems">'+(d.items||[]).map(m=>'<article class="row"><div><strong>'+esc(m.subject)+'</strong><p class="note">'+esc(m.body)+'</p><small>'+esc(kinds.find(x=>x[0]===m.kind)?.[1]||m.kind)+'</small></div><div class="actions"><button class="btn" data-memory-edit="'+esc(m.id)+'">עריכה</button><button class="btn" data-memory-delete="'+esc(m.id)+'">מחיקה</button></div></article>').join('')+'</div></section>';
 document.body.append(dialog);
 const form=dialog.querySelector('#ownerMemoryForm'),clear=()=>{form.reset();form.elements.id.value='';form.elements.revision.value='';};
 dialog.querySelector('#ownerMemoryClear').addEventListener('click',clear);
 dialog.querySelector('#ownerMemoryClose').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>dialog.remove());
 dialog.addEventListener('click',async e=>{
  const edit=e.target.closest('[data-memory-edit]'),del=e.target.closest('[data-memory-delete]');
  const id=edit?.dataset.memoryEdit||del?.dataset.memoryDelete;if(!id)return;
  const item=(d.items||[]).find(x=>x.id===id);if(!item)return;
  if(edit){for(const name of ['id','revision','kind','subject','body'])form.elements[name].value=item[name];return;}
  if(del&&confirm('למחוק את הזיכרון האישי הזה ממסד הנתונים הפעיל?'))try{
   await api('/api/owner-memories/'+encodeURIComponent(id),{method:'DELETE',body:JSON.stringify({revision:item.revision})});
   dialog.close();await openOwnerMemory();
  }catch(err){alert(err.message);}
 });
 form.addEventListener('submit',async e=>{
  e.preventDefault();const data=Object.fromEntries(new FormData(form));
  const id=data.id;delete data.id;const revision=Number(data.revision);delete data.revision;
  try{await api('/api/owner-memories'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',body:JSON.stringify(id?{...data,revision}:data)});
   dialog.close();await openOwnerMemory();
  }catch(err){alert(err.message);}
 });
 dialog.showModal();
}

async function loadAssistantSessions(){
 const d=await api('/api/assistant/sessions');assistantSessions=d.items||[];
 if(!assistantSessions.length){const fresh=await post('/api/assistant/sessions');assistantSessions=[fresh];assistantSession=fresh.id;}
 const selected=assistantSessions.find(x=>x.id===assistantSession)||assistantSessions[0];
 await openAssistantSession(selected.id);
}
async function openAssistantSession(id){
 if(assistantBusy)return;
 const d=await api('/api/assistant/sessions/'+encodeURIComponent(id));
 assistantSession=id;assistantMessages=d.messages||[];pendingActions=[];
 renderAssistantSessions();renderChat();
}
function renderAssistantSessions(){
 const root=$('#assistantSessions');if(!root)return;
 root.innerHTML=assistantSessions.filter(c=>!$('#assistantHistorySearch')?.value||String(c.title).includes($('#assistantHistorySearch').value)).map(c=>'<div class="assistant-session'+(c.id===assistantSession?' selected':'')+'">'+button('assistant-open',c.title||'שיחה חדשה',c.id)+button('assistant-archive','ארכיון',c.id)+'</div>').join('');
}
function currentAction(id){
 for(const message of assistantMessages){const action=(message.actions||[]).find(a=>a.id===id);if(action)return action;}
 return pendingActions.find(a=>a.id===id);
}
function memorySourceCards(sources){
 const labels={owner_assertion:'דיווח בעלים — לא אימות עצמאי',owner_preference:'העדפה',temporary_owner_note:'מידע זמני',unverified_inference:'השערה לא מאומתת'};
 if(!Array.isArray(sources)||!sources.length)return '';
 return '<details class="note"><summary>זיכרונות שנמסרו למודל ('+sources.length+')</summary><p>מקורות הקשר, לא הוכחה שכל פרט בתשובה אומת.</p><ul>'+sources.slice(0,10).map(s=>'<li>'+esc(s.subject||s.id)+' · '+esc(labels[s.evidence]||'מקור זיכרון')+' · גרסה '+esc(s.revision||'')+(s.status==='changed'?' · עודכן מאז התשובה — יש לבדוק מחדש':s.status==='unavailable'?' · המקור נמחק או אינו זמין':'')+'</li>').join('')+'</ul></details>';
}
function renderChat({preserveScroll=false}={}){
 const log=$('#chatLog');if(!log)return;
 const previousTop=log.scrollTop;
 const actionCard=a=>'<section class="assistant-action-card" aria-label="פעולה לאישור"><div class="assistant-action-title"><i class="bi bi-check2-square" aria-hidden="true"></i><strong>'+esc(toolLabel(a.tool)||a.summary||'פעולה לבדיקה')+'</strong></div>'+previewArgs(a.preview||a.args)+'<div class="assistant-action-controls">'+(a.status==='pending'&&a.confirmation_token?button('assistant-confirm','אישור וביצוע',a.id)+button('assistant-dismiss','ביטול',a.id):'<span class="tag">'+esc(a.status==='expired'?'תוקף האישור פג':statusLabel(a.status))+'</span>')+'</div></section>';
 const lastAssistant=assistantMessages.reduce((last,m,i)=>m.role==='assistant'?i:last,-1);
 log.innerHTML=(!assistantMessages.length?'<div class="assistant-empty"><i class="bi bi-chat-square-dots" aria-hidden="true"></i><h3>אפשר להתחיל בכל שאלה עסקית</h3><p>למשל סיכום פניות, איתור משימה או הכנת תשובה.</p></div>':'')+assistantMessages.map((m,i)=>{
  // Legacy in-memory actions, if any, are attached to the assistant turn instead of the timeline end.
  const actions=[...(m.actions||[]),...(i===lastAssistant?pendingActions:[])];
  return '<article class="chat-turn '+(m.role==='user'?'mine':'theirs')+'"><span class="chat-speaker">'+esc(m.role==='user'?'אתה':'העוזר')+'</span><div class="chat-bubble">'+esc(m.text).replace(/\/#conversation=([a-zA-Z0-9_%.-]+)/g,'<a href="/#conversation=$1">פתח שיחת מקור</a>')+'</div>'+memorySourceCards(m.memory_sources)+actions.map(actionCard).join('')+'</article>';
 }).join('')+(assistantBusy?'<div class="chat-turn theirs"><span class="chat-speaker">העוזר</span><div class="chat-bubble typing">מכין תשובה…</div></div>':'');
 log.scrollTop=preserveScroll?previousTop:log.scrollHeight;
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
 if(action==='ai-external-test'){
  const target=$('#externalAiResult');if(target)target.textContent='בודק חיבור למודל החיצוני…';
  try{const result=await post('/api/ai/diagnose');
   if(target)target.textContent=result.connected?'החיבור נבדק בהצלחה · ספק: '+String(result.provider||'חיצוני')+' · מודל: '+String(result.model||'לא ידוע'):'בדיקת החיבור נכשלה: '+userError(result.error);
  }catch(error){if(target)target.textContent='בדיקת החיבור נכשלה: '+error.message;}
 }
 else if(action==='refresh-view'){await render(view);}
 else if(action==='smart-automation'){if(confirm('להפעיל יצירת לקוחות ומשימות בזיהוי חד-משמעי, סיווג ספאם וטיוטות לבדיקה?')){await api('/api/settings',{method:'PATCH',body:JSON.stringify({automation:{clients:'automatic',projects:'suggest',tasks:'automatic',drafts:'automatic',spam:'automatic',classification:'automatic'}})});await render('settings');}}
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
  const a=currentAction(id);if(!a||a.status!=='pending'||!a.confirmation_token)return true;
  const target=assistantSession?'/api/assistant/sessions/'+encodeURIComponent(assistantSession)+'/actions/'+encodeURIComponent(id)+'/confirm':'/api/assistant/actions/'+encodeURIComponent(id)+'/confirm';
  const result=await post(target,{confirmed:true,confirmation_token:a.confirmation_token});
  if(result.status!=='completed')throw Error('הפעולה עדיין לא הושלמה; בדוק את מצבה לפני ניסיון נוסף.');
  a.status='completed';delete a.confirmation_token;renderChat({preserveScroll:true});
 }
 else if(action==='assistant-dismiss'){
  const a=currentAction(id);if(!a)return true;
  if(assistantSession)await post('/api/assistant/sessions/'+encodeURIComponent(assistantSession)+'/actions/'+encodeURIComponent(id)+'/dismiss');
  a.status='dismissed';delete a.confirmation_token;pendingActions=pendingActions.filter(x=>x.id!==id);renderChat({preserveScroll:true});
 }
 else if(action==='owner-memory'){await openOwnerMemory();}
 else if(action==='assistant-open'){await openAssistantSession(id);}
 else if(action==='assistant-new'){const fresh=await post('/api/assistant/sessions');assistantSessions.unshift(fresh);await openAssistantSession(fresh.id);}
 else if(action==='assistant-archive'){
  if(!confirm('להעביר את השיחה לארכיון? ההודעות לא יימחקו ממסד הנתונים.'))return true;
  await post('/api/assistant/sessions/'+encodeURIComponent(id)+'/archive');
  assistantSessions=assistantSessions.filter(x=>x.id!==id);if(id===assistantSession){assistantSession='';await loadAssistantSessions();}else renderAssistantSessions();
 }
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
document.addEventListener('input',e=>{if(e.target?.id==='assistantHistorySearch')renderAssistantSessions();if(e.target?.id==='inboxSearch'){inboxQuery=e.target.value;renderInboxItems();}});
document.addEventListener('keydown',e=>{if(e.target?.id==='assistantMessage'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&window.innerWidth>800){e.preventDefault();e.target.form?.requestSubmit();}});
document.addEventListener('change',e=>{if(e.target?.id==='composeChannel')refreshCompose();});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='threadMergeForm')return;
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  const target_id=new FormData(e.target).get('target_id');
  if(!target_id||!confirm('לאחד את כל הודעות השיחה הנוכחית עם שיחת היעד?'))return;
  const result=await post('/api/conversations/merge',{source_id:conversation,target_id});
  document.querySelector('#threadMergeDialog')?.remove();await openConversation(result.conversation_id);
  $('#notice').textContent='אוחדו '+result.moved+' הודעות לאותה שיחה.';
 }catch(error){document.querySelector('#threadMergeStatus').textContent=error.message;}finally{btn.disabled=false;}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='outboundForm')return;
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  const fields=Object.fromEntries(new FormData(e.target));
  const prepared=await post('/api/outgoing/prepare',fields);
  if(prepared.status!=='pending'||!prepared.confirmation_token)throw Error('לא התקבל אישור שליחה תקף.');
  const details=prepared.preview||{};
  const selected=JSON.parse(document.querySelector('#outboundDialog')?.dataset.accounts||'[]').find(x=>x.id===fields.account_id);
  const selectedAccount=selected?(selected.label+(selected.identifier&&selected.identifier!==selected.label?' · '+selected.identifier:'')):(details.account||'');
  if(!confirm('לאשר שליחה?\\n\u26a0 בדוק היטב את החשבון השולח — ייתכן שזהו החשבון האישי שלך.\\n\u05d7\u05e9\u05d1\u05d5\u05df: '+selectedAccount+'\\nנמען: '+(details.recipient||'')+(fields.channel==='email'?'\\nנושא: '+(details.subject||''):'')+'\\n\\n'+(details.body||'')))return;
  const sent=await post('/api/assistant/actions/'+encodeURIComponent(prepared.id)+'/confirm',{confirmed:true,confirmation_token:prepared.confirmation_token});
  if(sent.status!=='completed')throw Error('לא ניתן לוודא שההודעה נשלחה. בדוק פעילות לפני ניסיון נוסף.');
  document.querySelector('#outboundDialog')?.remove();location.hash='sent';await render('sent');$('#notice').textContent='השליחה התקבלה אצל הספק. מצב המסירה והקריאה עדיין לא אומת.';
 }catch(err){document.querySelector('#composeStatus').textContent=err.message;}finally{btn.disabled=false;}
});
document.addEventListener('submit',async e=>{if(e.target.id!=='workSearch')return;e.preventDefault();try{workFilters=Object.fromEntries(new FormData(e.target));await renderWorkInbox();}catch(error){$('#error').textContent=error.message;}});
document.addEventListener('submit',async e=>{
 const form=e.target;if(!['assistantForm','mailSetup','waPairForm','reminderForm','settingsForm','fileSearch','knowledgeForm'].includes(form.id))return;e.preventDefault();const submit=e.submitter;submit.disabled=true;$('#error').textContent='';
 try{
  const fields=Object.fromEntries(new FormData(form));
  if(form.id==='assistantForm'){
   if(assistantBusy)return;
   const selectedSession=assistantSession;assistantMessages.push({role:'user',text:fields.message,actions:[]});assistantBusy=true;form.reset();renderChat();
   try{
    const d=await post('/api/assistant/sessions/'+encodeURIComponent(selectedSession)+'/chat',{message:fields.message,request_id:crypto.randomUUID()});
    assistantMessages.push({id:d.id,role:'assistant',text:d.reply||'לא התקבלה תשובה.',actions:d.actions||[],memory_sources:d.memory_sources||[]});
    if(assistantSessions.find(x=>x.id===selectedSession)?.title==='שיחה חדשה')assistantSessions.find(x=>x.id===selectedSession).title=fields.message.slice(0,180);
    renderAssistantSessions();
   }catch(error){assistantMessages.push({role:'assistant',text:'לא הצלחתי להשלים את הבקשה: '+error.message,actions:[]});}
   finally{assistantBusy=false;renderChat();}
  }
  if(form.id==='waPairForm'){await post('/api/whatsapp/pair',{phone_number:fields.phone_number});form.reset();await loadWa();}
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
 $('#content').innerHTML='<form id="settingsForm"><section class="panel"><h2>בינה מלאכותית</h2><div class="settings-grid">'+select('generativeProvider','ספק לכתיבה ולצ׳אט',[['external','חיצוני'],['disabled','כבוי']],s.ai.generativeProvider||'external')+'<label>מודל כתיבה חיצוני<input name="externalModel" value="'+esc(s.ai.externalModel||'')+'"></label><label>מודל Tiny מקומי — סיווג וחילוץ בלבד<input name="localModel" value="'+esc(s.ai.localModel||'')+'"></label><label>מידת יצירתיות<input name="temperature" type="number" min="0" max="2" step="0.1" value="'+Number(s.ai.temperature)+'"></label><label>גודל ההקשר<input name="contextSize" type="number" min="2000" max="64000" value="'+Number(s.ai.contextSize)+'"></label>'+select('fallback','מעבר לספק גיבוי',[['true','מופעל'],['false','כבוי']],String(s.ai.fallback))+'</div></section><section class="panel"><h2>אוטומציות</h2><p class="muted">מומלץ ליצור רק נתונים מזיהוי חד־משמעי. זיהוי לא ודאי יישאר לאישור.</p>'+button('smart-automation','הפעל אוטומציות מומלצות')+'<div class="settings-grid">'+Object.entries({clients:'יצירת לקוחות',projects:'יצירת פרויקטים',tasks:'יצירת משימות',drafts:'טיוטות תשובה',spam:'סינון ספאם',classification:'סיווג הודעות',followups:'מעקבים אוטומטיים'}).map(([k,label])=>select(k,label,modes,s.automation[k]||(k==='followups'?'suggest':'off'))).join('')+'</div><p class="setting-help">מצב הצעה מחכה לאישור שלך. טיוטות אינן נשלחות מעצמן.</p><div class="settings-grid"><label>המתנה לתשובה (שעות)<input name="waitingHours" type="number" min="1" max="2160" value="'+Number(s.followups?.waitingHours??48)+'"></label><label>משימה באיחור (שעות)<input name="overdueHours" type="number" min="0" max="2160" value="'+Number(s.followups?.overdueHours??24)+'"></label>'+select('followupMode','פעולת מעקב',[['remind','תזכורת בלבד'],['draft_follow_up','טיוטת המשך לשיחה']],s.followups?.mode||'remind')+'</div></section><section class="panel"><h2>שליחת הודעות</h2>'+select('policy','מדיניות אישור',[['always_confirm','אישור לכל פעולה'],['confirm_sensitive','אישור לפעולות רגישות'],['auto_send_trusted','שליחה אוטומטית לאנשי קשר מהימנים'],['never_auto_send','לעולם לא לשלוח אוטומטית']],s.messaging.policy)+select('defaultAccountId','חשבון ברירת מחדל',[['','לפי השיחה'],...accounts.items.map(a=>[a.id,a.label||a.identifier])],s.messaging.defaultAccountId)+'<label>מזהי לקוחות מהימנים, מופרדים בפסיק<input name="trustedClientIds" value="'+esc(s.messaging.trustedClientIds.join(', '))+'"></label><label>חתימה<textarea name="signature">'+esc(s.messaging.signature)+'</textarea></label><p class="setting-help">שליחה לאיש קשר מהימן תלויה גם בהרשאות ובזיהוי חד משמעי של הנמען.</p></section><div class="panel"><button class="btn primary" type="submit">שמירת הגדרות</button></div></form><section class="panel"><h2>פעולות ברקע</h2>'+backgroundStatus(background)+button('refresh-view','רענון מצב')+(jobs.items.map(j=>'<div class="row"><div><b>'+esc(jobLabel(j.type))+'</b><p>'+esc(statusLabel(j.status))+' · ניסיון '+Number(j.attempts)+' מתוך '+Number(j.max_attempts)+'</p>'+(j.last_error?'<p class="error">'+esc(j.last_error)+'</p>':'')+'</div>'+(j.status==='failed'?button('retry-job','ניסיון נוסף',j.id):'')+'</div>').join('')||empty('אין פעולות בתור.'))+'</section><section class="panel"><h2>אבטחה</h2>'+securityStatus(security)+'<p>חיבורים פעילים מופיעים במסך החיבורים.</p>'+button('security-audit','הצגת יומן הפעולות')+'<div id="auditLog"></div></section>';
}
function inboxState(c){const unread=Number(c.unread_count)||0;return '<span class="tag">'+(unread?unread+' לא נקראו':'נקרא')+'</span> <span class="tag">'+esc(workLabels[c.handling_state]||'דורש בדיקת מצב טיפול')+'</span>';}
function backgroundStatus(s){return '<p role="status">'+(!s.enabled?'עיבוד ברקע כבוי':s.running?'עיבוד ברקע פועל כעת':'עיבוד ברקע פעיל וממתין לעבודה')+'</p><p>ממתינות: '+Number(s.queued||0)+' · נכשלו: '+Number(s.failed||0)+'</p>'+(s.last_error?'<p class="error">'+esc(s.last_error)+'</p>':'');}
function securityStatus(s){const failed=Array.isArray(s.failed_attempts)?s.failed_attempts.reduce((n,x)=>n+Number(x.count||0),0):Number(s.failed_attempts||0);return '<p>מצב כניסה: '+(s.locked?'נעול':'פתוח ומוגן בסיסמה')+'</p><p>ניסיונות כניסה שנכשלו: '+failed+'</p><p>כתובות רשת חסומות: '+(Array.isArray(s.blocked_ips)?s.blocked_ips.map(esc).join(', ')||'אין':Number(s.blocked_ips||0))+'</p>';}
function jobLabel(type){return ({'message.process':'ניתוח הודעה','message.classify':'סיווג הודעה','inbox.intelligence':'ניתוח תיבת הודעות','file.index':'הכנת קובץ לחיפוש','draft.generate':'יצירת טיוטה','reminder.deliver':'הפעלת תזכורת'})[type]||'פעולת מערכת';}
async function saveSettings(f){return api('/api/settings',{method:'PATCH',body:JSON.stringify({ai:{localModel:f.localModel,externalModel:f.externalModel,generativeProvider:f.generativeProvider,temperature:Number(f.temperature),contextSize:Number(f.contextSize),fallback:f.fallback==='true'},automation:Object.fromEntries(['clients','projects','tasks','drafts','spam','classification','followups'].map(k=>[k,f[k]])),followups:{waitingHours:Number(f.waitingHours??48),overdueHours:Number(f.overdueHours??24),mode:f.followupMode||'remind'},messaging:{policy:f.policy,defaultAccountId:f.defaultAccountId,signature:f.signature,trustedClientIds:f.trustedClientIds.split(',').map(x=>x.trim()).filter(Boolean)}})});}
void navigateHash().catch(e=>$('#error').textContent=e.message);void realtime();

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
 const externalPanel='<section class="panel"><h2>בינה מלאכותית חיצונית — חיבור והגדרה</h2><p role="status"><strong>סטטוס: '+(d.fallback_configured?'הוגדר לפחות ספק חיצוני (החיבור עצמו טרם נבדק)':'לא הוגדר ספק חיצוני פעיל')+'</strong></p>'+button('ai-external-test','בדוק חיבור AI חיצוני')+'<p id="externalAiResult" role="status" aria-live="polite"></p><p>היכנס לפאנל של Hostinger, פתח את הגדרות אפליקציית Node.js ובחר Environment Variables.</p><ol><li>הוסף <code>AI_PROVIDERS_JSON</code> עם מערך JSON של ספקים מורשים התומכים ב־OpenAI-compatible.</li><li>לכל ספק יש לציין <code>id</code>, <code>base_url</code>, <code>api_key</code> ו־<code>model</code>.</li><li>שמור והפעל מחדש את שרת Node.js, ולאחר מכן רענן מסך זה.</li></ol><p>אם יש רק ספק אחד אפשר במקום זאת להגדיר <code>AI_BASE_URL</code>, <code>AI_API_TOKEN</code> ו־<code>AI_MODEL</code>.</p><p><strong>אבטחה:</strong> אין להעלות מפתחות ל־GitHub או לשלוח אותם בצ׳אט. תוכן פניות שעובד ב־AI עשוי להישלח לספק החיצוני.</p></section>';
 $('#content').innerHTML=externalPanel+'<div class="panel"><h2>Tiny Local AI — מודל מקומי זעיר</h2><p>שימוש: סיווג וחילוץ בסיסי בלבד. צ׳אט וטיוטות דורשים ספק חיצוני.</p><p>מודל מוגדר: '+esc(d.model)+'</p><p>מקור הטוקנייזר: '+esc(d.tokenizer_source||'—')+'</p><p>המודל שנוסה: '+esc(d.attempted_model||'טרם נוסה')+'</p><p>הטוקנייזר שנוסה: '+esc(d.attempted_tokenizer||'טרם נוסה')+'</p><p>כימות (dtype): '+esc(d.dtype||'—')+'</p><p>מופעל: '+(d.enabled?'כן':'לא')+'</p><p role="status">מצב מנוע: '+esc(states[d.state]||'ממתין לטעינה')+'</p><p>זמן טעינה: '+(d.load_duration_ms==null?'טרם נמדד':(Number(d.load_duration_ms)/1000).toFixed(1)+' שניות')+'</p><p>זמן יצירת פלט: '+(d.inference_duration_ms==null?'טרם נמדד':(Number(d.inference_duration_ms)/1000).toFixed(2)+' שניות')+'</p><p>השהיה לאחר כשל: '+Math.ceil(Number(d.cooldown_remaining_ms||0)/1000)+' שניות</p><p>תחילת טעינה: '+esc(d.started_at||'—')+'</p><p>סיום טעינה: '+esc(d.finished_at||'—')+'</p>'+(d.error?'<p class="error">'+esc(d.error.message)+' ('+esc(d.error.code)+')</p>':'')+'<p>Inference: '+esc(d.inference_status||'idle')+'</p><p>Label validation: '+esc(d.structured_status||'idle')+'</p>'+ (d.output_error?'<p class="error">'+esc(d.output_error.message)+'</p>':'')+'<h2>זיכרון התהליכים לפני ואחרי הטעינה</h2><p>CRM לפני: '+esc(memory(d.memory_before))+'</p><p>CRM אחרי: '+esc(memory(d.memory_after))+'</p><p>תהליך המודל לפני: '+esc(memory(d.worker_memory_before))+'</p><p>תהליך המודל אחרי: '+esc(memory(d.worker_memory_after))+'</p><p>זיכרון שיא בתהליך המודל: '+(d.worker_memory_peak==null?'טרם נמדד':(Number(d.worker_memory_peak)/1048576).toFixed(1)+' MB')+'</p><p>אחרי יצירת פלט: '+esc(memory(d.worker_memory_inference_after))+'</p><p>MB = מגה־בייט. במקרה של קריסת התהליך ייתכן שלא תהיה מדידת סיום.</p><button class="btn" data-action="local-ai-test" '+(!d.enabled||d.loading||d.test_running||d.cooldown_remaining_ms>0?'disabled':'')+'>בדיקת מודל מקומי (Test Local AI)</button> '+button('refresh-view','רענון מצב')+'<p role="status">'+(d.test_running?'מבחן הסיווג מתבצע ברקע: 20 הודעות, 80 החלטות…':d.test_result?.ok?'הבדיקה הצליחה: כל ההחלטות תאמו לתשובות הצפויות.':d.test_result?.error?esc(d.test_result.error.message):'')+ '</p>'+(d.test_result?.summary?'<h3>סיכום מבחן הסיווג</h3>'+Object.entries({...d.test_result.summary.languages,overall:d.test_result.summary.overall,...d.test_result.summary.workloads}).map(([name,s])=>'<p>'+esc(name)+': '+s.correct+'/'+s.total+' — '+Number(s.accuracy).toFixed(1)+'% | uncertain: '+s.uncertain+'</p>').join('')+'<p>זמן ממוצע להחלטה: '+Number(d.test_result.summary.average_inference_ms||0).toFixed(1)+' ms</p>':'')+(d.test_result?.cases||[]).map(g=>'<h3>'+esc(g.id||g.language)+'</h3>'+g.decisions.map(c=>'<p>'+esc(c.workload)+': expected '+esc(c.expected)+' | predicted '+esc(c.label||c.error?.code||'—')+' '+(c.matched?'✓':'✗')+' | margin: '+esc(c.margin??'—')+' | '+esc(c.inference_ms??'—')+' ms</p>').join('')).join('')+'<p>משך הבדיקה הכולל: '+esc(d.test_result?.total_duration_ms??'—')+' ms</p>' +'<p>הבדיקה משתמשת בטקסט קבוע בלבד, ללא נתוני לקוחות וללא ספק גיבוי.</p><p>גיבוי חיצוני: '+(d.fallback_configured?'מוגדר':'לא מוגדר')+'</p></div>';
 if(d.loading||d.loaded||d.test_running||d.cooldown_remaining_ms>0)localAiRefresh=setTimeout(()=>{if(view==='ai')void renderLocalAi().catch(()=>{$('#error').textContent='לא ניתן לרענן את מצב המודל.';});},2000);
}


async function navigateHash(){if(!visitRecorded){await post('/api/inbox/visit');visitRecorded=true;}const hash=location.hash.slice(1);if(hash.startsWith('conversation=')){await openConversation(decodeURIComponent(hash.slice(13)));return;}await render(hash||'home');}
const workLabels={inbox:'תיבה ראשית',needs_reply:'דורש טיפול',waiting_customer:'ממתין ללקוח',lead:'לידים',in_progress:'בטיפול',done:'הושלם',review:'דורש בדיקה',snoozed:'נדחה',updates:'עדכונים',spam:'ספאם',all:'כל השיחות',no_action:'לא דורש תשובה'};
async function renderRecentChangesBrief(){
 const d=await api('/api/insights/changes?hours=24');
 const c=d.counts||{};
 const entries=(d.messages||[]).slice(0,8).map(m=>'<article class="row"><div>'+
  '<strong>'+esc(m.conversation_title||'שיחה')+'</strong><p class="muted">'+esc(m.channel==='whatsapp'?'WhatsApp':'דוא״ל')+
  ' · '+esc(m.direction==='in'?'נכנסה':'נשלחה')+' · '+esc(formatDate(m.sent_at))+'</p>'+
  '<p>'+esc(m.snippet||m.subject||'ללא תוכן טקסטואלי')+'</p></div>'+
  button('conversation','פתח מקור',m.conversation_id)+'</article>').join('');
 $('#content').insertAdjacentHTML('beforeend','<section class="panel" aria-label="פעילות אחרונה עם מקורות">'+
  '<h2>מה השתנה ב־24 השעות האחרונות?</h2>'+
  '<p class="muted">סיכום מבוסס רשומות CRM שסונכרנו, לא תוצר AI. המקור לכל הודעה הוא שיחה קיימת.</p>'+
  '<div class="grid"><div class="card"><strong>'+Number(c.incoming||0)+'</strong><p>הודעות נכנסות</p></div>'+
  '<div class="card"><strong>'+Number(c.outgoing||0)+'</strong><p>הודעות יוצאות</p></div>'+
  '<div class="card"><strong>'+Number(c.tasks_updated||0)+'</strong><p>משימות שעודכנו</p></div>'+
  '<div class="card"><strong>'+Number(c.clients_added||0)+'</strong><p>לקוחות חדשים</p></div></div>'+
  '<h3>מקורות אחרונים</h3>'+(entries||'<p class="muted">לא נמצאו שינויים בחלון הזמן שנבדק.</p>')+
  '<p class="muted">תוצאה מוגבלת לפריטים האחרונים בלבד. נתונים שעדיין לא הסתנכרנו מהספק אינם כלולים.</p></section>');
}

async function renderWorkDashboard(){
 const d=await api('/api/inbox/work?view=all&limit=100');
 const counts=Object.fromEntries(['needs_reply','review','waiting_customer','in_progress'].map(k=>[k,d.items.filter(x=>x.handling_state===k).length]));
 $('#content').innerHTML='<section class="panel"><h2>במה לטפל עכשיו?</h2><p class="muted">לפי הנתונים שסונכרנו · '+(d.complete?'כל השיחות נסרקו':'תצוגה חלקית; בתיבה ניתן להמשיך סריקה')+'</p><div class="grid">'+Object.entries(counts).map(([k,n])=>'<button class="card" data-action="work-view" data-id="'+k+'"><span class="metric">'+n+'</span><br>'+esc(workLabels[k])+'</button>').join('')+'</div>'+button('work-view','פתח תור עבודה','needs_reply')+button('sync','סנכרון הודעות')+'</section><section class="panel"><h3>פניות חשובות בחלון שנסרק</h3>'+d.items.filter(x=>['needs_reply','review'].includes(x.handling_state)).slice(0,5).map(workCard).join('')+'</section>'+((d.themes||[]).length?'<section class="panel"><h3>נושאים שחוזרים בפניות שנסרקו</h3>'+d.themes.map(x=>'<p>'+esc(x.label)+' · '+Number(x.count)+' שיחות</p>').join('')+'</section>':'');
}
function workCard(x){
 return '<article class="work-card"><div class="work-card-head"><strong>'+esc(displayContact(x.contact_name||x.sender||x.title,x.channel))+'</strong><span class="tag">'+esc(workLabels[x.handling_state]||x.handling_state)+'</span></div><h3>'+esc(x.channel==='whatsapp'?displayContact(x.title||x.conversation_external_id||'שיחת WhatsApp','whatsapp'):x.subject||x.title||'ללא נושא')+'</h3><p class="work-request">'+esc(x.request_summary)+'</p><p class="muted">'+esc(channel(x))+' · '+esc(x.account_label||'')+' · '+esc(formatDate(x.waiting_since))+' · '+(Number(x.unread_count)>0?Number(x.unread_count)+' לא נקראו':'נקרא')+'</p><p>'+esc(x.next_action)+'</p><details><summary>למה הפנייה כאן?</summary><p>'+esc(x.reason)+'</p><p>'+esc(x.priority_reason)+' · ביטחון '+Math.round(x.confidence*100)+'%</p></details><div class="actions">'+button('conversation','פתח שיחה',x.id)+button('work-draft','הצע תשובה',x.id)+button('work-done','טופל',x.id)+button('work-spam','ספאם',x.id)+'<details><summary>פעולות נוספות</summary>'+button('work-waiting','מחכה ללקוח',x.id)+button('work-progress','בטיפול',x.id)+button('work-noaction','לא דורש תשובה',x.id)+button('work-lead','זה לקוח / ליד',x.id)+button('work-task','צור משימה',x.id)+button('work-snooze','דחה למועד',x.id)+button('work-updates','עדכון',x.id)+button('work-auto','איפוס החלטות ידניות',x.id)+'</details></div><div id="workAction-'+esc(x.id)+'" role="status"></div></article>';
}


async function renderDraftOverview(){
 const d=await api('/api/drafts/overview?limit=80');
 const items=d.items||[];
 const statusLabelDraft=s=>({draft:'טיוטה — לא נשלחה',sending:'בבדיקת שליחה — אין לשלוח שוב ללא אימות',uncertain:'שליחה לא ודאית — יש לבדוק אצל הספק לפני ניסיון חוזר'})[s]||'דורש בדיקה';
 $('#content').innerHTML='<section class="panel sent-hub"><header class="section-heading"><div><h2>טיוטות תשובה</h2><p class="muted">טיוטות שנוצרו בשיחות. הודעה חדשה שלא נשמרה כטיוטה אינה מופיעה כאן. טיוטות אינן נשלחות אוטומטית.</p></div><div class="actions">'+button('draft-refresh','רענן')+button('compose-new','הודעה חדשה')+'</div></header><div class="sent-list">'+
  (items.map(x=>'<article class="sent-card"><header class="sent-card-head"><strong>'+esc(x.conversation_title||'שיחה')+'</strong><span class="tag">'+esc(statusLabelDraft(x.status))+'</span></header>'+
   '<p class="muted">'+esc(x.channel==='whatsapp'?'WhatsApp':'דוא״ל')+' · '+esc(x.account_label||'חשבון לא מזוהה')+' · '+esc(formatDate(x.updated_at))+'</p>'+
   '<p class="sent-preview">'+esc(String(x.snippet||'').slice(0,350))+'</p>'+
   '<footer class="sent-actions">'+button('conversation','פתח שיחה לטיפול',x.conversation_id)+'</footer></article>').join('')||'<p class="empty">אין טיוטות תשובה ממתינות.</p>')+
 '</div><p class="muted">'+items.length+' טיוטות פעילות או שליחות הדורשות אימות</p></section>';
}

async function deleteConversationMessage(id){
 const m=conversationOutbox.get(id);
 if(!m||m.can_delete_for_everyone!==true)throw Error('לא ניתן לבקש מחיקה לכולם עבור הודעה זו.');
 if(!confirm('מחיקה לכולם של ההודעה הזו?\\nחשבון: '+String(m.sender||'לא ידוע')+'\\nנמען: '+String(m.recipient||'לא ידוע')+'\\n'+String(m.body||'').slice(0,150)+'\\n\\nהמחיקה עשויה לא להסיר התראות או הודעות שכבר נצפו.'))return;
 const target=conversation;
 const result=await post('/api/sent/'+encodeURIComponent(id)+'/delete-for-everyone',{confirmed:true});
 await openConversation(target);
 $('#notice').textContent=result.status==='requested'?'בקשת המחיקה נשלחה דרך החשבון המקורי. אין אישור שההודעה הוסרה אצל הלקוח.':'מצב המחיקה לא ודאי.';
}
async function requestSentDeletion(id){
 const message=sentItems.find(x=>x.id===id);
 if(!message||message.channel!=='whatsapp'||message.can_delete_for_everyone!==true)throw Error('הודעה זו אינה זכאית למחיקה לכולם.');
 const account=message.account_identifier||message.account_label||'לא ידוע';
 const target=displayContact(message.recipient||message.conversation_title||'',message.channel);
 if(!confirm('בקשת מחיקה לכולם ב־WhatsApp?\\n\\nחשבון שולח: '+account+'\\nנמען: '+target+'\\nהודעה: '+String(message.snippet||'').slice(0,140)+'\\n\\nהפעולה תישלח מחשבון ה־WhatsApp המקורי. הלקוח עלול כבר לראות את ההודעה; אין התחייבות להסרתה אצלו.'))return;
 // A provider reply only confirms the revoke request, not removal from the recipient.
 const result=await post('/api/sent/'+encodeURIComponent(id)+'/delete-for-everyone',{confirmed:true});
 await renderSentMessages();
 $('#notice').textContent=result.status==='requested'?'בקשת מחיקה לכולם נשלחה דרך החשבון המקורי. לא ניתן לאמת שהלקוח לא ראה אותה.':'מצב המחיקה לא ודאי.';
}
async function renderSentMessages(){
 sentItems=[];sentCursor='';sentDone=false;
 $('#content').innerHTML='<section class="panel sent-hub"><header class="section-heading"><div><h2>נשלחו</h2><p class="muted">הודעות יוצאות מ־WhatsApp ומכל חשבונות הדוא״ל. קבלה אצל הספק אינה אישור מסירה או קריאה.</p></div><div class="actions">'+button('sent-refresh','רענן')+button('compose-new','הודעה חדשה')+'</div></header><div id="sentList" class="sent-list" aria-live="polite"></div><p id="sentStatus" role="status"></p>'+button('sent-more','הצג עוד')+'</section>';
 await loadSentBatch();
}
function sentCard(item){
 const whatsapp=item.channel==='whatsapp',recipient=displayContact(item.recipient||item.conversation_title||'לא ידוע',item.channel);
 const title=whatsapp?'WhatsApp · '+(item.conversation_title||recipient):item.subject||'דוא״ל ללא נושא';
 return '<article class="sent-card"><header class="sent-card-head"><strong>'+esc(title)+'</strong><time class="muted">'+esc(formatDate(item.sent_at))+'</time></header>'+
  '<p class="muted">'+esc(whatsapp?'WhatsApp':'דוא״ל')+' · אל '+esc(recipient)+' · '+esc(item.account_label||'חשבון לא מזוהה')+'</p>'+
  '<p class="sent-preview">'+esc(String(item.snippet||'').slice(0,250))+'</p>'+
  '<footer class="sent-actions"><span class="sent-note">'+esc(item.channel==='whatsapp'?({server:'נשלח לשרת WhatsApp',delivered:'נמסר למכשיר',read:'נקרא',played:'נוגן',unverified:'אין אישור מסירה/קריאה'}[item.delivery_status]||'אין אישור מסירה/קריאה'):'דוא״ל · אישור קריאה אינו זמין')+'</span>'+
  (item.deletion_status?'<span class="sent-note">'+esc(({requested:'בקשת מחיקה לכולם נשלחה — לא אומת אצל הנמען',uncertain:'מצב בקשת המחיקה לא ודאי',sending:'בקשת מחיקה מתבצעת'})[item.deletion_status]||'בקשת מחיקה דורשת בדיקה')+'</span>':'')+
  (item.can_delete_for_everyone?button('sent-delete-for-all','מחק לכולם',item.id):'')+
  button('conversation','פתח שיחה',item.conversation_id)+'</footer></article>';
}
async function loadSentBatch(){
 const params=new URLSearchParams({limit:'30'});if(sentCursor)params.set('cursor',sentCursor);
 const d=await api('/api/sent?'+params);
 const found=new Set(sentItems.map(x=>x.id));sentItems.push(...d.items.filter(x=>!found.has(x.id)));
 sentCursor=d.next_cursor||'';sentDone=Boolean(d.done);
 $('#sentList').innerHTML=sentItems.map(sentCard).join('')||'<p class="empty">אין עדיין הודעות יוצאות שנקלטו במערכת.</p>';
 $('#sentStatus').textContent=sentItems.length+' הודעות נטענו'+(sentDone?' · סוף הרשימה':' · ניתן להציג עוד');
 const more=document.querySelector('[data-action="sent-more"]');if(more)more.hidden=sentDone;
}

async function renderWorkInbox(){
 workCursor='';inboxItems=[];
 const [accounts,clients]=await Promise.all([api('/api/accounts'),api('/api/clients')]);
 $('#content').innerHTML='<section class="panel inbox-hub"><div class="section-heading"><h2>תיבת העבודה</h2>'+button('refresh-view','רענון התיבה')+button('sync','סנכרון')+button('compose-new','הודעה חדשה')+button('history-sync','סנכרון היסטוריה ברקע')+button('historical-triage','בדיקת הודעות ישנות')+'</div><div class="work-tabs" role="group" aria-label="תצוגת פניות">'+Object.entries(workLabels).filter(([k])=>k!=='no_action').map(([k,v])=>'<button class="btn '+(k===workView?'primary':'')+'" data-action="work-view" data-id="'+k+'" aria-pressed="'+(k===workView)+'">'+v+'</button>').join('')+'</div><form id="workSearch" class="work-filters"><label>חיפוש בכל ההיסטוריה<input name="q" type="search" value="'+esc(workFilters.q||'')+'"></label><details class="work-advanced"><summary>סינון מתקדם</summary><div class="work-filter-fields"><label>חשבון<select name="account_id">'+optionHtml([['','כל החשבונות'],...accounts.items.map(a=>[a.id,a.label||a.identifier])],workFilters.account_id||'')+'</select></label><label>לקוח<select name="client_id">'+optionHtml([['','כל הפונים'],...clients.items.map(c=>[c.id,c.name])],workFilters.client_id||'')+'</select></label><label>ערוץ<select name="channel">'+optionHtml([['','כל הערוצים'],['email','דואר'],['whatsapp','WhatsApp']],workFilters.channel||'')+'</select></label><label>מתאריך<input type="date" name="from" value="'+esc(workFilters.from||'')+'"></label><label>עד תאריך<input type="date" name="to" value="'+esc(workFilters.to||'')+'"></label><label>עדיפות<select name="priority">'+optionHtml([['','כל העדיפויות'],['high','גבוהה'],['normal','רגילה']],workFilters.priority||'')+'</select></label><label>מיון<select name="sort">'+optionHtml([['time','מהחדש לישן'],['priority','חשיבות בתוצאות שנסרקו']],workFilters.sort||'time')+'</select></label></div></details><button class="btn primary">סינון</button></form><p id="workCoverage" role="status"></p><div id="inboxItems" class="work-grid"></div>'+button('work-more','המשך סריקה')+'</section>';
 await loadWorkBatch();
}
async function loadWorkBatch(){
 const params=new URLSearchParams({...workFilters,view:workView,cursor:workCursor,limit:'50'});
 if(workFilters.to)params.set('to',new Date(workFilters.to+'T23:59:59.999').toISOString());
 if(workFilters.from)params.set('from',new Date(workFilters.from+'T00:00:00').toISOString());
 $('#workCoverage').textContent='סורק שיחות…';
 const d=await api('/api/inbox/work?'+params);workCursor=d.next_cursor;workDone=d.done;
 const identity=x=>x.id;
 const known=new Set(inboxItems.map(identity));inboxItems.push(...d.items.filter(x=>!known.has(identity(x))));
 if(workFilters.sort==='priority')inboxItems.sort((a,b)=>b.priority-a.priority);
 $('#inboxItems').innerHTML=inboxItems.map(workCard).join('')||'<p class="empty">'+(d.done?'לא נמצאו פניות בתצוגה הזו בנתונים שסונכרנו.':'לא נמצאו פניות בחלק שנסרק; המשך סריקה.')+'</p>';
 $('#workCoverage').textContent=inboxItems.length+' פניות · '+(d.done?'הסריקה הסתיימה':'נותרו שיחות לסריקה')+' · '+({failed:'הסנכרון האחרון נכשל; ייתכן שחסרות פניות',verified:'הסנכרון האחרון הסתיים ללא שגיאות',stale:'הסנכרון האחרון ישן; מומלץ לסנכרן',unknown:'לא ידוע מתי הסנכרון האחרון הושלם'})[d.sync?.state||'unknown'];
 const more=document.querySelector('[data-action="work-more"]');if(more)more.hidden=d.done;
}
async function workAction(action,id){
 if(action==='work-view'){workView=id;view='inbox';$('#title').textContent='תיבת העבודה';await renderWorkInbox();return;}
 if(action==='work-more'){await loadWorkBatch();return;}
 if(action==='work-draft'){await openConversation(id);document.querySelector('[data-action="draft"]')?.click();return;}
 if(action==='work-task'){
  const r=await post('/api/inbox/work/'+encodeURIComponent(id)+'/task',{request_id:'act_'+crypto.randomUUID()});workPending.set(id,r);
  $('#workAction-'+id).innerHTML='<p>המשימה ממתינה לאישור; עדיין לא נוצרה.</p>'+button('work-confirm-task','אישור יצירת המשימה',id)+button('work-cancel-task','ביטול',id);return;
 }
 if(action==='work-confirm-task'||action==='work-cancel-task'){
  const a=workPending.get(id);if(!a)throw Error('האישור אינו זמין. יש להכין את המשימה מחדש.');
  if(action==='work-confirm-task'){const r=await post('/api/assistant/actions/'+encodeURIComponent(a.id)+'/confirm',{confirmed:true,confirmation_token:a.confirmation_token});if(r.status!=='completed')throw Error('לא התקבל אישור ביצוע');}
  else await post('/api/assistant/actions/'+encodeURIComponent(a.id)+'/dismiss');
  workPending.delete(id);$('#workAction-'+id).textContent=action==='work-confirm-task'?'המשימה נוצרה ואומתה בשרת.':'ההצעה בוטלה.';return;
 }
 if(action==='work-spam'){
  if(!confirm('לסמן כספאם את כל ההודעות מהשולח בכל השיחות, כולל הודעות עתידיות?'))return;
  const result=await post('/api/inbox/work/'+encodeURIComponent(id)+'/spam');
  const state=await api('/api/inbox/work/'+encodeURIComponent(id));
  await api('/api/inbox/work/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({message_type:'spam',status:'no_action',revision:state.item.revision})});
  if(conversation===id)await openConversation(id);else await render(view);
  $('#notice').textContent='השולח סומן כספאם. הודעות ישנות נוספות יתעדכנו ברקע.';return;
 }
 const fresh=await api('/api/inbox/work/'+encodeURIComponent(id)),x=fresh.item;
 const changes={'work-done':{status:'done'},'work-waiting':{status:'waiting_customer'},'work-progress':{status:'in_progress'},'work-noaction':{status:'no_action'},'work-lead':{caller_type:x.client_id?'customer':'lead',message_type:'business',status:'needs_reply'},'work-spam':{message_type:'spam',status:'no_action'},'work-updates':{message_type:'system',status:'no_action'},'work-auto':{status:'auto',caller_type:'auto',message_type:'auto'}};
 let change=changes[action];
 if(action==='work-snooze'){const value=prompt('מתי לחזור לפנייה? תאריך ושעה, למשל 2026-10-15T10:00');if(!value)return;const date=new Date(value);if(!Number.isFinite(date.getTime()))throw Error('תאריך לא תקין');change={status:'snoozed',snoozed_until:date.toISOString()};}
 if(!change)return;
 await api('/api/inbox/work/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({...change,revision:x.revision})});
 if(conversation===id)await openConversation(id);else await render(view);
 $('#notice').textContent='מצב הטיפול נשמר. אפשר לשחזר סיווג אוטומטי דרך פעולות נוספות.';
}


function readHistoryCursor(){try{return localStorage.getItem('inbox-history-cursor')||'';}catch{return '';}}
function saveHistoryCursor(value){try{localStorage.setItem('inbox-history-cursor',value);}catch{}}



document.addEventListener('submit',async e=>{
 if(e.target.id!=='entityFilterForm')return;e.preventDefault();
 entityFilters=Object.fromEntries(new FormData(e.target));
 try{await render(view);}catch(error){$('#error').textContent=userError(error.message);}
});
