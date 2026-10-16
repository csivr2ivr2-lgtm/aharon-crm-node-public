import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const browser=readFileSync(new URL('../src/browser.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
test('CRM has an accessible Sent navigation route backed by a dedicated API',()=>{
 assert.match(ui,/\["sent", "send-check", "נשלחו"\]/);
 assert.match(browser,/if\(view==='sent'\)/);
 assert.match(browser,/api\/sent\?/);
 assert.match(browser,/sentCursor/);
});
test('WhatsApp composer never displays the email subject and uses message label',()=>{
 assert.match(browser,/#outboundDialog \[hidden\]\{display:none!important\}/);
 assert.match(browser,/subject.hidden=channel!=='email'/);
 assert.match(browser,/querySelector\('input'\).required=channel==='email'/);
 assert.match(browser,/channel==='email'\?'תוכן הדוא״ל':'הודעת WhatsApp'/);
 assert.match(browser,/fields.channel==='email'\?'\\nנושא:/);
});
