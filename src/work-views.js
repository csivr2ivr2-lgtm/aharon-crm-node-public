// Pure rendering module; receives only already-authorized records.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function workGroups(items,{layout='list',query='',status=''}={}){
 const q=String(query).trim().toLocaleLowerCase('he');
 const rows=items.filter(x=>(!status||x.status===status)&&(!q||[x.name,x.title,x.notes,x.description].some(v=>String(v||'').toLocaleLowerCase('he').includes(q))));
 const groups=new Map();
 for(const row of rows){
  const date=String(row.due_date||'').slice(0,10);
  const key=layout==='kanban'?String(row.status||'unknown'):layout==='calendar'?(/^\d{4}-\d{2}-\d{2}$/.test(date)?date:'undated'):'all';
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 const entries=[...groups.entries()];
 if(layout==='calendar')entries.sort(([a],[b])=>a==='undated'?1:b==='undated'?-1:a.localeCompare(b));
 return entries;
}
export function renderWorkView({items,layout='list',query='',status='',renderRow,statusLabel,button}){
 const statuses=[...new Set(items.map(x=>x.status).filter(Boolean))].sort();
 const controls='<div class="panel"><div role="group" aria-label="תצוגת עבודה">'+[['list','רשימה'],['kanban','Kanban'],['calendar','לוח מועדים']].map(([key,label])=>'<button class="btn" data-action="entity-layout" data-id="'+key+'" aria-pressed="'+(layout===key)+'">'+label+'</button>').join('')+'</div>'+
 '<form id="entityFilterForm"><label>חיפוש משימות ופרויקטים<input name="query" value="'+esc(query)+'"></label><label>סינון מצב<select name="status"><option value="">כל המצבים</option>'+statuses.map(s=>'<option value="'+esc(s)+'"'+(status===s?' selected':'')+'>'+esc(statusLabel(s))+'</option>').join('')+'</select></label><button class="btn" type="submit">סינון</button></form>'+button('create','הוספה')+'</div>';
 const groups=workGroups(items,{layout,query,status});
 return controls+(layout==='calendar'?'<p class="muted">מועדים לפי הרשומות שנטענו. פריטים ללא תאריך מוצגים בנפרד.</p>':'')+
 '<div class="entity-work '+(layout==='kanban'?'entity-kanban':'')+'">'+(groups.map(([key,rows])=>'<section class="panel"><h2>'+esc(key==='all'?'רשומות':key==='undated'?'ללא מועד':layout==='kanban'?statusLabel(key):key)+' <small>('+rows.length+')</small></h2>'+rows.map(renderRow).join('')+'</section>').join('')||'<p class="empty" role="status">אין רשומות התואמות לסינון.</p>')+'</div>';
}
