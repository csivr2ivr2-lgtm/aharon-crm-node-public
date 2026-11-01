import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WhatsAppConnector} from '../src/connectors/whatsapp.js';
import {holdSession,readRecoveryHold,backupAuthState} from '../src/connectors/whatsapp-recovery.js';

test('explicit delete works for quarantined main without touching registry or other accounts',async t=>{
 const home=await mkdtemp(join(tmpdir(),'crm-wa-delete-main-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'auth'),other=join(root,'sessions','wa_1234567890abcdef');
 await mkdir(other,{recursive:true});
 const registry='[{"id":"wa_1234567890abcdef","phone":"972501234567"}]';
 await writeFile(join(root,'sessions.json'),registry);
 await writeFile(join(root,'creds.json'),JSON.stringify({registered:true}));
 await writeFile(join(root,'session-abc=+.json'),'{"key":"test"}');
 await writeFile(join(other,'creds.json'),'{"registered":true}');
 await holdSession(root,{reason:'logged_out',code:401});
 assert.equal((await backupAuthState(root)).ok,true);
 const c=new WhatsAppConnector({sessionId:'whatsapp-main',sessionDir:root});
 c.statusValue='logged_out';
 const result=await c.deleteSession();
 assert.equal(result.ok,true);assert.equal(result.status,'disconnected');
 assert.equal(await readFile(join(root,'sessions.json'),'utf8'),registry);
 assert.equal(await readFile(join(other,'creds.json'),'utf8'),'{"registered":true}');
 for(const name of ['creds.json','session-abc=+.json']){
  await assert.rejects(readFile(join(root,name),'utf8'),{code:'ENOENT'});
 }
 assert.equal(await readRecoveryHold(root),null);
 await assert.rejects(readdir(root+'.recovery'),{code:'ENOENT'});
});

test('explicit delete of logged-out secondary session removes local auth and recovery, not siblings',async t=>{
 const home=await mkdtemp(join(tmpdir(),'crm-wa-delete-child-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'auth'),id='wa_aaaaaaaaaaaaaaaa',other=join(root,'sessions','wa_bbbbbbbbbbbbbbbb'),dir=join(root,'sessions',id);
 await mkdir(dir,{recursive:true});await mkdir(other,{recursive:true});
 await writeFile(join(dir,'creds.json'),'{"registered":true}');
 await writeFile(join(other,'creds.json'),'{"registered":true}');
 await holdSession(dir,{reason:'connection_replaced',code:440});
 const c=new WhatsAppConnector({sessionId:id,sessionDir:dir});c.statusValue='recovery_required';
 const status=await c.deleteSession();
 assert.equal(status.status,'disconnected');
 await assert.rejects(readdir(dir),{code:'ENOENT'});
 await assert.rejects(readdir(dir+'.recovery'),{code:'ENOENT'});
 assert.equal(await readFile(join(other,'creds.json'),'utf8'),'{"registered":true}');
});

test('broken socket logout does not block explicitly requested local deletion',async t=>{
 const home=await mkdtemp(join(tmpdir(),'crm-wa-delete-failed-socket-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'auth');
 await mkdir(dir);await writeFile(join(dir,'creds.json'),'{"registered":true}');
 const c=new WhatsAppConnector({sessionId:'whatsapp-main',sessionDir:dir});
 let logouts=0;
 c.sock={logout(){logouts++;throw Error('Connection Closed')},end(){throw Error('already closed')}};
 c.statusValue='connected';
 assert.equal((await c.deleteSession()).status,'disconnected');
 assert.equal(logouts,0);
 await assert.rejects(readFile(join(dir,'creds.json'),'utf8'),{code:'ENOENT'});
});

test('delete refuses to race an in-progress connection',async t=>{
 const home=await mkdtemp(join(tmpdir(),'crm-wa-delete-busy-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 const dir=join(home,'auth');
 await mkdir(dir);await writeFile(join(dir,'creds.json'),'{"registered":true}');
 const c=new WhatsAppConnector({sessionId:'whatsapp-main',sessionDir:dir});
 c.connecting=true;
 await assert.rejects(c.deleteSession(),/whatsapp_session_busy_retry/);
 assert.equal(await readFile(join(dir,'creds.json'),'utf8'),'{"registered":true}');
});

test('UI calls authenticated POST delete route and preserves the existing DELETE API',async()=>{
 const browser=await readFile(new URL('../src/browser.js',import.meta.url),'utf8');
 const server=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
 assert.match(browser,/post\('\/api\/whatsapp\/session\/delete',\{session_id:id\}\)/);
 assert.match(server,/app\.post\("\/api\/whatsapp\/session\/delete",deleteWhatsAppSession\)/);
 assert.match(server,/app\.delete\("\/api\/whatsapp\/session",deleteWhatsAppSession\)/);
});
