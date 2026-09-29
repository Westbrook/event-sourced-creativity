import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {routeFixture,defaultReadTerms,nativeRequest} from './sponsor-intake-route-fixture.mjs';
const [{createSponsorImageIntakeRoute},{registeredExperience},{createSponsorImageIntakeRuntime}]=await Promise.all([
  import('../worker/experience-sponsor-intake-route.ts'),import('../src/experiences/intake.ts'),import('../src/experiences/sponsor-intake-client.ts'),
]);
const base='/api/experiences/sponsor/image',originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Dormant sponsor route prohibits network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const config=f=>({version:1,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:f.campaignId});
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_attempts ORDER BY admitted_at_ms,attempt_id').all();
const creative=f=>Object.fromEntries(['private_content','experience_sponsor_intakes','experience_sponsor_resource_receipts','events','event_private_payloads','event_client_receipts']
  .map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
const preparedBody=(f,request=f.nativeRequest)=>({action:'prepare-sponsored-image-draft',campaignId:f.campaignId,request});
const committedBody=(f,plan)=>({action:'commit-sponsored-image-draft',campaignId:f.campaignId,draftId:plan.draftId,draftHash:plan.draftHash});
async function call(f,route,method,path,body,options){const response=await route(f.httpRequest(method,base+path,body,options),f.env);assert.ok(response instanceof Response);return {response,body:await response.clone().json()};}
async function prepare(f,route,request){const result=await call(f,route,'POST','/drafts',preparedBody(f,request));assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.body.status,'prepared');return result.body;}
async function commit(f,route,plan){const result=await call(f,route,'POST',`/drafts/${plan.draftId}/commit`,committedBody(f,plan));assert.equal(result.response.status,200,JSON.stringify(result.body));assert.equal(result.body.status,'complete');return result.body;}
const revoke=f=>f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
const hookBatch=(f,predicate,hook)=>{const original=f.DB.batch.bind(f.DB);let fired=0;f.DB.batch=async statements=>{if(predicate(statements)){fired++;await hook(statements);}return original(statements);};return ()=>fired;};

/** Only HTTP plumbing is test-owned. The command transport calls the real
 * dormant route, which calls actual native storage/commit and read admission. */
function wireFor(f,route,{afterResponse}={}){
  const calls=[],responses=[];
  async function transport(command,{signal}){
    assert.ok(signal instanceof AbortSignal);let method,path,body;
    if(command.action==='prepare-sponsored-image-draft'){method='POST';path='/drafts';body=command;}
    else if(command.action==='commit-sponsored-image-draft'){method='POST';path=`/drafts/${command.draftId}/commit`;body=command;}
    else if(command.action==='read-experience-draft'){method='GET';path=command.draftId?`/drafts/${command.draftId}`:`/drafts?intentId=${command.intentId}`;}
    else if(command.action==='read-experience-intake-receipt'){method='GET';path=`/drafts/${command.draftId}/receipt`;}
    else throw Error('unexpected command');
    const request=f.httpRequest(method,base+path,body,{signal});calls.push({command:structuredClone(command),method,path,signal,request});
    const response=await route(request,f.env);assert.ok(response instanceof Response);responses.push(await response.clone().json());
    return afterResponse?afterResponse(command,response):response;
  }
  return {transport,calls,responses};
}

 test('absent and explicitly disabled configuration is untouched before request, environment or database access',async()=>{
  const tripwire=new Proxy({}, {get(){throw Error('disabled handler touched input');}});
  for(const selected of [undefined,{version:1,enabled:false}])assert.equal(await createSponsorImageIntakeRoute(selected)(tripwire,tripwire),null);
});

test('configuration is synchronous, closed and canonical-principal Image only without invoking accessors',()=>{
  const valid={version:1,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:'campaign'};let accessed=0;
  const accessor={...valid};Object.defineProperty(accessor,'freshCampaignId',{enumerable:true,get(){accessed++;return 'campaign';}});
  for(const selected of [null,{}, {...valid,version:2},{...valid,audience:'guest'},{...valid,output:'video'},{...valid,freshCampaignId:''},
    {...valid,payerUserId:'payer'},{...valid,actorUserId:'actor'},{...valid,limits:{}},{...valid,selectCampaign:()=> 'campaign'},
    {version:1,enabled:false,output:'image'},accessor])assert.throws(()=>createSponsorImageIntakeRoute(selected),/sponsor_intake_route_config_invalid/u);
  assert.equal(accessed,0);
});

