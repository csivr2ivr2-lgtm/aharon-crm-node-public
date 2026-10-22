import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server = readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
test('Hostel CRM handoff keeps the Origin of a cross-domain POST visible for server verification',()=>{
  const index=server.indexOf("app.post('/auth/aharon-admin'");
  assert.ok(index!==-1,'handoff endpoint exists');
  const route=server.slice(index,server.indexOf("app.get(\"/api/status\"",index));
  assert.match(route,/Referrer-Policy','origin'/);
  assert.match(route,/<meta name="referrer" content="origin">/);
  assert.doesNotMatch(route,/Referrer-Policy','no-referrer'/);
  assert.match(route,/method="post" action=/);
  assert.match(route,/form-action /);
});
