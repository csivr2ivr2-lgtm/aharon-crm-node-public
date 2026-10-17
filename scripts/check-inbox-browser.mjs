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
const original={id:'conv_test',message_id:'msg_test',sender:'lead@example.test',contact_name:'פונה לדוגמה',title:'הצעת מחיר',subject:'הצעת מחיר',body:'אני מעוניין בעשרה מספרים לקבלת SMS ובאפשרות להרחבה למאה מספרים. <img src=x onerror=alert(1)>',channel:'email',account_label:'בדיקה',integration_key:'google:test',waiting_since:new Date(Date.now()-3600000).toISOString(),revision:0,unread_count:1};
let checks=0,phase='startup';
try{
 for(const width of [360,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const errors=[],writes=[];let row={...original,...decideInbox(original)},taskCreated=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname!=='crm.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:appHtml()});
   if(url.pathname==='/assets/app.js')return route.fulfill({contentType:'text/javascript',body:source});
   const body=req.postDataJSON();if(!['GET','HEAD'].includes(req.method()))writes.push({path:url.pathname,body});
   let result={ok:true,items:[]};
   if(url.pathname==='/api/inbox/work'){const v=url.searchParams.get('view');result={ok:true,items:matchesInbox(row,v)?[row]:[],complete:true,done:true,next_cursor:row.id,sync:{state:'verified'}};}
   else if(url.pathname==='/api/inbox/work/conv_test'){
    if(req.method()==='PATCH'){row={...row,manual_status:body.status,handling_state:body.status,revision:row.revision+1};}
    result={ok:true,item:row};
   }
   else if(url.pathname==='/api/accounts')result={ok:true,items:[{id:'a',label:'חשבון בדיקה'}]};
   else if(url.pathname==='/api/inbox/work/conv_test/task')result={ok:true,id:'act_browser_test',tool:'create_task',status:'pending',confirmation_token:'test-confirmation'};
   else if(url.pathname==='/api/assistant/actions/act_browser_test/confirm'){assert.equal(body.confirmed,true);taskCreated=true;result={ok:true,status:'completed'};}
   else if(url.pathname==='/api/conversations/conv_test')result={ok:true,item:row,messages:[{id:'msg_test',direction:'in',body:original.body,sent_at:original.waiting_since}]};
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
  phase='source-navigation-'+width;
  await page.getByRole('link',{name:'פתח שיחת מקור'}).click();await page.locator('.conversation-layout').waitFor();assert.equal(await page.locator('.message img').count(),0);checks++;
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,`conversation overflow at ${width}`);checks++;
  assert.deepEqual(errors,[]);checks++;
  if(process.env.CRM_SCREENSHOTS){await mkdir(process.env.CRM_SCREENSHOTS,{recursive:true});await page.screenshot({path:process.env.CRM_SCREENSHOTS+`/conversation-${width}.png`,fullPage:true});await page.goto('https://crm.test/#inbox');row={...original,...decideInbox(original)};await page.reload();await page.locator('.work-card').waitFor();await page.screenshot({path:process.env.CRM_SCREENSHOTS+`/inbox-${width}.png`,fullPage:true});}
  await context.close();
 }
 console.log(JSON.stringify({ok:true,widths:[360,390,768,1440],checks,source:'synthetic HTTP fixtures; no live provider or SQL'}));
}catch(error){console.error('::error title=Browser regression::Failed phase '+phase+' ('+String(error.name).replace(/[^a-zA-Z]/g,'')+')');throw error;}finally{await browser.close();}
