import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMailHtml,mailHtmlDocument} from '../src/mail-html.js';
test('mail HTML preserves text/table formatting without any active attributes',()=>{
 const clean=sanitizeMailHtml('<p dir="rtl" onclick="alert(1)">שלום &amp; תודה</p><table><tr><td colspan="2" style="background:url(https://tracker)">תוכן</td></tr></table>');
 assert.equal(clean,'<p dir="rtl">שלום &amp; תודה</p><table><tr><td colspan="2">תוכן</td></tr></table>');
});
test('mail HTML blocks scripts, SVG, forms, remote tracking and navigation',()=>{
 const clean=sanitizeMailHtml('<script>alert(1)</script><svg><script>x</script></svg><iframe src="https://evil"></iframe><style>body{}</style><form><input value="x"></form><img src="https://tracker" onerror="x" alt="logo"><a href="javascript:alert(1)" target="_top">link</a>');
 assert.equal(clean,'[logo]link');assert.doesNotMatch(clean,/script|https:|href|src=|form|style/);
});
test('malformed/encoded HTML is inert and rendering is idempotent',()=>{
 for(const payload of ['<IMG SRC=x onerror=alert(1)>','<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">','<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>','<td colspan="1 onclick=x">x</td>']){
  const clean=sanitizeMailHtml(payload);assert.equal(sanitizeMailHtml(clean),clean);
  assert.doesNotMatch(clean,/<(?:script|svg|math|img|iframe)|\son\w+=|\s(?:src|href|style)=/i);
 }
});
test('mail HTML input and nesting are bounded; document blocks network and forms',()=>{
 assert.equal(sanitizeMailHtml('x'.repeat(256*1024+1)),'');
 assert.equal(sanitizeMailHtml(null),'');
 assert.ok(sanitizeMailHtml('<div>'.repeat(100)+'text'+'</div>'.repeat(100)).length<500);
 const html=mailHtmlDocument('<b>hello</b>');
 assert.match(html,/default-src &#39;none&#39;/);assert.match(html,/form-action &#39;none&#39;/);
 assert.ok(html.includes('<b>hello</b>'));
});