test('namespace, methods and exact selectors close malformed aliases before any database access',async()=>{
  const route=createSponsorImageIntakeRoute({version:1,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:'campaign'});
  const env=new Proxy({}, {get(){throw Error('invalid route touched environment');}}),draft=`experience-draft-${'a'.repeat(64)}`,intent=randomUUID();
  for(const path of ['/api/experiences/drafts',base+'-other/bootstrap','/unrelated'])assert.equal(await route(new Request('http://localhost'+path),env),null);
  const cases=[['GET',''],['GET','/drafts'],['GET','/drafts/'],['GET','/bootstrap?campaignId=caller'],['GET',`/bootstrap?intentId=${intent}&intentId=${intent}`],
    ['GET',`/bootstrap?intentId=${intent}&draftId=${draft}`],['GET',`/drafts?draftId=${draft}`],['GET',`/drafts/${draft}?x=1`],
    ['POST','/bootstrap'],['DELETE','/drafts'],['POST',`/drafts/${draft}`],['GET',`/drafts/${draft}/commit`],['POST',`/drafts/${draft}/receipt`],
    ['HEAD','/bootstrap'],['GET','/drafts/invalid'],['GET',`/drafts/${draft}/receipt/`],['POST','/drafts?x=1']];
  for(const [method,path] of cases){const response=await route(new Request('http://localhost'+base+path,{method}),env);assert.ok([400,405].includes(response.status),`${method} ${path}`);assert.equal(response.headers.get('cache-control'),'private, no-store');}
});

test('fresh bootstrap then actual POST prepare and commit preserve the exact native marked plan and receipt',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));assert.equal(count(f,'events'),0);
  const bootstrap=await call(f,route,'GET','/bootstrap');assert.equal(bootstrap.response.status,200);assert.equal(bootstrap.body.mode,'fresh');assert.equal(bootstrap.body.actorUserId,f.actor);
  const saved=await prepare(f,route),plan=saved.plan;assert.ok(plan.sponsor_intake);assert.equal(count(f,'events'),0);assert.equal(saved.replayed,false);
  const stored=JSON.parse(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(plan.draftId).content);assert.deepEqual(stored,plan);
  const original=await commit(f,route,plan);assert.equal(original.replayed,false);assert.deepEqual(original.appended.map(({type,payload})=>({type,payload})),plan.events);
  const read=await call(f,route,'GET',`/drafts/${plan.draftId}/receipt`);assert.equal(read.response.status,200);assert.deepEqual(read.body.appended,original.appended);
  assert.equal(read.body.draftHash,plan.draftHash);assert.equal(read.body.documentId,plan.documentId);assert.equal(read.body.generation,'unavailable');
  assert.equal(count(f,'private_content'),1);assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);
  assert.deepEqual(attempts(f).map(a=>a.operation).sort(),['image-intake-bootstrap','image-intake-draft','image-intake-receipt','image-intake-receipt'].sort());
  for(const attempt of attempts(f))assert.equal(attempt.maximum_bytes,f.readTerms.operations[attempt.operation].maximumBytes);f.assertNoPaidWork();
});

test('all five client commands use actual HTTP methods and recover lost acknowledgments by original GET aliases',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));let prepareAck=false,commitAck=false;
  const wire=wireFor(f,route,{afterResponse(command,response){if(command.action==='prepare-sponsored-image-draft'&&!prepareAck){prepareAck=true;throw Error('lost_prepare_ack');}
    if(command.action==='commit-sponsored-image-draft'&&!commitAck){commitAck=true;throw Error('lost_commit_ack');}return response;}});
  const runtime=createSponsorImageIntakeRuntime(await registeredExperience('image'),{version:1,campaignId:f.campaignId,actorUserId:f.actor},wire.transport);t.after(()=>runtime.dispose());
  runtime.change('subject','A copper lamp in a library');runtime.change('ratio',{width:1,height:1});await runtime.prepare();assert.equal(runtime.state.phase,'uncertain');
  const plan=wire.responses[0].plan;await runtime.recover();assert.deepEqual(runtime.preparedPlan,plan);assert.equal(count(f,'events'),0);
  await runtime.submit();assert.equal(runtime.state.phase,'uncertain');const committed=wire.responses.at(-1);await runtime.recover();assert.equal(runtime.state.phase,'complete');
  assert.deepEqual(runtime.committedPlan,plan);assert.deepEqual(runtime.receipt.appended,committed.appended);assert.deepEqual(runtime.receipt,wire.responses.at(-1));
  const resume=createSponsorImageIntakeRuntime(await registeredExperience('image'),{version:1,campaignId:f.campaignId,actorUserId:f.actor},wire.transport);t.after(()=>resume.dispose());
  await resume.resume(plan.draftId);assert.equal(resume.state.phase,'complete');assert.deepEqual(resume.committedPlan,plan);
  assert.ok(wire.calls.some(c=>c.method==='GET'&&c.command.intentId));assert.ok(wire.calls.some(c=>c.method==='GET'&&c.command.draftId&&c.command.action==='read-experience-draft'));
  assert.equal(wire.calls.filter(c=>c.command.action==='prepare-sponsored-image-draft').length,1);assert.equal(wire.calls.filter(c=>c.command.action==='commit-sponsored-image-draft').length,1);
  assert.equal(attempts(f).length,wire.calls.length);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);f.assertNoPaidWork();
});

test('POST replay charges again without resetting storage or original native identity',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),saved=await prepare(f,route),before=creative(f);
  const replay=await prepare(f,route);assert.equal(replay.replayed,true);assert.deepEqual(replay.plan,saved.plan);assert.deepEqual(creative(f),before);
  await commit(f,route,saved.plan);const complete=creative(f),again=await commit(f,route,saved.plan);assert.equal(again.replayed,true);assert.deepEqual(creative(f),complete);
  assert.equal(attempts(f).length,4);f.assertNoPaidWork();
});

