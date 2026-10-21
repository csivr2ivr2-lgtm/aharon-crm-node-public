import {mailHtmlDocument} from '../src/mail-html.js';
import {matchesInbox} from '../src/inbox-workbench.js';
// Optional visual/interaction gate: npm install --no-save playwright; set CRM_CHROMIUM if needed.
// Uses synthetic data and intercepted HTTP only, never a live CRM/account.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {appHtml} from '../src/ui.js';
import {decideInbox} from '../src/ai/inbox-decision.js';
const {chromium}=await import(process.env.CRM_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CRM_CHROMIUM?{executablePath:process.env.CRM_CHROMIUM}:{}),args:['--no-sandbox','--disable-gpu']});
const source=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
const salesSource=await readFile(new URL('../src/sales-workspace.js',import.meta.url),'utf8');
const customerSource=await readFile(new URL('../src/customer-workspace.js',import.meta.url),'utf8');
const workSource=await readFile(new URL('../src/work-views.js',import.meta.url),'utf8');
const original={id:'conv_test',message_id:'msg_test',sender:'lead@example.test',contact_name:'פונה לדוגמה',title:'הצעת מחיר',subject:'הצעת מחיר',body:'אני מעוניין בעשרה מספרים לקבלת SMS ובאפשרות להרחבה למאה מספרים. <img src=x onerror=alert(1)>',channel:'email',account_label:'בדיקה',integration_key:'google:test',waiting_since:new Date(Date.now()-3600000).toISOString(),revision:0,unread_count:1};
let checks=0,phase='startup';
const axeSource=process.env.CRM_AXE_SCRIPT?await readFile(process.env.CRM_AXE_SCRIPT,'utf8'):null;
async function accessibility(page,label){
 if(!axeSource)return;
 await page.addScriptTag({content:axeSource});
 const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)})));
 if(violations.length)console.error('::error title=Accessibility::'+label+' '+JSON.stringify(violations));
 assert.deepEqual(violations,[],label+' accessibility');checks++;
}
try{
 for(const width of [360,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const errors=[],writes=[];let row={...original,...decideInbox(original)},taskCreated=false,holdDriveA=false,releaseDriveA;
  let salesItems=[];
  const salesStages=[{id:'new',label:'ליד חדש',position:0,revision:0},{id:'won',label:'נסגר בהצלחה',position:1,revision:0}];
  const driveAGate=new Promise(resolve=>{releaseDriveA=resolve;});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname!=='crm.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:appHtml()});
   if(url.pathname==='/assets/app.js')return route.fulfill({contentType:'text/javascript',body:source});
   if(url.pathname==='/assets/sales-workspace.js')return route.fulfill({contentType:'text/javascript',body:salesSource});
   if(url.pathname==='/assets/customer-workspace.js')return route.fulfill({contentType:'text/javascript',body:customerSource});
   if(url.pathname==='/assets/work-views.js')return route.fulfill({contentType:'text/javascript',body:workSource});
   const body=req.postDataJSON();if(!['GET','HEAD'].includes(req.method()))writes.push({path:url.pathname,body});
   let result={ok:true,items:[]};
   if(url.pathname==='/api/sales'){
    if(req.method()==='POST'){assert.equal(body.confirmed,true);salesItems.push({...body,id:'lead_test',client_name:'לקוח בדיקה',revision:0});}
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,stages:salesStages,items:salesItems})});
   }
   if(url.pathname==='/api/sales/lead_test'&&req.method()==='PATCH'){
    assert.equal(body.revision,salesItems[0].revision);assert.equal(body.confirmed,true);
    salesItems[0]={...salesItems[0],...body,revision:salesItems[0].revision+1};
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
   }
   if(url.pathname==='/api/clients/client-a/overview')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,client:{id:'client-a',name:'לקוח בדיקה',email:'client@example.test'},conversations:[{id:'conv_test',title:'הצעת מחיר',channel:'email',account_id:'business',last_message_at:original.waiting_since}],tasks:[{id:'task_a',title:'מעקב לקוח',status:'open',due_date:'2026-10-22'}],notes:[],activities:[],files:[],projects:[],reminders:[]})});
   if(url.pathname==='/api/clients/client-b/overview')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,client:{id:'client-b',name:'לקוח אחר'},conversations:[],tasks:[],notes:[]})});
   if(url.pathname==='/api/inbox/work'){const v=url.searchParams.get('view');result={ok:true,items:matchesInbox(row,v)?[row]:[],complete:true,done:true,next_cursor:row.id,sync:{state:'verified'}};}
   else if(url.pathname==='/api/inbox/work/conv_test'){
    if(req.method()==='PATCH'){row={...row,manual_status:body.status,handling_state:body.status,revision:row.revision+1};}
    result={ok:true,item:row};
   }
   else if(url.pathname==='/api/tasks')result={ok:true,items:[{id:'task_a',title:'בדיקת מועד',status:'open',due_date:'2026-10-20',notes:'<img src=x onerror=alert(1)>'},{id:'task_b',title:'מעקב ללא תאריך',status:'done'}]};
   else if(url.pathname==='/api/clients')result={ok:true,items:[{id:'client-a',name:'לקוח בדיקה',email:'client@example.test'}]};
   else if(url.pathname==='/api/connectors')result={ok:true,connectors:[{key:'google',configured:true,status:'connected',accounts:[{id:'drive-a',email:'a@example.test'},{id:'drive-b',email:'b@example.test'}]}]};
   else if(url.pathname==='/api/google/people/cache'){const account=url.searchParams.get('account_id');assert.ok(['drive-a','drive-b'].includes(account));result={ok:true,sync:{checked_at:null,has_next_page:false},items:[{id:'people/same',name:account+' contact',emails:[{value:'<img src=x onerror=alert(1)>'}],phones:[{value:'+972501234567'}]}]};}
   else if(url.pathname==='/api/google/people/sync'){assert.equal(body.account_id,'drive-b');result={ok:true};}
   else if(url.pathname==='/api/google/drive/cache'){const account=url.searchParams.get('account_id');if(holdDriveA&&account==='drive-a')await driveAGate;assert.ok(['drive-a','drive-b'].includes(account));result={ok:true,sync:{checked_at:null,has_next_page:false},items:[{id:'safe',name:account+' document',mimeType:'text/plain',webViewLink:'https://drive.google.com/file/d/safe/view'},{id:'unsafe',name:'<img src=x onerror=alert(1)>',mimeType:'text/plain',webViewLink:'javascript:alert(1)'},{id:'spoof',name:'spoof',webViewLink:'https://drive.google.com.attacker.test/file'},{id:'userinfo',name:'userinfo',webViewLink:'https://user@drive.google.com/file'}]};}
   else if(url.pathname==='/api/google/drive/sync'){assert.equal(body.account_id,'drive-b');result={ok:true};}
   else if(url.pathname==='/api/accounts')result={ok:true,items:[{id:'a',label:'חשבון בדיקה'}]};
   else if(url.pathname==='/api/inbox/work/conv_test/task')result={ok:true,id:'act_browser_test',tool:'create_task',status:'pending',confirmation_token:'test-confirmation'};
   else if(url.pathname==='/api/assistant/actions/act_browser_test/confirm'){assert.equal(body.confirmed,true);taskCreated=true;result={ok:true,status:'completed'};}
   else if(url.pathname==='/api/conversations/conv_test/attachments')result={ok:true,downloads_enabled:true,items:[{message_id:'msg_test',ordinal:0,filename:'report.pdf',mime_type:'application/pdf',size_bytes:3,source:'google.gmail',sent_at:original.waiting_since}]};
   else if(url.pathname==='/api/conversations/conv_test/messages/msg_test/html')result={ok:true,document:mailHtmlDocument('<p>שלום בטוח</p><script>window.top.pwned=true</script><img src="https://tracker.invalid/pixel"><a href="https://tracker.invalid">קישור חסום</a>')};
   else if(url.pathname==='/api/conversations/conv_test')result={ok:true,item:{...row,client_id:'client-a'},messages:[{id:'msg_test',direction:'in',body:original.body,body_html:'<p>שלום בטוח</p>',source:'google.gmail',sent_at:original.waiting_since}]};
   else if(url.pathname==='/api/assistant/sessions')result={ok:true,items:[{id:'chat_test',title:'שיחת בדיקה'}]};
   else if(url.pathname==='/api/assistant/sessions/chat_test')result={ok:true,messages:[{role:'assistant',text:'ממתין לאישור',actions:[{id:'act_chat_test',tool:'create_task',status:'pending',args:{title:'בדיקת רצף'},confirmation_token:'test'}]},{role:'user',text:'הודעה מאוחרת'},{role:'assistant',text:'מקור: /#conversation=conv_test',actions:[]}]};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  });
  phase='inbox-load-'+width;
  await page.goto('https://crm.test/#inbox');await page.locator('.work-card').waitFor();
  assert.equal(await page.locator('.work-card img').count(),0);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,`horizontal overflow at ${width}`);checks++;
  await page.locator('[data-action="work-view"][data-id="needs_reply"]').click();
  await page.locator('.work-card').waitFor();
  await accessibility(page,'inbox-'+width);
  phase='task-approval-'+width;
  await page.locator('.work-card summary').filter({hasText:'פעולות נוספות'}).click();
  await page.getByRole('button',{name:'צור משימה',exact:true}).click();await page.getByRole('button',{name:'אישור יצירת המשימה'}).waitFor();assert.equal(taskCreated,false);checks++;
  await page.getByRole('button',{name:'אישור יצירת המשימה'}).click();await page.getByText('המשימה נוצרה ואומתה בשרת.').waitFor();assert.equal(taskCreated,true);checks++;
  phase='mark-done-'+width;
  await page.getByRole('button',{name:'טופל',exact:true}).click();await page.getByText('לא נמצאו פניות בתצוגה הזו בנתונים שסונכרנו.').waitFor();assert.equal(writes.filter(x=>x.path==='/api/inbox/work/conv_test').length,1);checks++;
  phase='assistant-history-'+width;
  await page.goto('https://crm.test/#assistant');await page.locator('.assistant-action-card').waitFor();
  const text=await page.locator('#chatLog').textContent();assert.ok(text.indexOf('אישור וביצוע')<text.indexOf('הודעה מאוחרת'));checks++;
  await page.reload();await page.locator('.assistant-action-card').waitFor();assert.equal(await page.locator('.assistant-action-card').count(),1);checks++;
  await accessibility(page,'assistant-'+width);
  phase='source-navigation-'+width;
  await page.getByRole('link',{name:'פתח שיחת מקור'}).click();await page.locator('.conversation-layout').waitFor();assert.equal(await page.locator('.message img').count(),0);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,`conversation overflow at ${width}`);checks++;
  await accessibility(page,'conversation-'+width);
  const gmailWritesBefore=writes.filter(w=>w.path.endsWith('/gmail-state')).length;
  await page.getByRole('button',{name:'פעולות Gmail',exact:true}).click();
  await page.locator('#gmailActionDialog').waitFor();
  await page.locator('#gmailActionDialog').getByRole('button',{name:'ביטול',exact:true}).click();
  assert.equal(writes.filter(w=>w.path.endsWith('/gmail-state')).length,gmailWritesBefore);checks++;
  await page.getByRole('button',{name:'פעולות Gmail',exact:true}).click();
  await page.getByLabel('פעולה',{exact:true}).selectOption('archive');
  await page.getByRole('button',{name:'אישור שינוי ב־Gmail',exact:true}).click();
  await page.getByText('השינוי התקבל ב־Google. התצוגה המקומית תתעדכן בסנכרון הבא.',{exact:true}).waitFor();
  const gmailWrites=writes.filter(w=>w.path.endsWith('/gmail-state'));
  assert.equal(gmailWrites.length,gmailWritesBefore+1);checks++;
  assert.deepEqual(gmailWrites.at(-1).body,{action:'archive',confirmed:true});checks++;
  assert.equal(gmailWrites.at(-1).path,'/api/conversations/conv_test/messages/msg_test/gmail-state');checks++;
  await accessibility(page,'gmail-action-'+width);
  await page.locator('#gmailActionDialog').getByRole('button',{name:'ביטול',exact:true}).click();

  await page.getByRole('button',{name:'קבצים מצורפים',exact:true}).click();
  await page.locator('#attachmentInfoDialog').waitFor();
  assert.equal(await page.getByRole('link',{name:'הורדה מהספק',exact:true}).getAttribute('href'),'/api/conversations/conv_test/attachments/msg_test/0/download');checks++;
  await page.locator('#attachmentInfoDialog').getByRole('button',{name:'סגירה',exact:true}).click();
  await page.getByRole('button',{name:'תצוגת דואר מעוצבת',exact:true}).click();
  await page.locator('#mailHtmlDialog iframe').waitFor();
  assert.equal(await page.locator('#mailHtmlDialog iframe').getAttribute('sandbox'),'');checks++;
  await page.frameLocator('#mailHtmlDialog iframe').getByText('שלום בטוח',{exact:true}).waitFor();checks++;
  assert.equal(await page.frameLocator('#mailHtmlDialog iframe').locator('script,img,a,form').count(),0);checks++;
  assert.equal(await page.evaluate(()=>window.pwned),undefined);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);checks++;
  await accessibility(page,'mail-preview-'+width);
  await page.locator('#mailHtmlDialog').getByRole('button',{name:'סגירה',exact:true}).click();

  phase='work-views-'+width;
  await page.goto('https://crm.test/#tasks');await page.locator('#entityFilterForm').waitFor();
  await page.getByRole('button',{name:'Kanban',exact:true}).click();await page.locator('.entity-kanban').waitFor();
  assert.equal(await page.locator('.entity-work img').count(),0);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'board overflow '+width);checks++;
  await page.getByRole('button',{name:'לוח מועדים',exact:true}).click();await page.getByRole('heading',{name:'2026-10-20 (1)',exact:true}).waitFor();
  await page.getByRole('heading',{name:'ללא מועד (1)',exact:true}).waitFor();checks++;
  await page.getByLabel('חיפוש משימות ופרויקטים').fill('בדיקת מועד');
  await page.getByRole('button',{name:'סינון',exact:true}).click();
  await page.getByRole('heading',{name:'ללא מועד (1)',exact:true}).waitFor({state:'detached'});checks++;
  phase='month-calendar-'+width;
  await page.getByRole('button',{name:'חודש',exact:true}).click();
  await page.getByLabel('חודש לתצוגה').fill('2026-10');
  await page.getByLabel('חיפוש משימות ופרויקטים').fill('');
  await page.getByRole('button',{name:'סינון',exact:true}).click();
  await page.getByRole('heading',{name:'לוח חודשי · 2026-10',exact:true}).waitFor();
  assert.equal(await page.locator('.month-day').count(),31);checks++;
  assert.equal(await page.locator('.month-day').filter({hasText:'2026-10-20'}).getByText('בדיקת מועד',{exact:true}).count(),1);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'month overflow '+width);checks++;
  await page.getByLabel('חודש לתצוגה').fill('2028-02');
  await page.getByRole('button',{name:'סינון',exact:true}).click();
  await page.getByRole('heading',{name:'לוח חודשי · 2028-02',exact:true}).waitFor();
  assert.equal(await page.locator('.month-day').count(),29);checks++;
  await accessibility(page,'month-'+width);
  phase='drive-mirror-'+width;
  await page.goto('https://crm.test/#connectors');
  await page.locator('[data-action="drive-mirror"][data-id="drive-a"]').click();
  await page.getByText('drive-a document',{exact:true}).waitFor();
  assert.equal(writes.filter(x=>x.path==='/api/google/drive/sync').length,0);checks++;
  assert.equal(await page.locator('#providerFolders img').count(),0);checks++;
  assert.equal(await page.locator('#providerFolders a').count(),1);checks++;
  assert.equal(await page.locator('#providerFolders a').getAttribute('rel'),'noopener noreferrer');checks++;
  await page.locator('[data-action="drive-mirror"][data-id="drive-b"]').click();
  await page.getByText('drive-b document',{exact:true}).waitFor();
  assert.equal(await page.getByText('drive-a document',{exact:true}).count(),0);checks++;
  await page.locator('[data-action="drive-sync"]').click();
  await page.getByText('drive-b document',{exact:true}).waitFor();
  assert.equal(writes.filter(x=>x.path==='/api/google/drive/sync').length,1);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Drive overflow '+width);checks++;
  phase='provider-response-race-'+width;
  holdDriveA=true;
  const pendingA=page.waitForRequest(r=>r.url().includes('/api/google/drive/cache?account_id=drive-a'));
  await page.locator('[data-action="drive-mirror"][data-id="drive-a"]').click();await pendingA;
  await page.locator('[data-action="drive-mirror"][data-id="drive-b"]').click();
  await page.getByText('drive-b document',{exact:true}).waitFor();
  const finishedA=page.waitForResponse(r=>r.url().includes('/api/google/drive/cache?account_id=drive-a'));
  releaseDriveA();await finishedA;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.getByText('drive-a document',{exact:true}).count(),0);checks++;
  assert.equal(await page.getByText('drive-b document',{exact:true}).count(),1);checks++;

  phase='resource-client-link-'+width;
  await page.locator('[data-action="link-client-resource"][data-id="safe"]').click();
  await page.getByRole('dialog',{name:'שיוך מקור ללקוח'}).waitFor();
  const resourceWrites=()=>writes.filter(x=>x.path==='/api/clients/client-a/resources');
  assert.equal(resourceWrites().length,0);checks++;
  await page.getByRole('button',{name:'ביטול',exact:true}).click();
  assert.equal(resourceWrites().length,0);checks++;
  await page.locator('[data-action="link-client-resource"][data-id="safe"]').click();
  await page.getByLabel('לקוח',{exact:true}).selectOption('client-a');
  await page.getByRole('button',{name:'אישור שיוך',exact:true}).click();
  await page.getByText('המקור שויך ללקוח. ניתן לראות אותו בכרטיס הלקוח.',{exact:true}).waitFor();
  assert.deepEqual(resourceWrites().map(x=>x.body),[{provider:'google.drive',account_id:'drive-b',external_id:'safe',confirmed:true}]);checks++;
  await accessibility(page,'resource-link-'+width);
  await page.getByRole('button',{name:'ביטול',exact:true}).click();
  phase='people-mirror-'+width;
  await page.locator('[data-action="people-mirror"][data-id="drive-a"]').click();
  await page.getByText('drive-a contact',{exact:true}).waitFor();
  assert.equal(writes.filter(x=>x.path==='/api/google/people/sync').length,0);checks++;
  assert.equal(await page.locator('#providerFolders img').count(),0);checks++;
  await page.locator('[data-action="people-mirror"][data-id="drive-b"]').click();
  await page.getByText('drive-b contact',{exact:true}).waitFor();
  assert.equal(await page.getByText('drive-a contact',{exact:true}).count(),0);checks++;
  await page.locator('[data-action="people-sync"]').click();
  await page.getByText('drive-b contact',{exact:true}).waitFor();
  assert.equal(writes.filter(x=>x.path==='/api/google/people/sync').length,1);checks++;
  const denied=async dialog=>dialog.dismiss();
  page.once('dialog',denied);
  await page.locator('[data-action="people-permission"][data-id="drive-b"]').click();
  assert.equal(writes.filter(x=>x.path==='/api/google/permission-url').length,0);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'Contacts overflow '+width);checks++;
  await accessibility(page,'connectors-'+width);

  phase='customer-workspace-'+width;
  await page.goto('https://crm.test/#client=client-a');
  await page.getByRole('heading',{name:'לקוח בדיקה',exact:true,level:2}).waitFor();
  assert.equal(await page.locator('#client360Dialog').count(),0);checks++;
  await page.getByRole('link',{name:'משימות ומעקבים',exact:true}).click();
  await page.getByText('מעקב לקוח',{exact:true}).waitFor();
  await page.reload();await page.getByText('מעקב לקוח',{exact:true}).waitFor();checks++;
  await page.getByRole('button',{name:'הוסף הערה',exact:true}).click();
  await page.getByLabel('תוכן ההערה').fill('טיוטה ללקוח א');
  await page.getByRole('button',{name:'סגירה ושמירת טיוטה',exact:true}).click();
  await page.goto('https://crm.test/#client=client-b');
  await page.getByRole('heading',{name:'לקוח אחר',exact:true,level:2}).waitFor();
  await page.getByRole('button',{name:'הוסף הערה',exact:true}).click();
  assert.equal(await page.getByLabel('תוכן ההערה').inputValue(),'');checks++;
  await page.getByRole('button',{name:'סגירה ושמירת טיוטה',exact:true}).click();
  await page.goto('https://crm.test/#client=client-a');
  await page.getByRole('heading',{name:'לקוח בדיקה',exact:true,level:2}).waitFor();
  await page.getByRole('button',{name:'הוסף הערה',exact:true}).click();
  assert.equal(await page.getByLabel('תוכן ההערה').inputValue(),'טיוטה ללקוח א');checks++;
  await page.getByRole('button',{name:'שמירה ללקוח זה',exact:true}).click();
  await page.getByText('הפעולה נשמרה ללקוח.',{exact:true}).waitFor();
  assert.deepEqual(writes.filter(w=>w.path==='/api/notes').at(-1).body,{entity_type:'client',entity_id:'client-a',body:'טיוטה ללקוח א'});checks++;
  await page.getByRole('button',{name:'צור משימה',exact:true}).click();
  await page.getByLabel('כותרת המשימה').fill('לחזור ללקוח א');
  await page.getByLabel('מועד יעד').fill('2026-10-23');
  await page.getByRole('button',{name:'שמירה ללקוח זה',exact:true}).click();
  await page.locator('#customerAction').waitFor({state:'detached'});
  assert.equal(writes.filter(w=>w.path==='/api/tasks').at(-1).body.client_id,'client-a');checks++;
  await page.getByRole('heading',{name:'לקוח בדיקה',exact:true,level:2}).waitFor();
  await page.getByRole('link',{name:'שיחות',exact:true}).click();
  await page.getByRole('heading',{name:'שיחות משויכות',exact:true}).waitFor();
  await page.getByRole('link',{name:'הצעת מחיר',exact:true}).click();
  await page.locator('.conversation-layout').waitFor();
  await page.getByLabel('תשובה',{exact:true}).fill('תשובה שטרם נשמרה');
  await page.getByRole('link',{name:'פתח כרטיס לקוח',exact:true}).click();
  await page.getByRole('heading',{name:'לקוח בדיקה',exact:true,level:2}).waitFor();checks++;
  await page.goBack();await page.locator('.conversation-layout').waitFor();
  assert.equal(await page.getByLabel('תשובה',{exact:true}).inputValue(),'תשובה שטרם נשמרה');checks++;
  await page.reload();await page.locator('.conversation-layout').waitFor();
  assert.equal(await page.getByLabel('תשובה',{exact:true}).inputValue(),'תשובה שטרם נשמרה');checks++;
  await page.getByRole('button',{name:'צור משימה מהשיחה',exact:true}).click();
  await page.getByRole('button',{name:'אישור יצירת המשימה',exact:true}).waitFor();
  await page.getByRole('button',{name:'ביטול',exact:true}).click();
  await page.getByText('ההצעה בוטלה.',{exact:true}).waitFor();checks++;
  await page.getByRole('link',{name:'פתח כרטיס לקוח',exact:true}).click();
  await page.getByRole('heading',{name:'לקוח בדיקה',exact:true,level:2}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'customer overflow '+width);checks++;
  await accessibility(page,'customer-'+width);
  if(process.env.CRM_SCREENSHOTS){await mkdir(process.env.CRM_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.CRM_SCREENSHOTS+`/customer-${width}.png`,fullPage:true});}


  phase='sales-workflow-'+width;
  await page.goto('https://crm.test/#sales');
  await page.getByRole('button',{name:'ליד חדש',exact:true}).click();
  await page.getByLabel('שם הליד',{exact:true}).fill('הזדמנות חדשה');
  await page.getByLabel('לקוח משויך',{exact:true}).selectOption('client-a');
  await page.getByLabel('מקור הגעה',{exact:true}).fill('אתר');
  await page.getByLabel('הפעולה הבאה',{exact:true}).fill('שיחת היכרות');
  await page.getByRole('button',{name:'אישור ושמירת ליד',exact:true}).click();
  await page.locator('.sales-card').waitFor();
  assert.equal(salesItems[0].client_id,'client-a');checks++;
  page.once('dialog',d=>d.dismiss());
  await page.locator('[data-lead-stage="lead_test"]').selectOption('won');
  assert.equal(salesItems[0].stage_id,'new');checks++;
  page.once('dialog',d=>d.accept());
  await page.locator('[data-lead-stage="lead_test"]').selectOption('won');
  await page.getByRole('heading',{name:'נסגר בהצלחה · 1',exact:true}).waitFor();
  await page.reload();await page.locator('.sales-card').waitFor();
  assert.equal(await page.locator('[data-lead-stage="lead_test"]').inputValue(),'won');checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'sales overflow '+width);checks++;
  await accessibility(page,'sales-'+width);
  if(process.env.CRM_SCREENSHOTS)await page.screenshot({path:process.env.CRM_SCREENSHOTS+`/sales-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);checks++;
  if(process.env.CRM_SCREENSHOTS){await mkdir(process.env.CRM_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.CRM_SCREENSHOTS+`/conversation-${width}.png`,fullPage:true});await page.goto('https://crm.test/#inbox');row={...original,...decideInbox(original)};await page.reload();await page.locator('.work-card').waitFor();await page.screenshot({path:process.env.CRM_SCREENSHOTS+`/inbox-${width}.png`,fullPage:true});}
  await context.close();
 }
 console.log(JSON.stringify({ok:true,widths:[360,390,768,1440],checks,source:'synthetic HTTP fixtures; no live provider or SQL'}));
}catch(error){console.error('::error title=Browser regression::Failed phase '+phase+' ('+String(error.name).replace(/[^a-zA-Z]/g,'')+')');console.error('::error title=Synthetic browser detail::'+String(error.message).slice(0,1800).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A'));throw error;}finally{await browser.close();}
