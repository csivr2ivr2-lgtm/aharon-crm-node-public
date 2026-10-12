import {createHash} from 'node:crypto';
import {db as defaultDb} from './db.js';
import {enqueueJob} from './platform/jobs.js';
import {nonCustomerSignal} from './ai/inbox-signals.js';

export async function backfillAliExpressPage({cursor=''}={},deps={}){
 if(typeof cursor!=='string'||cursor.length>128)throw Error('invalid_brand_cursor');
 const database=deps.db||defaultDb,enqueue=deps.enqueue||enqueueJob;
 const [rows]=await database.execute('SELECT id,sender,subject,direction FROM messages WHERE id>? ORDER BY id ASC LIMIT 150',[cursor]);
 const ids=rows.filter(m=>m.direction==='in'&&nonCustomerSignal(m)?.source==='brand_rule').map(m=>m.id);
 if(ids.length)await database.execute("UPDATE messages SET classification='spam',classification_score=1,classification_reason='סינון AliExpress לפי מותג',spam_disposition='spam' WHERE id IN ("+ids.map(()=>'?').join(',')+")",ids);
 if(rows.length===150){
  const next=String(rows.at(-1).id);
  if(next<=cursor)throw Error('brand_cursor_not_advancing');
  const hash=createHash('sha256').update(next).digest('hex').slice(0,24);
  await enqueue('brand.cleanup',{cursor:next},{idempotencyKey:'aliexpress-cleanup-20261012:'+hash,db:database,maxAttempts:10});
 }
 return {ok:true,scanned:rows.length,updated:ids.length,done:rows.length<150};
}