test('captured configuration survives caller mutation and retained originals survive a changed or null fresh campaign',async t=>{
  const f=await routeFixture(t),configuration=config(f),route=createSponsorImageIntakeRoute(configuration);configuration.freshCampaignId='changed';configuration.enabled=false;
  const saved=await prepare(f,route);await commit(f,route,saved.plan);const before=creative(f);
  for(const freshCampaignId of ['different-campaign',null]){
    const retained=createSponsorImageIntakeRoute({...config(f),freshCampaignId});
    for(const suffix of [`?draftId=${saved.plan.draftId}`,`?intentId=${saved.plan.request.intentId}`]){
      const bootstrap=await call(f,retained,'GET','/bootstrap'+suffix);assert.equal(bootstrap.response.status,200);assert.equal(bootstrap.body.campaignId,f.campaignId);assert.equal(bootstrap.body.mode,'retained');}
    assert.equal((await prepare(f,retained)).replayed,true);assert.equal((await commit(f,retained,saved.plan)).replayed,true);
  }
  assert.deepEqual(creative(f),before);f.assertNoPaidWork();
});

test('null fresh campaign closes fresh bootstrap before DB and fresh POST before storage while original reads remain available',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute({...config(f),freshCampaignId:null});
  const response=await route(f.httpRequest('GET',base+'/bootstrap'),new Proxy({}, {get(){throw Error('fresh disabled touched DB');}}));assert.equal(response.status,409);
  const refused=await call(f,route,'POST','/drafts',preparedBody(f));assert.notEqual(refused.response.status,200);assert.equal(count(f,'private_content'),0);assert.equal(attempts(f).length,0);f.assertNoPaidWork();
});

test('new commit refuses revoked approval while exact completed original remains recoverable after revocation',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),complete=await prepare(f,route);await commit(f,route,complete.plan);
  const pending=await prepare(f,route,await nativeRequest()),before=creative(f);revoke(f);
  const refused=await call(f,route,'POST',`/drafts/${pending.plan.draftId}/commit`,committedBody(f,pending.plan));assert.notEqual(refused.response.status,200);assert.deepEqual(creative(f),before);
  const recovered=await commit(f,route,complete.plan);assert.equal(recovered.replayed,true);assert.deepEqual(creative(f),before);
  const read=await call(f,route,'GET',`/drafts/${complete.plan.draftId}/receipt`);assert.equal(read.response.status,200);assert.equal(read.body.status,'complete');f.assertNoPaidWork();
});

test('path and action mismatch retain admitted read charges but never commit or prepare native work',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),saved=await prepare(f,route),before=creative(f),other=`experience-draft-${'b'.repeat(64)}`;
  const cases=[['/drafts',committedBody(f,saved.plan)],[`/drafts/${other}/commit`,committedBody(f,saved.plan)],
    [`/drafts/${saved.plan.draftId}/commit`,preparedBody(f)]];
  for(const [path,body] of cases){const prior=attempts(f).length,result=await call(f,route,'POST',path,body);assert.notEqual(result.response.status,200);assert.equal(attempts(f).length,prior+1);assert.deepEqual(creative(f),before);}
  f.assertNoPaidWork();
});

test('body extras, references, non-Image, wrong campaign and cross-origin requests never create native custody',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));
  const commands=[{...preparedBody(f),payerUserId:f.payer},{...preparedBody(f),campaignId:'caller-campaign'},preparedBody(f,{...f.nativeRequest,reference:null}),
    preparedBody(f,{...f.nativeRequest,experienceId:'video'}),{...preparedBody(f),action:'run-sponsored-image'}];
  for(const command of commands){const result=await call(f,route,'POST','/drafts',command);assert.notEqual(result.response.status,200);assert.equal(count(f,'private_content'),0);}
  for(const headers of [{origin:'https://other.invalid'},{'sec-fetch-site':'cross-site'}]){
    const result=await call(f,route,'POST','/drafts',preparedBody(f),{headers});assert.notEqual(result.response.status,200);}
  assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
});

test('wrong actor cannot read or commit another original and current consent removal prevents retained disclosure',async t=>{
  const f=await routeFixture(t,{extraActorUserIds:['other-actor']}),route=createSponsorImageIntakeRoute(config(f)),saved=await prepare(f,route);await commit(f,route,saved.plan);const before=creative(f);
  for(const [method,path,body] of [['GET',`/drafts/${saved.plan.draftId}`],['POST',`/drafts/${saved.plan.draftId}/commit`,committedBody(f,saved.plan)]]){
    const response=await call(f,route,method,path,body,{actorUserId:'other-actor'});assert.notEqual(response.response.status,200);}
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
  const read=await call(f,route,'GET',`/drafts/${saved.plan.draftId}`);assert.notEqual(read.response.status,200);assert.deepEqual(creative(f),before);f.assertNoPaidWork();
});

