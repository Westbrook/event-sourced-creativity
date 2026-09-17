import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fixture,transport,actor,payer,headers} from './sponsor-story-driver-fixture.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';

const [{driveSponsoredStory},{identifySponsorStoryRead,requireSponsorStoryReadAuthority},{PLATFORM_PRINCIPAL_WITH_ACCESS_SQL}]=await Promise.all([
  import('../worker/experience-sponsor-story-driver.ts'),import('../worker/experience-sponsor-story-read.ts'),import('../worker/access-policy.ts'),
]);
const encodedBytes=value=>Buffer.byteLength(JSON.stringify(value));
const forbidden=/\b(?:private_content|event_private_payloads|events|artifact_revisions|output_provider_calls|budget_reservations|cost_budget_reservations|budget_counters|cost_budget_counters|private_json|content_json|payload_json|snapshot_json|settings_json|result_json)\b/iu;
function assertExplicitProjection(sql){
  const explicit=sql.replace(PLATFORM_PRINCIPAL_WITH_ACCESS_SQL,'').replace(/\bCOUNT\s*\(\s*\*\s*\)/giu,'COUNT(1)');
  assert.doesNotMatch(explicit,/\*/u,'Only COUNT(*) and the exact inherited canonical principal query permit stars');
}
function snapshot(f){
  return Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({name})=>[name,structuredClone(f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all())]));
}

async function setup(t){
  const calls=transport(t),f=await fixture(t),result=await driveSponsoredStory(f.request(),f.env,f.context);
  assert.equal(result.status,'completed');assert.equal(calls.length,1);
  const db=f.env.DB,trace=[],statements=new WeakMap(),violations=[];let egress=0,media=0;
  t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('Read authority prohibits provider access');});
  for(const operation of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,operation,()=>{media++;throw Error('Read authority grants no creative media IO');});
  const limits=enforceD1ExpressionDepth({sqlite:f.sqlite,env:{DB:db}},{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  t.after(()=>limits.restore());
  const changes=()=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
  const inspect=sql=>{
    try{
      assert.match(sql,/^\s*(?:SELECT|WITH)\b/iu,'Authority identification must be read-only');
      assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|ATTACH|DETACH|PRAGMA)\b/iu,'WITH cannot hide a write');
      assert.doesNotMatch(sql,forbidden,'No creative body or financial ledger may be read before IO permission');
      assertExplicitProjection(sql);
    }catch(error){violations.push({sql,error:String(error)});throw error;}
  };
  const wrap=(sql,bindings=[])=>{
    inspect(sql);const original=db.prepare(sql).bind(...bindings),statement={bind:(...values)=>wrap(sql,values)};
    for(const method of ['first','all'])statement[method]=async()=>{
      const entry={kind:method,sql,bindings};trace.push(entry);
      const beforeChanges=changes(),value=await original[method]();assert.equal(changes(),beforeChanges,'A control query cannot perform hidden writes');entry.result=structuredClone(value);
      if(f.afterRead)await f.afterRead(entry);return value;
    };
    statements.set(statement,{original,sql,bindings});return statement;
  };
  const guarded={prepare:sql=>wrap(sql),batch:async items=>{
    const captured=items.map(item=>{const value=statements.get(item);assert.ok(value);return value;});
    const entry={kind:'batch',statements:captured.map(({sql,bindings})=>({sql,bindings}))};trace.push(entry);
    if(f.beforeReadBatch)await f.beforeReadBatch(entry);
    const beforeChanges=changes(),value=await db.batch(captured.map(item=>item.original));assert.equal(changes(),beforeChanges,'Final control witnesses are read-only');entry.result=structuredClone(value);
    if(f.afterRead)await f.afterRead(entry);return value;
  }};
  f.env.DB=guarded;
  const request=(options={})=>new Request(`http://localhost/__fixture/story-read/${result.jobId}`,{headers:headers(actor),...options});
  Object.assign(f,{jobId:result.jobId,trace,limits,guarded,originalDb:db,readRequest:request,
    identify:(req=request(),raw={jobId:result.jobId})=>identifySponsorStoryRead(req,f.env,raw),
    assertPassive:()=>{assert.equal(egress,0);assert.equal(media,0);assert.equal(calls.length,1);assert.deepEqual(violations,[]);}});
  return f;
}

