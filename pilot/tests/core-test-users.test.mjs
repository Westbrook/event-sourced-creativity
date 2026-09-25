import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {poolFromEnvironment} from '../src/database.mjs';
import {CoreRepository,initializeCore} from '../src/core-repository.mjs';
import {createCoreServer} from '../src/core-http.mjs';

test('app test users cannot escape their verified controller, consent, admission or expiry',{skip:!process.env.PILOT_DATABASE_URL},async()=>{
 const pool=poolFromEnvironment();let server;
 try{
  await initializeCore(pool);const suffix=randomUUID();
  const repo=new CoreRepository(pool,{encryptionRoot:randomBytes(32).toString('base64'),expiresAt:new Date(Date.now()+86400000).toISOString()});
  const identities={};for(const name of ['owner','outsider','viewer']){
   const email=name+'-'+suffix+'@pilot.invalid';identities[name]={issuer:'synthetic-test',subject:email,email};
   await pool.query('INSERT INTO pilot.admissions(email,role) VALUES($1,$2)',[email,name==='viewer'?'viewer':'creator']);
  }
  // This test injects verified identities; core-workflow covers signed assertions.
  let origin;server=createCoreServer({repository:repo,origin:'http://127.0.0.1:5232',verify:async headers=>{const identity=identities[headers.get('test-controller')];if(!identity)throw Error('authentication_required');return identity;}});
  await new Promise(r=>server.listen(5232,'127.0.0.1',r));origin='http://127.0.0.1:5232';
  const req=async(controller,path,selected,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{'test-controller':controller,origin,'content-type':'application/json',...(selected?{'x-still-test-user':selected}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};
  const created=await req('owner','/api/pilot/test-users',null,{displayName:'Second user'});assert.equal(created.status,201);const child=created.value.created.principal_id;
  assert.equal((await req('outsider','/api/session',child)).status,403);
  assert.equal((await req('outsider','/api/pilot/test-users')).value.users.length,1);
  assert.equal((await req('viewer','/api/pilot/test-users',null,{displayName:'No escalation'})).status,403);
  assert.equal((await req('owner','/api/session',child)).value.user.consentVersion,null);
  assert.equal((await req('owner','/api/events',child)).status,428);
  assert.equal((await req('owner','/api/session',child,{action:'accept_terms',ownershipConfirmed:true,providerProcessingConfirmed:true})).status,200);
  assert.equal((await req('owner','/api/events',child)).status,200);
  assert.equal((await req('owner','/api/session')).value.user.consentVersion,null);
  // An unverified caller cannot use a known selector.
  assert.equal((await req('unverified','/api/session',child)).status,401);
  const controller=(await repo.enroll(identities.owner)).principal_id;
  for(let i=0;i<18;i++)await repo.testUsers(controller,'User '+i);
  await assert.rejects(()=>repo.testUsers(controller,'Too many'),/test_user_limit/);
  await pool.query('UPDATE pilot.principals SET disabled_at=clock_timestamp() WHERE principal_id=$1',[child]);
  assert.equal((await req('owner','/api/session',child)).status,401);
  await pool.query('UPDATE pilot.admissions SET disabled_at=clock_timestamp() WHERE email=$1',[identities.owner.email]);
  assert.equal((await req('owner','/api/pilot/test-users')).status,403);
  assert.equal((await req('owner','/api/session',child)).status,403);
  repo.expiresAt='2020-01-01T00:00:00Z';assert.equal((await req('outsider','/api/pilot/test-users')).status,403);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});

test('tab bootstrap pins its user, preserves request bodies, and never leaks selectors to other origins',async()=>{
 const requests=[];let stored='test-a';
 const context={Request,Headers,URL,location:{href:'https://test.p.reve-dev.com/still',origin:'https://test.p.reve-dev.com'},sessionStorage:{getItem:()=>stored},window:{fetch:async r=>{requests.push(r);return r;}}};
 vm.runInNewContext(readFileSync(new URL('../web/test-user-bootstrap.js',import.meta.url),'utf8'),context);
 stored='test-b';await context.window.fetch('/api/events',{method:'POST',body:'{"action":"batch"}',headers:{'content-type':'application/json','x-still-test-user':'attempted-override'}});
 assert.equal(requests[0].headers.get('x-still-test-user'),'test-a');assert.equal(await requests[0].text(),'{"action":"batch"}');
 await context.window.fetch('https://other.example/api/events');assert.equal(requests[1].headers.has('x-still-test-user'),false);
 await context.window.fetch('/assets/app.js');assert.equal(requests[2].headers.has('x-still-test-user'),false);
 const request=new Request('https://test.p.reve-dev.com/api/events',{method:'POST',body:'kept'});await context.window.fetch(request);assert.equal(await requests[3].text(),'kept');
});