test('POST quota refusal and simultaneous fresh attempts share the same reviewed read allocation',async t=>{
  const terms=defaultReadTerms();terms.actor.maximumRequestsPerWindow=1;
  const f=await routeFixture(t,{terms}),route=createSponsorImageIntakeRoute(config(f));
  const responses=await Promise.all([f.nativeRequest,await nativeRequest()].map(request=>call(f,route,'POST','/drafts',preparedBody(f,request))));
  assert.deepEqual(responses.map(r=>r.response.status).sort(),[200,429]);assert.ok(Number(responses.find(r=>r.response.status===429).response.headers.get('retry-after'))>0);
  assert.equal(attempts(f).length,1);assert.equal(count(f,'private_content'),1);f.assertNoPaidWork();
});

test('streaming oversized POST is bounded before read admission or creative writes',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(33_000)));},cancel(){cancelled=true;}});
  const request=new Request('http://localhost'+base+'/drafts',{method:'POST',headers:{...f.actorHeaders,'content-type':'application/json'},body:stream,duplex:'half'});
  const response=await route(request,f.env);assert.notEqual(response.status,200);assert.equal(cancelled,true);assert.equal(attempts(f).length,0);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
});

test('approved response bytes can refuse a full native plan while retaining the failed read charge',async t=>{
  const f=await routeFixture(t,{terms:defaultReadTerms(128)}),route=createSponsorImageIntakeRoute(config(f));
  const result=await call(f,route,'POST','/drafts',preparedBody(f));assert.notEqual(result.response.status,200);assert.equal(attempts(f).length,1);f.assertNoPaidWork();
});

test('exact AbortSignal cancellation before work and after read reservation does not reset charges or create custody',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),before=new AbortController();before.abort();
  const skipped=await call(f,route,'POST','/drafts',preparedBody(f),{signal:before.signal});assert.notEqual(skipped.response.status,200);assert.equal(attempts(f).length,0);
  const abort=new AbortController(),batch=f.DB.batch.bind(f.DB);let fired=0;
  f.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(s=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts\b/iu.test(s.sql))){fired++;abort.abort();}return result;};
  const cancelled=await call(f,route,'POST','/drafts',preparedBody(f),{signal:abort.signal});assert.notEqual(cancelled.response.status,200);assert.equal(fired,1);assert.equal(attempts(f).length,1);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
});

test('approval revocation at prepare commit edge rolls back storage but keeps the admitted HTTP read charge',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));
  const fired=hookBatch(f,statements=>statements.some(s=>/INSERT INTO experience_sponsor_intakes/u.test(s.sql)),()=>revoke(f));
  const result=await call(f,route,'POST','/drafts',preparedBody(f));assert.notEqual(result.response.status,200);assert.equal(fired(),1);
  assert.equal(attempts(f).length,1);assert.equal(count(f,'private_content'),0);assert.equal(count(f,'experience_sponsor_intakes'),0);assert.equal(count(f,'experience_sponsor_resource_receipts'),0);f.assertNoPaidWork();
});

test('unknown internal errors are handled generically without exception or private payload disclosure',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));f.DB.prepare=()=>{throw Error('private-secret-do-not-disclose');};
  const response=await route(f.httpRequest('GET',base+'/bootstrap'),f.env);assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'sponsor_intake_route_unavailable'});f.assertNoPaidWork();
});

test('capture actual fresh prepare and commit SQL and ordered binds for independent strict engine qualification',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),original=f.DB.prepare.bind(f.DB),records=[];let phase='prepare';
  f.DB.prepare=sql=>{const statement=original(sql),bind=statement.bind.bind(statement);statement.bind=(...bindings)=>{records.push({phase,sql,bindings,sqlBytes:Buffer.byteLength(sql),parameters:bindings.length});return bind(...bindings);};return statement;};
  const saved=await prepare(f,route);phase='commit';await commit(f,route,saved.plan);
  assert.ok(records.some(r=>r.phase==='prepare'&&r.sql.includes('INSERT INTO experience_sponsor_intakes')));
  assert.ok(records.some(r=>r.phase==='commit'&&r.sql.includes('event_client_receipts')));
  if(process.env.FORMA_SPONSOR_ROUTE_SQL_ARTIFACT)writeFileSync(process.env.FORMA_SPONSOR_ROUTE_SQL_ARTIFACT,JSON.stringify({kind:'synthetic-actual-http-prepare-commit-sql',networkAttempts,records},null,2));
  f.assertNoPaidWork();
});

function beforeQuery(f,predicate,hook){
  const prepare=f.DB.prepare.bind(f.DB);let fired=0;
  const wrap=statement=>{const bind=statement.bind.bind(statement);statement.bind=(...bindings)=>wrap(bind(...bindings));
    for(const method of ['first','all']){const actual=statement[method].bind(statement);statement[method]=async()=>{if(predicate(statement.sql)){fired++;await hook(statement);}return actual();};}
    return statement;};
  f.DB.prepare=sql=>wrap(prepare(sql));return ()=>fired;
}

test('POST consumes the exact original request body once without cloning it or replacing its signal',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),controller=new AbortController();
  const request=f.httpRequest('POST',base+'/drafts',preparedBody(f),{signal:controller.signal});let reads=0,clones=0;
  const getReader=request.body.getReader.bind(request.body);request.body.getReader=(...args)=>{reads++;return getReader(...args);};
  request.clone=()=>{clones++;throw Error('POST must not clone');};const response=await route(request,f.env);
  assert.equal(response.status,200,await response.text());assert.equal(reads,1);assert.equal(clones,0);assert.equal(request.bodyUsed,true);assert.equal(attempts(f).length,1);f.assertNoPaidWork();
});