test('read projection guard rejects qualified and noninitial wildcards while retaining exact native principal and counts',()=>{
  for(const sql of ['SELECT * FROM document_jobs','SELECT job.* FROM document_jobs job','SELECT job.job_id,job.* FROM document_jobs job','SELECT DISTINCT * FROM document_jobs','SELECT ALL * FROM document_jobs'])assert.throws(()=>assertExplicitProjection(sql));
  assert.doesNotThrow(()=>assertExplicitProjection('SELECT COUNT(*) AS n,job_id FROM document_jobs'));
  assert.doesNotThrow(()=>assertExplicitProjection(PLATFORM_PRINCIPAL_WITH_ACCESS_SQL));
});

test('native original one-call Story lineage grants only bounded source-free control authority under strict SQLite limits',async t=>{
  const f=await setup(t),before=snapshot(f),request=f.readRequest();
  const seal=await f.identify(request),facts=requireSponsorStoryReadAuthority(seal,request,f.env);
  assert.equal(facts.actorUserId,actor);assert.equal(facts.jobId,f.jobId);assert.equal(facts.documentId,f.documentId);assert.equal(facts.campaignId,f.campaignId);
  assert.ok(facts.controlBytes>0&&facts.controlBytes<=2_000_000);
  assert.equal(facts.controlBytes,f.trace.reduce((sum,entry)=>sum+encodedBytes(entry.result),0));
  assert.ok(facts.assertions.length>=3);assert.ok(Object.isFrozen(seal));assert.ok(Object.isFrozen(facts));
  const returned=JSON.stringify(f.trace.map(entry=>entry.result));assert.ok(!returned.includes(f.sourceText));assert.ok(!returned.includes('Mira carried the clock home'));
  assert.deepEqual(snapshot(f),before);f.assertPassive();f.limits.assertVerified();
  t.diagnostic(JSON.stringify({strictLocalSqlStatements:f.limits.records.length,maximumBindings:Math.max(...f.limits.boundCounts),controlBytes:facts.controlBytes,
    expressionDepth:100,functionArguments:32,parameters:100,sqlBytes:100000,readProviderCalls:0,creativeIoCalls:0,actualExternalRequests:0}));
});

test('expired and disabled original generation authority does not revoke existing owned Story provenance',async t=>{
  const f=await setup(t);
  f.sqlite.exec("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json='{}'; UPDATE experience_sponsor_resource_policies SET enabled=0; UPDATE experience_sponsor_grants SET enabled=0,expires_at_ms=issued_at_ms+1; UPDATE output_execution_grants SET expires_at='2000-01-01T00:00:00.000Z'; UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms+1");
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(payer);
  assert.ok(f.sqlite.prepare('SELECT expires_at_ms FROM experience_sponsor_grants').get().expires_at_ms<Date.now());
  const before=snapshot(f),request=f.readRequest(),seal=await f.identify(request),facts=requireSponsorStoryReadAuthority(seal,request,f.env);
  assert.equal(facts.jobId,f.jobId);assert.equal(facts.actorUserId,actor);assert.deepEqual(snapshot(f),before);f.assertPassive();f.limits.assertVerified();
});

test('canonical actor and exact personal ownership metadata remain mandatory',async t=>{
  const f=await setup(t),before=snapshot(f),consent=f.sqlite.prepare('SELECT consent_version FROM users WHERE user_id=?').get(actor).consent_version;
  await assert.rejects(f.identify(f.readRequest({headers:headers(payer)})),/sponsor_story_read_original_unavailable/u);
  await assert.rejects(f.identify(f.readRequest({headers:{}})),/sponsor_story_read_personal_principal_required/u);
  f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
  const revoked=snapshot(f);await assert.rejects(f.identify(),/retained_story_access_denied/u);assert.deepEqual(snapshot(f),revoked);
  f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(consent,actor);
  f.sqlite.prepare('UPDATE output_plan_revisions SET owner_user_id=?').run(payer);
  const changed=snapshot(f);await assert.rejects(f.identify(),/sponsor_story_read_original_unavailable/u);assert.deepEqual(snapshot(f),changed);
  f.sqlite.prepare('UPDATE output_plan_revisions SET owner_user_id=?').run(actor);
  assert.deepEqual(snapshot(f),before);f.assertPassive();f.limits.assertVerified();
});

