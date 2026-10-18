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
export function renderWorkView({items,layout='list',query='',status='',month=new Date().toISOString().slice(0,7),renderRow,statusLabel,button}){
 const statuses=[...new Set(items.map(x=>x.status).filter(Boolean))].sort();
 const controls='<div class="panel"><div role="group" aria-label="תצוגת עבודה">'+[['list','רשימה'],['kanban','Kanban'],['calendar','לוח מועדים'],['month','חודש']].map(([key,label])=>'<button class="btn" data-action="entity-layout" data-id="'+key+'" aria-pressed="'+(layout===key)+'">'+label+'</button>').join('')+'</div>'+
 '<form id="entityFilterForm">'+(layout==='month'?'<label>חודש לתצוגה<input type="month" name="month" value="'+esc(month)+'" required></label>':'')+'<label>חיפוש משימות ופרויקטים<input name="query" value="'+esc(query)+'"></label><label>סינון מצב<select name="status"><option value="">כל המצבים</option>'+statuses.map(s=>'<option value="'+esc(s)+'"'+(status===s?' selected':'')+'>'+esc(statusLabel(s))+'</option>').join('')+'</select></label><button class="btn" type="submit">סינון</button></form>'+button('create','הוספה')+'</div>';
 if(layout==='month')return controls+renderMonth(items,{month,query,status,renderRow});
 const groups=workGroups(items,{layout,query,status});
 return controls+(layout==='calendar'?'<p class="muted">מועדים לפי הרשומות שנטענו. פריטים ללא תאריך מוצגים בנפרד.</p>':'')+
 '<div class="entity-work '+(layout==='kanban'?'entity-kanban':'')+'">'+(groups.map(([key,rows])=>'<section class="panel"><h2>'+esc(key==='all'?'רשומות':key==='undated'?'ללא מועד':layout==='kanban'?statusLabel(key):key)+' <small>('+rows.length+')</small></h2>'+rows.map(renderRow).join('')+'</section>').join('')||'<p class="empty" role="status">אין רשומות התואמות לסינון.</p>')+'</div>';
}

export function monthDays(month){
 if(!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_calendar_month');
 const [year,m]=month.split('-').map(Number);
 if(year<1900||year>2200)throw Error('invalid_calendar_month');
 const first=new Date(Date.UTC(year,m-1,1)),count=new Date(Date.UTC(year,m,0)).getUTCDate();
 return {offset:first.getUTCDay(),dates:Array.from({length:count},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))};
}
function renderMonth(items,{month,query,status,renderRow}){
 let days;try{days=monthDays(month);}catch{return '<p role="alert">יש לבחור חודש תקין בין 1900 ל־2200.</p>';}
 const groups=new Map(workGroups(items,{layout:'calendar',query,status})),undated=groups.get('undated')||[];
 const outside=[...groups].filter(([date])=>date!=='undated'&&!date.startsWith(month+'-')).reduce((n,[,rows])=>n+rows.length,0);
 return '<section class="entity-work"><h2>'+esc('לוח חודשי · '+month)+'</h2><p>מועדים לפי הרשומות שנטענו. '+outside+' פריטים מתוארכים מחוץ לחודש הנבחר.</p>'+
 '<div class="entity-month" aria-label="לוח חודשי">'+['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'].map(d=>'<div class="month-weekday" aria-hidden="true">'+d+'</div>').join('')+
 Array.from({length:days.offset},()=>'<div class="month-spacer" aria-hidden="true"></div>').join('')+
 days.dates.map(date=>'<section class="panel month-day"><h3>'+esc(date)+'</h3>'+((groups.get(date)||[]).map(renderRow).join('')||'<span class="muted">אין מועדים</span>')+'</section>').join('')+'</div>'+
 '<section class="panel"><h2>ללא מועד <small>('+undated.length+')</small></h2>'+undated.map(renderRow).join('')+'</section></section>';
}