test('POST deadline stops a stalled native draft probe after admission while retaining full bytes',async t=>{
  const f=await routeFixture(t,{terms:defaultReadTerms(1_000_000,50)}),route=createSponsorImageIntakeRoute(config(f));
  const fired=beforeQuery(f,sql=>sql.includes('sponsor_intake_read_rows AS (SELECT content,expires_at FROM private_content'),()=>new Promise(()=>{}));
  const result=await call(f,route,'POST','/drafts',preparedBody(f));assert.notEqual(result.response.status,200);assert.match(result.body.error,/deadline/u);assert.equal(fired(),1);
  assert.equal(attempts(f).length,1);assert.equal(attempts(f)[0].maximum_bytes,1_000_000);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
});

test('source erasure at final POST disclosure refuses the native plan and retains storage and read accounting history',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));
  const fired=beforeQuery(f,sql=>sql.includes('sponsor_intake_post_final')&&sql.includes('SELECT 1 AS current FROM'),()=>{
    f.sqlite.prepare("UPDATE private_content SET redacted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),content='' WHERE kind='experience-draft'").run();
  });
  const result=await call(f,route,'POST','/drafts',preparedBody(f));assert.notEqual(result.response.status,200);assert.equal(result.body.plan,undefined);assert.equal(fired(),1);
  assert.equal(attempts(f).length,1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'events'),0);f.assertNoPaidWork();
});

test('GET cancellation after actual read reservation refuses retained source before its native probe',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),saved=await prepare(f,route),controller=new AbortController(),batch=f.DB.batch.bind(f.DB);let fired=0,probes=0;
  beforeQuery(f,sql=>sql.includes('sponsor_intake_read_rows AS (SELECT content,expires_at FROM private_content'),()=>{probes++;});
  f.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(s=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts\b/iu.test(s.sql))){fired++;controller.abort();}return result;};
  const result=await call(f,route,'GET',`/drafts/${saved.plan.draftId}`,undefined,{signal:controller.signal});assert.notEqual(result.response.status,200);assert.equal(result.body.plan,undefined);
  assert.equal(fired,1);assert.equal(probes,0);assert.equal(attempts(f).length,2);f.assertNoPaidWork();
});

test('aborting an unfinished bounded POST body promptly cancels parsing before admission',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),abort=new AbortController();let streamController,cancelled=0,timer;
  const stream=new ReadableStream({start(controller){streamController=controller;controller.enqueue(new TextEncoder().encode('{"action":'));},cancel(){cancelled++;}});
  const request=new Request('http://localhost'+base+'/drafts',{method:'POST',headers:{...f.actorHeaders,'content-type':'application/json'},body:stream,duplex:'half',signal:abort.signal});
  const pending=route(request,f.env);abort.abort();
  try{const response=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('aborted POST body remained pending')),250);})]);
    assert.ok(response instanceof Response);assert.notEqual(response.status,200);assert.equal(cancelled,1);assert.equal(attempts(f).length,0);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
  }finally{clearTimeout(timer);if(!cancelled)streamController.close();await pending;}
});

test('duplicate client work and disposal during admitted HTTP prepare neither repeat storage nor disclose a cancelled plan',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f)),wire=wireFor(f,route);
  const runtime=createSponsorImageIntakeRuntime(await registeredExperience('image'),{version:1,campaignId:f.campaignId,actorUserId:f.actor},wire.transport);t.after(()=>runtime.dispose());
  runtime.change('subject','A copper lamp');runtime.change('ratio',{width:1,height:1});const batch=f.DB.batch.bind(f.DB);let fired=0;
  f.DB.batch=async statements=>{const result=await batch(statements);if(statements.some(s=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts\b/iu.test(s.sql))){fired++;runtime.dispose();}return result;};
  const first=runtime.prepare();await runtime.prepare();await first;assert.equal(fired,1);assert.equal(wire.calls.length,1);assert.equal(wire.calls[0].signal.aborted,true);
  assert.equal(runtime.preparedPlan,undefined);assert.equal(attempts(f).length,1);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
});

test('unfinished non-aborting POST body reaches the server-owned timeout and cancels before any database work',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));let cancelled=0,databaseReads=0;
  const original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{databaseReads++;return original(sql);};
  const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"action":'));},cancel(){cancelled++;}});
  const request=new Request('http://localhost'+base+'/drafts',{method:'POST',headers:{...f.actorHeaders,'content-type':'application/json'},body:stream,duplex:'half'});
  const response=await route(request,f.env);assert.notEqual(response.status,200);assert.equal((await response.json()).error,'sponsor_intake_request_timeout');
  assert.equal(cancelled,1);assert.equal(databaseReads,0);assert.equal(attempts(f).length,0);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
});