test('extra native stage, one-call maximum and personal Document ownership changes cannot reuse the original Story lineage',async t=>{
  const f=await setup(t),before=snapshot(f);
  const cases=[
    ["INSERT INTO output_operation_routes SELECT scope_key,slot_id,'render:0:initial',provider,model,maximum_calls FROM output_operation_routes","DELETE FROM output_operation_routes WHERE stage_key='render:0:initial'"],
    ['UPDATE output_operation_slots SET maximum_calls=2','UPDATE output_operation_slots SET maximum_calls=1'],
    ["UPDATE document_jobs SET document_id='different-story-document'",'UPDATE document_jobs SET document_id=?',[f.documentId]],
    ['UPDATE output_plan_revisions SET owner_user_id=?','UPDATE output_plan_revisions SET owner_user_id=?',[actor],[payer]],
  ];
  for(const [change,restore,restoreBindings=[],changeBindings=[]] of cases){
    assert.ok(f.sqlite.prepare(change).run(...changeBindings).changes>0);
    const changed=snapshot(f);await assert.rejects(f.identify(),/sponsor_story_read_original_(?:unavailable|changed)/u);assert.deepEqual(snapshot(f),changed);
    f.sqlite.prepare(restore).run(...restoreBindings);assert.deepEqual(snapshot(f),before);
  }
  f.assertPassive();f.limits.assertVerified();
});

test('read seals reject forged copies and changed Request, environment, DB, headers, URL, method and abort state',async t=>{
  const f=await setup(t),controller=new AbortController(),request=f.readRequest({signal:controller.signal}),seal=await f.identify(request);
  const before=snapshot(f),reads=f.trace.length,facts=requireSponsorStoryReadAuthority(seal,request,f.env);
  for(const forged of [{},{...seal},structuredClone(seal),facts])assert.throws(()=>requireSponsorStoryReadAuthority(forged,request,f.env),/sponsor_story_read_authority_unavailable/u);
  assert.throws(()=>requireSponsorStoryReadAuthority(seal,new Request(request),f.env),/sponsor_story_read_authority_unavailable/u);
  assert.throws(()=>requireSponsorStoryReadAuthority(seal,request,{...f.env}),/sponsor_story_read_authority_unavailable/u);
  f.env.DB={...f.guarded};assert.throws(()=>requireSponsorStoryReadAuthority(seal,request,f.env),/sponsor_story_read_authority_unavailable/u);f.env.DB=f.guarded;
  for(const [name,value] of [['oai-authenticated-user-email','changed@example.invalid'],['cookie','session=changed']]){
    const original=request.headers.get(name);request.headers.set(name,value);
    assert.throws(()=>requireSponsorStoryReadAuthority(seal,request,f.env),/sponsor_story_read_authority_unavailable/u);
    if(original===null)request.headers.delete(name);else request.headers.set(name,original);
  }
  for(const [name,value] of [['method','POST'],['url','http://localhost/changed-story-read']]){
    Object.defineProperty(request,name,{value,configurable:true});assert.throws(()=>requireSponsorStoryReadAuthority(seal,request,f.env),/sponsor_story_read_authority_unavailable/u);delete request[name];
  }
  f.env.FORMA_ADMIN_EMAILS='changed@example.invalid';assert.throws(()=>requireSponsorStoryReadAuthority(seal,request,f.env),/sponsor_story_read_authority_unavailable/u);delete f.env.FORMA_ADMIN_EMAILS;
  assert.equal(requireSponsorStoryReadAuthority(seal,request,f.env).jobId,f.jobId);
  controller.abort();assert.throws(()=>requireSponsorStoryReadAuthority(seal,request,f.env),/sponsor_story_read_authority_unavailable/u);
  assert.equal(f.trace.length,reads);assert.deepEqual(snapshot(f),before);f.assertPassive();f.limits.assertVerified();
});

for(const changed of ['DB','headers','URL','method','abort'])test(`${changed} mutation across the first control-read await fails before further IO`,async t=>{
  const f=await setup(t),controller=new AbortController(),request=f.readRequest({signal:controller.signal}),before=snapshot(f);let altered=false,substituteReads=0;
  f.afterRead=()=>{
    if(altered)return;altered=true;
    if(changed==='DB')f.env.DB={...f.guarded,prepare(){substituteReads++;throw Error('Substituted DB must not be used');}};
    if(changed==='headers')request.headers.set('cookie','session=changed-after-await');
    if(changed==='URL')Object.defineProperty(request,'url',{value:'http://localhost/changed-after-await',configurable:true});
    if(changed==='method')Object.defineProperty(request,'method',{value:'POST',configurable:true});
    if(changed==='abort')controller.abort();
  };
  await assert.rejects(f.identify(request),changed==='abort'?/sponsor_read_deadline/u:/sponsor_story_read_authority_changed/u);
  assert.equal(altered,true);assert.equal(substituteReads,0);assert.equal(f.trace.length,1);assert.deepEqual(snapshot(f),before);f.assertPassive();f.limits.assertVerified();
});

