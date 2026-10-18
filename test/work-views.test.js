import test from 'node:test';
import assert from 'node:assert/strict';
import {workGroups,renderWorkView,monthDays} from '../src/work-views.js';
test('work views filter Hebrew, preserve status and keep undated records',()=>{
 const rows=[{id:'a',title:'שיחת לקוח',status:'open',due_date:'2026-10-20'},{id:'b',title:'הצעה',status:'done',due_date:'2026-10-19'},{id:'c',title:'שיחת מעקב',status:'open'}];
 assert.deepEqual(workGroups(rows,{layout:'calendar'}).map(x=>x[0]),['2026-10-19','2026-10-20','undated']);
 assert.deepEqual(workGroups(rows,{layout:'kanban',query:'שיחת',status:'open'})[0][1].map(x=>x.id),['a','c']);
 assert.equal(rows.length,3);
});
test('work view controls escape stored values and never create executable attributes',()=>{
 const html=renderWorkView({items:[{title:'test',status:'"><img src=x onerror=alert(1)>'}],query:'"><script>bad</script>',layout:'kanban',statusLabel:x=>x,button:()=>'',renderRow:()=>'<p>record</p>'});
 assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
 assert.match(html,/aria-pressed="true"/);
});

test('monthly calendar handles leap years and Sunday-first alignment',()=>{
 assert.equal(monthDays('2028-02').dates.length,29);
 assert.equal(monthDays('2026-02').dates.length,28);
 assert.equal(monthDays('2026-10').offset,4);
 assert.throws(()=>monthDays('2026-13'),/invalid_calendar_month/);
 const html=renderWorkView({items:[{title:'undated'},{title:'outside',due_date:'2026-11-01'}],layout:'month',month:'2026-10',statusLabel:x=>x,button:()=>'',renderRow:x=>'<p>'+x.title+'</p>'});
 assert.match(html,/1 פריטים מתוארכים מחוץ לחודש/);assert.match(html,/undated/);assert.doesNotMatch(html,/<p>outside<\/p>/);
 assert.equal((html.match(/class="panel month-day"/g)||[]).length,31);
});