for(const mutation of ['consent','approval','deadline'])test(`actual native root commit rolls back all events when ${mutation} changes at its batch boundary`,async t=>{
  const f=await routeFixture(t,{terms:defaultReadTerms(1_000_000,500)}),route=createSponsorImageIntakeRoute(config(f)),saved=await prepare(f,route);
  const stored=f.sqlite.prepare('SELECT * FROM private_content').all(),resource=f.sqlite.prepare('SELECT * FROM experience_sponsor_resource_receipts').all();
  const fired=hookBatch(f,statements=>statements.some(s=>/INSERT INTO event_client_receipts/u.test(s.sql)&&s.sql.includes('CASE WHEN')),async()=>{
    if(mutation==='consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor);
    if(mutation==='approval')revoke(f);
    if(mutation==='deadline'){
      const deadline=Math.max(...attempts(f).map(a=>a.deadline_at_ms));await new Promise(resolve=>setTimeout(resolve,Math.max(1,deadline-Date.now()+25)));
    }
  });
  const result=await call(f,route,'POST',`/drafts/${saved.plan.draftId}/commit`,committedBody(f,saved.plan));assert.notEqual(result.response.status,200);assert.equal(fired(),1);
  for(const table of ['events','event_private_payloads','event_client_receipts'])assert.equal(count(f,table),0,table);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM private_content').all(),stored);assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_sponsor_resource_receipts').all(),resource);
  assert.equal(attempts(f).length,2);f.assertNoPaidWork();
});

test('registered proof composition deduplicates only equal SQL and ordered binding values while opaque copies remain complete',async t=>{
  const f=await routeFixture(t),{createSponsorIntakePostReadAllowance,composeSponsorIntakePostGuards,composeSponsorIntakePostWriteGuard}=await import('../worker/experience-sponsor-intake-reads.ts');
  const request=f.httpRequest('POST',base+'/drafts',preparedBody(f)),cap=await createSponsorIntakePostReadAllowance(request,f.env,f.campaignId);
  const marker='synthetic-unique-dedup-marker',equal={sql:'? = ?',bindings:[marker,marker]},different={sql:'? = ?',bindings:[marker,'synthetic-other-marker']};
  const tree=composeSponsorIntakePostGuards(equal,equal),guard=composeSponsorIntakePostWriteGuard(cap,request,f.env,tree,equal);
  const run=proof=>f.sqlite.prepare(`SELECT 1 AS current WHERE ${proof.sql}`).get(...proof.bindings);
  assert.equal(run(guard).current,1);assert.equal(JSON.parse(guard.bindings[0]).filter(value=>value===marker).length,2);
  const changed=composeSponsorIntakePostWriteGuard(cap,request,f.env,tree,different);assert.equal(run(changed),undefined);
  const changedValues=JSON.parse(changed.bindings[0]);assert.equal(changedValues.filter(value=>value===marker).length,3);assert.ok(changedValues.includes('synthetic-other-marker'));
  const copied=composeSponsorIntakePostWriteGuard(cap,request,f.env,{...tree,bindings:[...tree.bindings]},equal);assert.equal(run(copied).current,1);
  assert.equal(JSON.parse(copied.bindings[0]).filter(value=>value===marker).length,6,'An unregistered copied conjunction is retained in full, never parsed or discarded');
  assert.equal(count(f,'private_content'),0);assert.equal(attempts(f).length,1);f.assertNoPaidWork();
});