for(const changed of ['actor consent','native route'])test(`final read transaction observes late ${changed} withdrawal`,async t=>{
  const f=await setup(t);let altered=false,afterWithdrawal;
  f.beforeReadBatch=()=>{
    assert.equal(altered,false);altered=true;
    if(changed==='actor consent')f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(actor);
    else f.sqlite.exec('UPDATE output_operation_routes SET maximum_calls=2');
    afterWithdrawal=snapshot(f);
  };
  await assert.rejects(f.identify(),/sponsor_story_read_authority_changed/u);
  assert.equal(altered,true);assert.ok(f.trace.findLast(entry=>entry.kind==='batch').result.some(result=>result.results[0]?.current===0));
  assert.deepEqual(snapshot(f),afterWithdrawal);f.assertPassive();f.limits.assertVerified();
});

test('current identity-policy custody denial rejects the canonical owner without refreshing their identity',async t=>{
  const f=await setup(t),now=new Date().toISOString();
  f.sqlite.prepare('INSERT INTO organizations(organization_id,name,owner_user_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('story-read-policy-org','Read policy fixture',actor,'active',now,now);
  f.sqlite.prepare('INSERT INTO organization_memberships(membership_id,organization_id,user_id,role,status,invited_by_user_id,accepted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('story-read-policy-member','story-read-policy-org',actor,'owner','active',actor,now,now,now);
  f.sqlite.prepare('INSERT INTO organization_security_policies(organization_id,require_mfa,updated_by_user_id,updated_at) VALUES(?,?,?,?)')
    .run('story-read-policy-org',1,actor,now);
  const before=snapshot(f);await assert.rejects(f.identify(),/retained_story_access_denied/u);
  assert.equal(f.trace.length,1);assert.deepEqual(snapshot(f),before);f.assertPassive();f.limits.assertVerified();
});

test('closed GET grammar rejects caller fields before reading authority',async t=>{
  const f=await setup(t),before=snapshot(f);
  for(const raw of [{jobId:f.jobId,payerUserId:payer},{jobId:f.jobId,maximumBytes:2_000_000},{jobId:f.jobId,output:'image'},{jobId:'invalid job id'}])
    await assert.rejects(f.identify(f.readRequest(),raw),/sponsor_story_read_request_invalid/u);
  await assert.rejects(f.identify(f.readRequest({method:'POST'})),/sponsor_story_read_request_invalid/u);
  assert.equal(f.trace.length,0);assert.deepEqual(snapshot(f),before);f.assertPassive();
});

test('missing acknowledgment for an actual original-lineage witness refuses the opaque control seal',async t=>{
  const f=await setup(t),request=f.readRequest(),nativeBatch=f.originalDb.batch;
  const cases={
    sparse:receipts=>{delete receipts[1];return receipts;},
    allSparse:receipts=>new Array(receipts.length),
    undefined:receipts=>{receipts[1]=undefined;return receipts;},
    falseSuccess:receipts=>{receipts[1].success=false;return receipts;},
    sparseScalar:receipts=>{receipts[1].results=new Array(1);return receipts;},
    nullScalar:receipts=>{receipts[1].results[0]={current:null};return receipts;},
    inheritedReceipt:receipts=>{const value=receipts[1];delete receipts[1];
      Object.setPrototypeOf(receipts,Object.assign(Object.create(Array.prototype),{1:value}));return receipts;},
  };
  let currentCase,omitted=0;
  t.mock.method(f.originalDb,'batch',async function(items){
    const receipts=await nativeBatch.call(this,items);
    assert.ok(receipts.length>=3);const length=receipts.length;
    const damaged=cases[currentCase](receipts);omitted++;
    assert.equal(damaged.length,length);return damaged;
  });
  for(const key of Object.keys(cases)){
    currentCase=key;
    await assert.rejects(f.identify(request),/sponsor_story_read_authority_changed/u,key);
  }
  assert.equal(omitted,Object.keys(cases).length);f.assertPassive();
});
