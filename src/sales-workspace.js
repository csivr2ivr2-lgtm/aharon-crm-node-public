const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function renderSales({root,api,post}){
 const route=location.hash,params=new URLSearchParams(location.hash.split('?')[1]||''),q=params.get('q')||'',stage=params.get('stage')||'',layout=params.get('layout')==='list'?'list':'board';
 const data=await api('/api/sales?'+new URLSearchParams({q,stage}));
 if(location.hash!==route)return;
 const options=(rows,value,empty)=>'<option value="">'+empty+'</option>'+rows.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===value?'selected':'')+'>'+esc(x.label||x.name)+'</option>').join('');
 const card=x=>'<article class="panel sales-card"><h3>'+esc(x.title)+'</h3><a href="#client='+encodeURIComponent(x.client_id)+'">'+esc(x.client_name)+'</a><p>מקור: '+esc(x.source||'לא צוין')+'</p><p>פעולה הבאה: '+esc(x.next_action||'לא נקבעה')+'</p><p>מעקב: '+esc(x.followup_date||'לא נקבע')+'</p><small>עדכון הליד: '+esc(x.last_activity_at)+'</small><label>שלב מכירה<select data-lead-stage="'+esc(x.id)+'">'+options(data.stages,x.stage_id,'בחר שלב')+'</select></label><button class="btn" data-edit-lead="'+esc(x.id)+'">עריכת ליד</button></article>';
 root.innerHTML='<section class="sales-workspace"><header class="panel"><h2>לידים ומכירות</h2><p>שלב המכירה נפרד ממצב הלקוח, השיחה והמשימה.</p><div class="actions"><button class="btn primary" id="newLead">ליד חדש</button><button class="btn" id="renameStages">התאמת שמות השלבים</button></div><form id="salesFilter" class="work-filters"><label>חיפוש לידים<input name="q" type="search" maxlength="120" value="'+esc(q)+'"></label><label>שלב<select name="stage">'+options(data.stages,stage,'כל השלבים')+'</select></label><label>תצוגה<select name="layout"><option value="board" '+(layout==='board'?'selected':'')+'>Kanban</option><option value="list" '+(layout==='list'?'selected':'')+'>רשימה</option></select></label><button class="btn">סינון</button></form><p role="status" id="salesStatus"></p></header><div class="'+(layout==='board'?'entity-kanban':'sales-list')+'">'+(layout==='board'?data.stages.filter(s=>!stage||stage===s.id).map(s=>'<section class="sales-column"><h2>'+esc(s.label)+' · '+data.items.filter(x=>x.stage_id===s.id).length+'</h2>'+data.items.filter(x=>x.stage_id===s.id).map(card).join('')+'</section>').join(''):data.items.map(card).join(''))+'</div>'+(data.items.length?'':'<p class="empty">אין לידים בתצוגה זו. ניתן להוסיף ליד חדש או לשנות מסנן.</p>')+(data.limited?'<p>מוצגים 200 לידים; צמצם את החיפוש.</p>':'')+'</section>';
 root.querySelector('#salesFilter').onsubmit=e=>{e.preventDefault();location.hash='sales?'+new URLSearchParams(new FormData(e.target));};
 const refresh=()=>renderSales({root,api,post});
 root.querySelectorAll('[data-lead-stage]').forEach(select=>select.onchange=async()=>{
  const item=data.items.find(x=>x.id===select.dataset.leadStage),next=select.value,old=item.stage_id;
  if(!next||next===old)return;
  if(!confirm('שינוי שלב הליד "'+item.title+'" עבור '+item.client_name+' ל־'+data.stages.find(s=>s.id===next).label+'?')){select.value=old;return;}
  select.disabled=true;
  try{await api('/api/sales/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({...item,stage_id:next,confirmed:true})});await refresh();}
  catch(error){select.value=old;root.querySelector('#salesStatus').textContent=error.message;}finally{select.disabled=false;}
 });
 async function editor(item){
  const clients=await api('/api/clients');if(location.hash!==route)return;
  document.querySelector('#leadEditor')?.remove();
  const dialog=document.createElement('dialog');dialog.id='leadEditor';dialog.setAttribute('aria-labelledby','leadEditorTitle');
  dialog.innerHTML='<form><h2 id="leadEditorTitle">'+(item?'עריכת ליד':'ליד חדש')+'</h2><label>שם הליד<input name="title" maxlength="500" required value="'+esc(item?.title)+'"></label><label>לקוח משויך<select name="client_id" required>'+options(clients.items,item?.client_id,'בחר לקוח')+'</select></label><p>ללקוח חדש, צור תחילה כרטיס במסך לקוחות.</p><label>מקור הגעה<input name="source" maxlength="255" value="'+esc(item?.source)+'"></label><label>שלב מכירה<select name="stage_id" required>'+options(data.stages,item?.stage_id||'new','בחר שלב')+'</select></label><label>הפעולה הבאה<input name="next_action" maxlength="1000" value="'+esc(item?.next_action)+'"></label><label>מועד מעקב<input name="followup_date" type="date" value="'+esc(item?.followup_date)+'"></label><p role="status"></p><div class="actions"><button class="btn primary" type="submit">אישור ושמירת ליד</button><button class="btn" type="button" data-close>ביטול</button></div></form>';
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async e=>{
   e.preventDefault();const submit=e.submitter;submit.disabled=true;
   try{
    const payload={...Object.fromEntries(new FormData(e.target)),confirmed:true,...(item?{revision:item.revision}:{})};
    if(item)await api('/api/sales/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify(payload)});else await post('/api/sales',payload);
    dialog.close();dialog.remove();await refresh();
   }catch(error){dialog.querySelector('[role="status"]').textContent=error.message;}finally{submit.disabled=false;}
  };
  document.body.append(dialog);dialog.showModal();
 }
 root.querySelector('#newLead').onclick=()=>editor().catch(e=>root.querySelector('#salesStatus').textContent=e.message);
 root.querySelectorAll('[data-edit-lead]').forEach(b=>b.onclick=()=>editor(data.items.find(x=>x.id===b.dataset.editLead)).catch(e=>root.querySelector('#salesStatus').textContent=e.message));
 root.querySelector('#renameStages').onclick=async()=>{
  const choice=prompt('מזהה השלב לשינוי:\n'+data.stages.map(x=>x.id+' — '+x.label).join('\n'));
  const selected=data.stages.find(x=>x.id===choice);if(!selected)return;
  const label=prompt('שם חדש לשלב '+selected.label,selected.label);if(!label||label===selected.label)return;
  if(!confirm('לשנות את שם השלב ל־'+label+'? המזהה והשיוכים נשמרים.'))return;
  try{await api('/api/sales/stages/'+encodeURIComponent(selected.id),{method:'PATCH',body:JSON.stringify({label,revision:selected.revision,confirmed:true})});await refresh();}
  catch(error){root.querySelector('#salesStatus').textContent=error.message;}
 };
}