// Fault facade forwards the actual native reader's exact arguments to the
// actual cap consumer, changing only SQL or one binding immediately before it.
// It copies neither the producer, seal validator nor SQL composition logic.
const postNativeFaultProgram=String.raw`
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),mode=process.env.FORMA_POST_NATIVE_FAULT;
const core=pathToFileURL(root+'/worker/experience-sponsor-intake-reads.ts').href,native=pathToFileURL(root+'/worker/project-intake-read.ts').href;
const source='import {readSponsorIntakePostNativeReceipt as actual} from '+JSON.stringify(core)+';export async function readSponsorIntakePostNativeReceipt(token,env,auth,intake,options,sql,bindings){globalThis.__postFault.calls++;if(globalThis.__postFault.mode==="sql")sql+=" /* synthetic fault */";if(globalThis.__postFault.mode==="bindings"){bindings=[...bindings];bindings[bindings.length-1]=String(bindings.at(-1))+":changed";}return actual(token,env,auth,intake,options,sql,bindings);}';
const facade='data:text/javascript;base64,'+Buffer.from(source).toString('base64');let interceptions=0,network=0;
registerHooks({resolve(specifier,context,next){if(context.parentURL===native&&(specifier===core||specifier==='./experience-sponsor-intake-reads.ts')){interceptions++;return{url:facade,shortCircuit:true};}return next(specifier,context);}});
globalThis.__postFault={mode,calls:0};globalThis.fetch=()=>{network++;throw Error('no network');};
const files=['worker/experience-sponsor-intake-reads.ts','worker/experience-sponsor-intake.ts','worker/project-intake-read.ts','worker/experience-sponsor-intake-route.ts','tests/sponsor-initial-intake-fixture.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(root+'/'+file)).digest('hex')]));const before=hashes(),cleanup=[];
try{
 const {routeFixture}=await import(root+'/tests/sponsor-intake-route-fixture.mjs');const {createSponsorImageIntakeRoute}=await import(root+'/worker/experience-sponsor-intake-route.ts');
 const f=await routeFixture({after:fn=>cleanup.push(fn)}),base='/api/experiences/sponsor/image',route=createSponsorImageIntakeRoute({version:1,enabled:true,audience:'canonical-principal',output:'image',freshCampaignId:f.campaignId});
 const response=await route(f.httpRequest('POST',base+'/drafts',{action:'prepare-sponsored-image-draft',campaignId:f.campaignId,request:f.nativeRequest}),f.env),saved=await response.json();assert.equal(response.status,200,JSON.stringify(saved));
 let nativeQueries=0;const original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{if(sql.includes('sponsor_intake_receipt_gate'))nativeQueries++;return original(sql);};
 const result=await route(f.httpRequest('POST',base+'/drafts/'+saved.plan.draftId+'/commit',{action:'commit-sponsored-image-draft',campaignId:f.campaignId,draftId:saved.plan.draftId,draftHash:saved.plan.draftHash}),f.env),body=await result.json();
 assert.equal(interceptions,1);assert.ok(globalThis.__postFault.calls>0);
 if(mode==='none'){assert.equal(result.status,200,JSON.stringify(body));assert.equal(body.status,'complete');assert.ok(nativeQueries>0);assert.deepEqual(body.appended.map(({type,payload})=>({type,payload})),saved.plan.events);}
 else{assert.equal(result.status,409);assert.equal(body.error,'sponsor_intake_read_native_query_changed');assert.equal(globalThis.__postFault.calls,1);assert.equal(nativeQueries,0);for(const table of ['events','event_private_payloads','event_client_receipts'])assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);}
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intake_read_attempts').get().n,2);f.assertNoPaidWork();assert.deepEqual(hashes(),before);assert.equal(network,0);
 console.log(JSON.stringify({mode,status:'pass',hookCalls:globalThis.__postFault.calls,nativeQueries,sourceBefore:before,sourceAfter:hashes(),network}));
}finally{for(const fn of cleanup.reverse())await fn();}
`;
for(const mode of ['none','sql','bindings'])test(`native POST receipt seal ${mode==='none'?'retains an unchanged actual native producer':'refuses actual producer '+mode+' mutation before private receipt rows'}`,()=>{
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',postNativeFaultProgram],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,FORMA_POST_NATIVE_FAULT:mode},encoding:'utf8',timeout:30_000,maxBuffer:4_000_000,
  });
  if(process.env.FORMA_POST_NATIVE_FAULT_LOG_PREFIX)writeFileSync(process.env.FORMA_POST_NATIVE_FAULT_LOG_PREFIX+'-'+mode+'.txt',result.stdout+'\n'+result.stderr);
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.match(result.stdout,/"status":"pass"/u);
});

test('always-ready empty POST chunks hit the bounded work limit before timer starvation or database work',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));let pulls=0,cancelled=0,tripwire=false,databaseReads=0,timer;
  const original=f.DB.prepare.bind(f.DB);f.DB.prepare=sql=>{databaseReads++;return original(sql);};
  // The producer has no completion condition. This external test tripwire
  // errors it only if the production bound fails, so a regression cannot hang
  // the test runner's microtask queue and hide behind an un-fired timeout.
  const stream=new ReadableStream({pull(controller){if(++pulls>1026){tripwire=true;controller.error(Error('fixture empty-chunk tripwire'));return;}
    controller.enqueue(new Uint8Array(0));},cancel(){cancelled++;}});
  const request=new Request('http://localhost'+base+'/drafts',{method:'POST',headers:{...f.actorHeaders,'content-type':'application/json'},body:stream,duplex:'half'});
  try{const response=await Promise.race([route(request,f.env),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('empty chunk work remained pending')),750);})]);
    assert.notEqual(response.status,200);assert.equal(tripwire,false);assert.ok(pulls<=1026);assert.equal(cancelled,1);assert.equal(databaseReads,0);
    assert.equal(attempts(f).length,0);assert.equal(count(f,'private_content'),0);f.assertNoPaidWork();
  }finally{clearTimeout(timer);}
});

test('complete POST guard refuses removed read approval before any retained native draft row crosses the database boundary',async t=>{
  const f=await routeFixture(t),route=createSponsorImageIntakeRoute(config(f));await prepare(f,route);const before=creative(f),readPolicy=f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_policies').all(),consent=f.sqlite.prepare('SELECT consent_version FROM users WHERE user_id=?').get(f.actor);
  const original=f.DB.prepare.bind(f.DB),observations=[];let fired=0;
  const wrap=statement=>{const bind=statement.bind.bind(statement);statement.bind=(...bindings)=>wrap(bind(...bindings));const all=statement.all.bind(statement);
    statement.all=async()=>{if(statement.sql.includes('sponsor_intake_read_rows')&&statement.sql.includes('SELECT content,expires_at FROM private_content')){
      fired++;
      // Synthetic storage-fault injection only: read approval is immutable and
      // exposes no revocation API. Remove its actual reviewed provenance here
      // to isolate the additional ticket guard from ordinary native consent.
      f.sqlite.exec('DROP TRIGGER experience_sponsor_intake_read_approvals_no_delete');
      f.sqlite.prepare('DELETE FROM experience_sponsor_intake_read_approvals WHERE campaign_id=?').run(f.campaignId);
      const result=await all();observations.push(result.results);return result;}
      return all();};return statement;};f.DB.prepare=sql=>wrap(original(sql));
  const result=await call(f,route,'POST','/drafts',preparedBody(f));assert.notEqual(result.response.status,200);assert.equal(result.body.plan,undefined);
  assert.equal(fired,1);assert.deepEqual(observations,[[]]);assert.equal(count(f,'experience_sponsor_intake_read_approvals'),0);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_policies').all(),readPolicy);assert.deepEqual(f.sqlite.prepare('SELECT consent_version FROM users WHERE user_id=?').get(f.actor),consent);assert.equal(attempts(f).length,2);assert.deepEqual(creative(f),before);f.assertNoPaidWork();
});

