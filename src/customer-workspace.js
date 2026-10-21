// Customer workspace: presentation and short local CRM actions, no provider writes.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const url = (key,id,tab='') => '#'+key+'='+encodeURIComponent(id)+(tab?'&tab='+encodeURIComponent(tab):'');
const list = (items,render) => items?.length ? '<ul class="customer-list">'+items.map(x=>'<li>'+render(x)+'</li>').join('')+'</ul>' : '<p class="empty">אין פריטים משויכים בתצוגה זו.</p>';
export const customerTabs = {overview:'תמונת מצב',conversations:'שיחות',tasks:'משימות ומעקבים',resources:'פרויקטים וקבצים',notes:'הערות',timeline:'ציר זמן'};
export function customerWorkspace(info,resources,{tab='overview',formatDate=x=>x||'',sourceLink=()=>''}={}){
 const e=escape,c=info.client,id=String(c.id),active=customerTabs[tab]?tab:'overview';
 const link=(key,item,text)=>'<a class="btn" href="'+url(key,item)+'">'+e(text)+'</a>';
 const date=x=>e(x?formatDate(x):'לא נקבע מועד');
 const tasks=(info.tasks||[]).filter(x=>!['done','cancelled'].includes(x.status)).sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')));
 const action=(kind,text)=>'<button class="btn" data-customer-action="'+kind+'">'+text+'</button>';
 const conversations=list(info.conversations,x=>link('conversation',x.id,x.title||x.external_id||'שיחה')+'<p class="muted">'+e(x.channel==='whatsapp'?'WhatsApp':'דוא״ל')+' · '+e(x.account_id||'חשבון לא ידוע')+' · '+date(x.last_message_at)+'</p>');
 const taskList=list(info.tasks,x=>'<strong>'+e(x.title)+'</strong><p>'+e(x.status)+' · '+date(x.due_date)+'</p>');
 const reminders=list(info.reminders,x=>'<strong>'+e(x.title)+'</strong><p>'+e(x.status)+' · '+date(x.due_at)+'</p>');
 const projects=list(info.projects,x=>'<strong>'+e(x.name)+'</strong><p>'+e(x.next_step||x.status)+'</p>');
 const files=list(info.files,x=>'<strong>'+e(x.name)+'</strong><p>'+e(x.mime)+'</p>');
 const sourceItems=list(resources.items,r=>'<strong>'+e(r.available?(r.item?.name||r.item?.summary||r.external_id):'המקור אינו זמין בהרשאות הנוכחיות')+'</strong><p>'+e(r.provider)+' · '+e(r.account_id)+'</p>'+(r.available?sourceLink(r.item||{}):'')+'<button class="btn" data-action="unlink-client-resource" data-client="'+e(id)+'" data-id="'+e(r.id)+'">בטל שיוך</button>');
 const notes=list(info.notes,x=>'<p class="note">'+e(x.body)+'</p><small>'+date(x.updated_at)+'</small>');
 const events=[
 ...(info.activities||[]).map(x=>({...x,kind:'פעילות',at:x.created_at})),
 ...(info.notes||[]).map(x=>({...x,kind:'הערה',title:x.body,at:x.updated_at})),
 ...(info.conversations||[]).map(x=>({...x,kind:'שיחה',at:x.last_message_at,href:url('conversation',x.id)}))
 ].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
 const timeline=list(events,x=>'<small>'+e(x.kind)+' · '+date(x.at)+'</small><p class="note">'+(x.href?'<a href="'+x.href+'">'+e(x.title||'שיחה')+'</a>':e(x.title||x.event))+'</p>');
 const section=(title,body)=>'<section class="panel"><h3>'+title+'</h3>'+body+'</section>';
 const panels={
 overview:section('הפעולה הבאה',tasks[0]?'<strong>'+e(tasks[0].title)+'</strong><p>מועד יעד: '+date(tasks[0].due_date)+'</p>'+action('task','הוסף משימת מעקב'):'<p>אין משימה פתוחה משויכת בתצוגה זו.</p>'+action('task','קבע פעולה הבאה'))+section('שיחות אחרונות',conversations)+section('פעילות אחרונה',timeline),
 conversations:section('שיחות משויכות',conversations),
 tasks:section('משימות',taskList)+section('תזכורות ומעקבים',reminders),
 resources:section('פרויקטים',projects)+section('קבצים',files)+section('Drive, Calendar ואנשי קשר',resources.error?'<p role="status">המקורות אינם זמינים כרגע. אפשר לנסות שוב ברענון.</p>':sourceItems),
 notes:section('הערות פנימיות',notes)+action('note','הוסף הערה'),
 timeline:section('ציר זמן',timeline)
 };
 return '<article class="customer-workspace" data-client="'+e(id)+'"><a href="#clients">לקוחות</a><header class="customer-hero"><div><p class="customer-eyebrow">סביבת עבודה ללקוח</p><h2 tabindex="-1">'+e(c.name||'לקוח')+'</h2><p>'+e(c.company||'')+'</p><p class="customer-contact">'+e([c.phone,c.email].filter(Boolean).join(' · '))+'</p><p class="muted">פרטי קשר שנשמרו ב־CRM; אימות עצמאי אינו מתועד.</p></div><span class="tag">מצב לקוח: '+e(c.status||'לא הוגדר')+'</span></header><div class="actions customer-actions">'+action('message','שלח הודעה')+action('task','צור משימה')+action('note','הוסף הערה')+action('task','קבע מעקב')+'<a class="btn" href="#connectors">שייך מקור Google</a></div><nav class="customer-tabs" aria-label="תוכן כרטיס לקוח">'+Object.entries(customerTabs).map(([key,title])=>'<a href="'+url('client',id,key)+'" '+(key===active?'aria-current="page"':'')+'>'+title+'</a>').join('')+'</nav><div class="customer-panels">'+panels[active]+'</div><p class="muted">מוצגים פריטים משויכים במפורש בלבד, עד 20–40 מכל סוג. ציר הזמן מסכם פעילות שנשמרה ואינו יומן מלא של כל שינוי.</p></article>';
}
export function openCustomerAction({client,kind,post,onSaved}){
 document.querySelector('#customerAction')?.remove();
 const isNote=kind==='note',key='crm.customer.form.'+client.id+'.'+kind;
 const dialog=document.createElement('dialog');dialog.id='customerAction';dialog.setAttribute('aria-labelledby','customerActionTitle');
 dialog.innerHTML='<form><h2 id="customerActionTitle">'+(isNote?'הערה פנימית':'משימת מעקב')+'</h2><p>לקוח: '+escape(client.name)+'</p>'+(isNote?'<label>תוכן ההערה<textarea name="body" maxlength="20000" required rows="6"></textarea></label>':'<label>כותרת המשימה<input name="title" maxlength="500" required></label><label>מועד יעד<input name="due_date" type="date"></label><label>פרטים<textarea name="notes" maxlength="20000" rows="4"></textarea></label>')+'<p class="muted">הטיוטה נשמרת בלשונית הנוכחית עד לשמירה. אין שליחת הודעה ללקוח.</p><p role="status" class="customer-form-status"></p><div class="actions"><button class="btn primary" type="submit">שמירה ללקוח זה</button><button class="btn" type="button" data-cancel>סגירה ושמירת טיוטה</button></div></form>';
 const form=dialog.querySelector('form'),status=dialog.querySelector('[role="status"]');
 try{const saved=JSON.parse(sessionStorage.getItem(key)||'{}');for(const field of form.querySelectorAll('[name]'))field.value=saved[field.name]||'';}catch{}
 const remember=()=>{try{sessionStorage.setItem(key,JSON.stringify(Object.fromEntries(new FormData(form))));}catch{status.textContent='שמירת טיוטה מקומית אינה זמינה; יש לשמור לפני סגירה.';}};
 form.addEventListener('input',remember);
 dialog.querySelector('[data-cancel]').onclick=()=>{remember();dialog.close();};
 dialog.addEventListener('cancel',remember);
 form.onsubmit=async event=>{
  event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;status.textContent='שומר…';
  const values=Object.fromEntries(new FormData(form));
  try{
   if(isNote)await post('/api/notes',{entity_type:'client',entity_id:client.id,body:values.body});
   else await post('/api/tasks',{...values,client_id:client.id,status:'open',priority:'normal',automation_mode:'manual'});
   try{sessionStorage.removeItem(key);}catch{}
   dialog.close();dialog.remove();await onSaved();
  }catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
 };
 document.body.append(dialog);dialog.showModal();
}
