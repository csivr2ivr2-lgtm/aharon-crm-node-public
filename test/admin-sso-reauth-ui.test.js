import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminReauthHtml} from '../src/ui.js';
const challenge='1700000000000.'+'a'.repeat(32)+'.'+'b'.repeat(64),nonce='testNonce123456';
test('reauth matches CRM login styling and provides responsive accessible password toggle',()=>{
 const html=adminReauthHtml({challenge,nonce});
 for(const part of ['lang="he" dir="rtl"','name="viewport"','class="login admin-reauth"','Aharon CRM','id="togglePassword"','aria-pressed="false"','name="password"','autocomplete="off"','class="btn primary reauth-submit"','name="challenge"','href="/"','nonce="'+nonce+'"'])assert.ok(html.includes(part),part);
 assert.match(html,/toggle\.addEventListener/);
 assert.match(html,/style nonce=/);
 assert.match(html,/script nonce=/);
 assert.doesNotMatch(html,/כתובת שהשרת מזהה|HOSTEL_SSO_ALLOWED_IPS/);
});
test('reauth validation error stays on the same accessible card',()=>{
 const html=adminReauthHtml({challenge,nonce,error:true});
 assert.match(html,/class="login-error" role="alert"/);
 assert.match(html,/aria-invalid="true" aria-describedby="reauthError"/);
 assert.match(html,/action="\/auth\/aharon-admin\/confirm"/);
});
test('blocked transition uses same login card with no password form',()=>{
 const html=adminReauthHtml({nonce,unavailable:true});
 assert.match(html,/הכניסה לא זמינה/);
 assert.match(html,/class="login admin-reauth"/);
 assert.doesNotMatch(html,/name="password"/);
 assert.doesNotMatch(html,/<script nonce=/);
});
test('reauth CSP only allows nonce-matched inline assets',()=>{
 const source=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const part=source.slice(source.indexOf('function adminReauthHeaders('),source.indexOf("app.post('/auth/aharon-admin'"));
 assert.match(part,/style-src 'nonce-/);
 assert.match(part,/script-src 'nonce-/);
 assert.match(part,/form-action 'self'/);
 assert.match(part,/no-referrer/);
 assert.doesNotMatch(part,/unsafe-inline/);
});