// A deliberately stalled D1 scalar, limited to disclosePrepared's named
// verification. The old-call-stack branch preserves the pre-fix reproduction;
// it cannot intercept native draft checks or the final route disclosure proof.
function stallPreparedDisclosure(f,onStall){
  const original=f.DB.prepare.bind(f.DB);let resolve,reject,calls=0,prepares=0,sqlAtStall,originalAtStall,kind;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const wrap=statement=>{const bind=statement.bind.bind(statement),first=statement.first.bind(statement);statement.bind=(...bindings)=>wrap(bind(...bindings));
    statement.first=()=>{
      const named=statement.sql.includes('SELECT 1 AS current FROM sponsor_intake_post_write');
      const historical=statement.sql.startsWith('SELECT 1 AS current WHERE')&&new Error().stack.includes('at disclosePrepared (');
      if(named||historical){calls++;kind=named?'named':'historical';sqlAtStall=statement.sql;originalAtStall=creative(f);onStall?.();return pending;}
      return first();};return statement;};f.DB.prepare=sql=>{prepares++;return wrap(original(sql));};
  return {get calls(){return calls;},get prepares(){return prepares;},get kind(){return kind;},get sql(){return sqlAtStall;},get original(){return originalAtStall;},resolve,reject};
}

for(const mode of ['deadline','abort'])test(`stalled prepared disclosure scalar ${mode==='deadline'?'after fresh storage and lost acknowledgment obeys the deadline':'during original replay obeys request abort'} without losing custody or its charge`,async t=>{
  const f=await routeFixture(t,{terms:defaultReadTerms(1_000_000,mode==='deadline'?500:10_000)}),route=createSponsorImageIntakeRoute(config(f)),abort=new AbortController();
  let prepared,before,lostStorageAck=0;if(mode==='abort'){prepared=await prepare(f,route);before=creative(f);}
  else{const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{const result=await batch(statements);
    if(statements.some(statement=>statement.sql.includes('INSERT INTO experience_sponsor_intakes'))){lostStorageAck++;throw Error('synthetic lost native storage acknowledgment');}
    return result;};}
  const unhandled=[];const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);let timer;
  const stalled=stallPreparedDisclosure(f,mode==='abort'?()=>queueMicrotask(()=>abort.abort()):undefined);
  const request=f.httpRequest('POST',base+'/drafts',preparedBody(f),{signal:abort.signal}),pending=route(request,f.env);let settled=false;
  pending.then(()=>{settled=true;},()=>{settled=true;});
  try{
    const response=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('prepared scalar escaped its request lifetime')),1500);})]);
    const body=await response.json();assert.notEqual(response.status,200);assert.equal(body.plan,undefined);assert.match(body.error,mode==='deadline'?/deadline/u:/cancelled/u);
    assert.equal(stalled.calls,1);assert.equal(lostStorageAck,mode==='deadline'?1:0);assert.equal(stalled.kind,'named');assert.ok(stalled.sql);assert.ok(stalled.original);assert.equal(settled,true);
    assert.deepEqual(creative(f),stalled.original);if(before)assert.deepEqual(creative(f),before);
    assert.equal(count(f,'private_content'),1);assert.equal(count(f,'experience_sponsor_intakes'),1);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);assert.equal(count(f,'events'),0);
    const row=f.sqlite.prepare("SELECT content,redacted_at FROM private_content WHERE kind='experience-draft'").get(),plan=JSON.parse(row.content);assert.equal(row.redacted_at,null);
    assert.deepEqual(plan.request,f.nativeRequest);if(prepared)assert.deepEqual(plan,prepared.plan);
    assert.equal(attempts(f).length,mode==='deadline'?1:2);for(const attempt of attempts(f))assert.equal(attempt.maximum_bytes,1_000_000);f.assertNoPaidWork();
  }finally{
    clearTimeout(timer);
    // Complete the fake outstanding operation with a late failure. The actual
    // lifetime race must already own a rejection handler; no detached failure
    // or subsequent database work may leak after the route has returned.
    const databaseCallsAtReturn=stalled.prepares;stalled.reject(Error('synthetic late scalar failure'));await pending.catch(()=>undefined);
    await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));process.off('unhandledRejection',onUnhandled);
    assert.deepEqual(unhandled,[]);assert.equal(stalled.calls,1);assert.equal(stalled.prepares,databaseCallsAtReturn);
  }
});
