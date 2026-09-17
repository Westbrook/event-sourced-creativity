import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture as initialFixture,requestFor} from './sponsor-initial-intake-fixture.mjs';
const [{prepareSponsorImageDraft,commitSponsorImageDraft},
  {SPONSOR_INTAKE_READ_POLICY_SCHEMA},{SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy},
  {SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA,reserveSponsorIntakeReadAttempt},
  {identifySponsorIntakeRead,resolveSponsorIntakeRead,readSponsorImageIntake},
  {registeredExperience},{appendAuditEvent}]=await Promise.all([
  import('../worker/experience-sponsor-intake.ts'),import('../worker/experience-sponsor-intake-read-policy.ts'),
  import('../worker/experience-sponsor-intake-read-approval.ts'),import('../worker/experience-sponsor-intake-read-attempts.ts'),
  import('../worker/experience-sponsor-intake-reads.ts'),import('../src/experiences/intake.ts'),import('../worker/runtime.ts'),
]);
const originalFetch=globalThis.fetch;let networkAttempts=0;
globalThis.fetch=()=>{networkAttempts++;throw Error('Sponsored pre-job intake reads prohibit network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(networkAttempts,0);});
const operations=['image-intake-bootstrap','image-intake-draft','image-intake-receipt'];
const policy=(maximumBytes=1_000_000,deadlineMs=10_000)=>({version:1,windowMs:60_000,
  operations:Object.fromEntries(operations.map(operation=>[operation,{maximumBytes,deadlineMs}])),
  actor:{maximumRequestsPerWindow:20,maximumBytesPerWindow:20_000_000},
  campaign:{maximumRequestsPerWindow:40,maximumBytesPerWindow:40_000_000}});
const count=(f,table)=>f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const attempts=f=>f.sqlite.prepare('SELECT * FROM experience_sponsor_intake_read_attempts ORDER BY admitted_at_ms,attempt_id').all();
const state=f=>Object.fromEntries(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'experience_sponsor_intake_read_attempts' ORDER BY name")
  .all().map(({name})=>[name,f.sqlite.prepare(`SELECT * FROM ${name}`).all()]));
const unpaid=f=>{
  for(const table of ['document_jobs','output_execution_grants','experience_sponsor_grants','experience_sponsor_consumptions',
    'budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(count(f,table),0,table);
  for(const table of ['budget_counters','cost_budget_counters'])assert.deepEqual(f.sqlite.prepare(`SELECT * FROM ${table}`).all(),f.originalFinancialCounters[table],table);
  assert.equal(f.media.size,0);
};
const request=(f,actor=f.actor,headers={})=>new Request('http://localhost/__fixture/sponsor-image-intake-read',{
  headers:{...f.headersFor(actor),...headers},
});
const payerRequest=(f,body)=>requestFor(f,body,{actorUserId:f.payer});
async function fixture(t,{terms=policy(),...options}={}){
  const f=await initialFixture(t,options);
  for(const schema of [SPONSOR_INTAKE_READ_POLICY_SCHEMA,SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA])
    for(const sql of schema)f.sqlite.exec(sql);
  const proposal={version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy:terms};
  const reviewed=await prepareSponsorIntakeReadApproval(payerRequest(f,{action:'prepare-sponsor-intake-read-policy',proposal}),f.env);
  const approved=await approveSponsorIntakeReadPolicy(payerRequest(f,{action:'approve-sponsor-intake-read-policy',approvalId:`read-${f.campaignId}`,
    proposal,reviewedTermsDigest:reviewed.termsDigest,confirmation:'APPROVE_SPONSOR_INTAKE_READ_POLICY'}),f.env);
  Object.assign(f,{readTerms:terms,readApproval:approved,
    originalFinancialCounters:Object.fromEntries(['budget_counters','cost_budget_counters'].map(table=>[table,f.sqlite.prepare(`SELECT * FROM ${table}`).all()]))});
  f.prepare=async(native=f.nativeRequest)=>prepareSponsorImageDraft(f.prepareRequest(native),f.env);
  f.commit=async plan=>commitSponsorImageDraft(f.commitRequest(plan),f.env);
  f.read=async selector=>readSponsorImageIntake(request(f),f.env,selector);
  f.reserve=async selector=>{
    const req=request(f),authority=await identifySponsorIntakeRead(req,f.env,selector);
    return {request:req,authority,attempt:await reserveSponsorIntakeReadAttempt(authority,req,f.env,selector.operation)};
  };
  f.resolve=async input=>resolveSponsorIntakeRead(input.authority,input.attempt,input.request,f.env);
  return f;
}

test('fresh Image bootstrap starts with empty native custody and charges a full read allocation only',async t=>{
  const f=await fixture(t),before=state(f);assert.equal(count(f,'private_content'),0);assert.equal(count(f,'events'),0);
  const response=await f.read({operation:'image-intake-bootstrap',campaignId:f.campaignId});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{version:1,kind:'sponsor-image-intake',mode:'fresh',actorUserId:f.actor,campaignId:f.campaignId,
    release:await registeredExperience('image'),generation:'unavailable'});
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(state(f),before);
  const [charge]=attempts(f);assert.ok(charge);assert.equal(charge.maximum_bytes,f.readTerms.operations['image-intake-bootstrap'].maximumBytes);
  assert.equal(charge.deadline_at_ms-charge.admitted_at_ms,10_000);assert.equal(charge.charged_through_ms-charge.deadline_at_ms,60_000);unpaid(f);
});

test('saved ID and intent aliases retain exact native Image draft and pending then completed receipt',async t=>{
  const f=await fixture(t),saved=await f.prepare(),plan=saved.plan;
  const nativeDraft=await(await f.nativeCall(`drafts/${plan.draftId}`)).json(),nativePending=await(await f.nativeCall(`drafts/${plan.draftId}/receipt`)).json();
  const before=state(f);
  for(const alias of [{draftId:plan.draftId},{intentId:plan.request.intentId}]){
    const draft=await f.read({operation:'image-intake-draft',...alias});assert.equal(draft.status,200);assert.deepEqual(await draft.json(),nativeDraft);
  }
  const pending=await f.read({operation:'image-intake-receipt',draftId:plan.draftId});assert.deepEqual(await pending.json(),nativePending);
  const bootstrap=await f.read({operation:'image-intake-bootstrap',intentId:plan.request.intentId});assert.deepEqual(await bootstrap.json(),{
    version:1,kind:'sponsor-image-intake',mode:'retained',actorUserId:f.actor,campaignId:f.campaignId,release:plan.release,
    generation:'unavailable',draftId:plan.draftId,draftHash:plan.draftHash});
  assert.deepEqual(state(f),before);assert.equal(attempts(f).length,4);
  await f.commit(plan);const nativeComplete=await(await f.nativeCall(`drafts/${plan.draftId}/receipt`)).json(),completedState=state(f);
  assert.equal(nativeComplete.status,'complete');
  for(const alias of [{draftId:plan.draftId},{intentId:plan.request.intentId}]){
    const complete=await f.read({operation:'image-intake-receipt',...alias});assert.equal(complete.status,200);assert.deepEqual(await complete.json(),nativeComplete);
  }
  assert.deepEqual(state(f),completedState);assert.equal(attempts(f).length,6);assert.equal(count(f,'experience_sponsor_resource_receipts'),1);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='DocumentCreated'").get().n,1);unpaid(f);
});

test('every alias and lost acknowledgment reserves new full bytes without refunding or replay credit',async t=>{
  const f=await fixture(t),saved=await f.prepare(),before=state(f),batch=f.DB.batch.bind(f.DB);let lost=false;
  f.DB.batch=async statements=>{
    const result=await batch(statements);
    if(!lost&&statements.some(statement=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts\b/iu.test(statement.sql))){lost=true;throw Error('lost read debit acknowledgment');}
    return result;
  };
  await assert.rejects(f.read({operation:'image-intake-draft',draftId:saved.plan.draftId}));assert.equal(lost,true);assert.equal(attempts(f).length,1);
  for(const alias of [{draftId:saved.plan.draftId},{intentId:saved.plan.request.intentId},{draftId:saved.plan.draftId}]){
    const response=await f.read({operation:'image-intake-draft',...alias});assert.equal(response.status,200);
  }
  const rows=attempts(f);assert.equal(rows.length,4);assert.equal(new Set(rows.map(row=>row.attempt_id)).size,4);
  assert.ok(rows.every(row=>row.maximum_bytes===1_000_000));assert.equal(rows.reduce((n,row)=>n+row.maximum_bytes,0),4_000_000);
  assert.deepEqual(state(f),before);unpaid(f);
});

test('one opaque attempt binds exact request, environment and selector and is consumed only once',async t=>{
  const f=await fixture(t),saved=await f.prepare(),selector={operation:'image-intake-draft',draftId:saved.plan.draftId},input=await f.reserve(selector),before=state(f);
  assert.ok(Object.isFrozen(input.authority));assert.equal(JSON.stringify(input.authority).includes(saved.plan.request.values.subject.value),false);
  await assert.rejects(resolveSponsorIntakeRead({},input.attempt,input.request,f.env));
  await assert.rejects(resolveSponsorIntakeRead(input.authority,{},input.request,f.env));
  await assert.rejects(resolveSponsorIntakeRead(input.authority,input.attempt,input.request.clone(),f.env));
  await assert.rejects(resolveSponsorIntakeRead(input.authority,input.attempt,input.request,{...f.env}));
  await assert.rejects(reserveSponsorIntakeReadAttempt(input.authority,input.request,f.env,'image-intake-receipt'));
  assert.equal((await f.resolve(input)).status,200);await assert.rejects(f.resolve(input));
  assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);unpaid(f);
});

for(const limit of ['requests','bytes'])test(`concurrent aliased reads atomically enforce actor ${limit} quota`,async t=>{
  const terms=policy();if(limit==='requests')terms.actor.maximumRequestsPerWindow=1;else terms.actor.maximumBytesPerWindow=1_000_000;
  const f=await fixture(t,{terms}),saved=await f.prepare(),before=state(f),batch=f.DB.batch.bind(f.DB);let arrived=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.DB.batch=async statements=>{
    if(statements.some(statement=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts\b/iu.test(statement.sql))){if(++arrived===2)release();await gate;}
    return batch(statements);
  };
  const results=await Promise.allSettled([
    f.read({operation:'image-intake-draft',draftId:saved.plan.draftId}),f.read({operation:'image-intake-draft',intentId:saved.plan.request.intentId}),
  ]);
  assert.equal(arrived,2);assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
  const denied=results.find(item=>item.status==='rejected');assert.ok(denied);assert.match(denied.reason.message,/limit/);assert.ok(denied.reason.retryAfterMs>0);
  assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);unpaid(f);
});

test('campaign quota combines separate canonical actors without touching generation allocations',async t=>{
  const other='fixture-intake-second-reader',terms=policy();terms.actor.maximumRequestsPerWindow=1;terms.campaign.maximumRequestsPerWindow=1;
  const f=await fixture(t,{terms,extraActorUserIds:[other]}),before=state(f),selector={operation:'image-intake-bootstrap',campaignId:f.campaignId};
  assert.equal((await f.read(selector)).status,200);
  await assert.rejects(readSponsorImageIntake(request(f,other),f.env,selector),/limit/);
  assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);assert.equal(count(f,'experience_sponsor_resource_receipts'),0);unpaid(f);
});

test('retained drafts and exact completed receipt survive generation switches and approval revocation while fresh bootstrap closes',async t=>{
  const f=await fixture(t),saved=await f.prepare();await f.commit(saved.plan);
  const original=await(await f.nativeCall(`drafts/${saved.plan.draftId}/receipt`)).json();
  f.sqlite.prepare('UPDATE experience_sponsor_approvals SET revoked_at_ms=approved_at_ms WHERE campaign_id=?').run(f.campaignId);
  f.sqlite.prepare("UPDATE experience_sponsor_campaigns SET enabled=0,policy_json=json_set(policy_json,'$.expiresAtMs',1) WHERE campaign_id=?").run(f.campaignId);
  f.sqlite.prepare('UPDATE experience_sponsor_resource_policies SET enabled=0 WHERE campaign_id=?').run(f.campaignId);
  const before=state(f);
  for(const operation of operations){
    const response=await f.read({operation,draftId:saved.plan.draftId});assert.equal(response.status,200);
    if(operation==='image-intake-receipt')assert.deepEqual(await response.json(),original);
  }
  await assert.rejects(f.read({operation:'image-intake-bootstrap',campaignId:f.campaignId}));
  assert.equal(attempts(f).length,3);assert.deepEqual(state(f),before);unpaid(f);
});

test('saved selectors refuse another actor, caller sponsor hints and non-GET requests before charging',async t=>{
  const other='fixture-intake-not-owner',f=await fixture(t,{extraActorUserIds:[other]}),saved=await f.prepare(),before=state(f);
  const selector={operation:'image-intake-draft',draftId:saved.plan.draftId};
  await assert.rejects(readSponsorImageIntake(request(f,other),f.env,selector));
  for(const extra of [{campaignId:f.campaignId},{payerUserId:f.payer},{actorUserId:f.actor},{intentId:saved.plan.request.intentId},{maximumBytes:1},{nowMs:0}])
    await assert.rejects(f.read({...selector,...extra}));
  await assert.rejects(f.read({...selector,operation:'image-result'}));
  await assert.rejects(readSponsorImageIntake(new Request(request(f),{method:'POST'}),f.env,selector));
  assert.equal(attempts(f).length,0);assert.deepEqual(state(f),before);unpaid(f);
});

const withdrawal={
  'current consent':(f)=>f.sqlite.prepare('UPDATE users SET consent_version=NULL WHERE user_id=?').run(f.actor),
  'draft source erasure':(f,plan)=>f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=? AND owner_id=?")
    .run(new Date().toISOString(),plan.draftId,f.actor),
  'expired draft retention':(f,plan)=>f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(plan.draftId),
  'governed Document scope':(f,plan)=>f.sqlite.prepare(`INSERT INTO project_resource_scopes
    (project_access_id,resource_kind,resource_id,organization_id,project_id,owner_user_id,actor_user_id,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run('withdrawal-access','document',plan.documentId,'withdrawal-organization',plan.projectId,f.actor,f.actor,new Date().toISOString()),
};
for(const [name,change]of Object.entries(withdrawal))test(`already charged native draft read refuses ${name} without releasing its allocation`,async t=>{
  const f=await fixture(t),saved=await f.prepare(),input=await f.reserve({operation:'image-intake-draft',draftId:saved.plan.draftId});
  await change(f,saved.plan);const before=state(f);await assert.rejects(f.resolve(input));await assert.rejects(f.resolve(input));
  assert.equal(attempts(f).length,1);assert.equal(attempts(f)[0].maximum_bytes,1_000_000);assert.deepEqual(state(f),before);unpaid(f);
});

test('redacting one native committed event never discloses a completed original receipt',async t=>{
  const f=await fixture(t),saved=await f.prepare();await f.commit(saved.plan);
  const input=await f.reserve({operation:'image-intake-receipt',draftId:saved.plan.draftId});
  const member=f.sqlite.prepare('SELECT event_id FROM event_client_receipts WHERE stream_id=? ORDER BY sequence LIMIT 1').get(f.stream);
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(),member.event_id);
  const expected=await(await f.nativeCall(`drafts/${saved.plan.draftId}/receipt`)).json(),before=state(f),response=await f.resolve(input);
  assert.equal(response.status,409);assert.deepEqual(await response.json(),expected);assert.equal(expected.status,'unknown');assert.ok(!expected.appended?.length);
  assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);unpaid(f);
});

test('a removed native Document cannot be recovered through its retained draft alias',async t=>{
  const f=await fixture(t),saved=await f.prepare();await f.commit(saved.plan);
  const input=await f.reserve({operation:'image-intake-receipt',intentId:saved.plan.request.intentId});
  await appendAuditEvent(f.env,f.stream,'user','DocumentRemoved',{document_id:saved.plan.documentId});const before=state(f);
  await assert.rejects(f.resolve(input));assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);unpaid(f);
});

test('a skipped debit INSERT refuses before any retained source is returned',async t=>{
  const f=await fixture(t),saved=await f.prepare(),before=state(f);
  f.sqlite.exec('CREATE TRIGGER refuse_intake_read_debit BEFORE INSERT ON experience_sponsor_intake_read_attempts BEGIN SELECT RAISE(IGNORE); END');
  await assert.rejects(f.read({operation:'image-intake-draft',draftId:saved.plan.draftId}));
  assert.equal(attempts(f).length,0);assert.deepEqual(state(f),before);unpaid(f);
});

for(const fault of ['consent','private receipt'])test(`final disclosure rechecks ${fault} after native retained bytes were read`,async t=>{
  const f=await fixture(t),saved=await f.prepare();await f.commit(saved.plan);
  const input=await f.reserve({operation:'image-intake-receipt',draftId:saved.plan.draftId}),prepare=f.DB.prepare.bind(f.DB);let fired=false,atBoundary;
  f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!sql.includes('sponsor_intake_final_gate')||!sql.includes('SELECT 1 AS current FROM'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{
      const bound=bind(...values),first=bound.first.bind(bound);bound.first=async()=>{
        if(!fired){fired=true;
          if(fault==='consent')withdrawal['current consent'](f);
          else f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id=(SELECT event_id FROM event_client_receipts WHERE stream_id=? ORDER BY sequence LIMIT 1)")
            .run(new Date().toISOString(),f.stream);
          atBoundary=state(f);
        }
        return first();
      };return bound;
    };return statement;
  };
  await assert.rejects(f.resolve(input),/custody_changed/);assert.equal(fired,true);assert.deepEqual(state(f),atBoundary);assert.equal(attempts(f).length,1);unpaid(f);
});

test('small approved byte allowance refuses retained content without returning its oversized SQLite value',async t=>{
  const f=await fixture(t,{terms:policy(1024)}),saved=await f.prepare(),input=await f.reserve({operation:'image-intake-draft',draftId:saved.plan.draftId});
  const prepare=f.DB.prepare.bind(f.DB);let largest=0,readQueries=0;
  f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!sql.includes('sponsor_intake_read_rows'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),all=bound.all.bind(bound);
      bound.all=async()=>{readQueries++;const value=await all();largest=Math.max(largest,Buffer.byteLength(JSON.stringify(value)));return value;};return bound;};return statement;
  };
  const before=state(f);await assert.rejects(f.resolve(input),/unavailable|byte_limit/);assert.ok(readQueries>0);assert.ok(largest<1024,`Returned ${largest} bytes`);
  assert.equal(attempts(f)[0].maximum_bytes,1024);assert.deepEqual(state(f),before);unpaid(f);
});

test('malformed oversized retained draft is bounded in SQLite before its content reaches the resolver',async t=>{
  const f=await fixture(t),saved=await f.prepare(),input=await f.reserve({operation:'image-intake-draft',draftId:saved.plan.draftId});
  f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run('x'.repeat(2_000_000),saved.plan.draftId);
  const prepare=f.DB.prepare.bind(f.DB);let largest=0;
  f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!sql.includes('sponsor_intake_read_rows'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),all=bound.all.bind(bound);
      bound.all=async()=>{const value=await all();largest=Math.max(largest,Buffer.byteLength(JSON.stringify(value)));return value;};return bound;};return statement;
  };
  const before=state(f);await assert.rejects(f.resolve(input),/unavailable|byte_limit/);assert.ok(largest<100_000,`Oversized draft returned ${largest} bytes`);
  assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);unpaid(f);
});

test('monotonic read deadline bounds stalled native work after charge even if wall clock moves backward',async t=>{
  const f=await fixture(t,{terms:policy(1_000_000,100)}),saved=await f.prepare(),input=await f.reserve({operation:'image-intake-draft',draftId:saved.plan.draftId});
  const prepare=f.DB.prepare.bind(f.DB);let stalled=false;
  f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!sql.includes('sponsor_intake_read_rows'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values);bound.all=()=>{stalled=true;return new Promise(()=>{});};return bound;};return statement;
  };
  const before=state(f),started=performance.now();t.mock.method(Date,'now',()=>-1_000_000_000_000);
  await assert.rejects(f.resolve(input),/deadline|attempt_unavailable/);assert.equal(stalled,true);assert.ok(performance.now()-started<1000);
  assert.equal(attempts(f).length,1);assert.equal(attempts(f)[0].maximum_bytes,1_000_000);assert.deepEqual(state(f),before);unpaid(f);
});

test('a retained read-policy row without its actual payer approval cannot authorize or charge a read',async t=>{
  const f=await fixture(t),saved=await f.prepare();
  // Corrupt only this disposable database after provisioning through the actual
  // payer API. No synthetic policy or approval is inserted as authority.
  f.sqlite.exec('DROP TRIGGER experience_sponsor_intake_read_approvals_no_delete');
  f.sqlite.prepare('DELETE FROM experience_sponsor_intake_read_approvals WHERE campaign_id=?').run(f.campaignId);
  assert.equal(count(f,'experience_sponsor_intake_read_policies'),1);assert.equal(count(f,'experience_sponsor_intake_read_approvals'),0);
  const before=state(f);await assert.rejects(f.read({operation:'image-intake-draft',draftId:saved.plan.draftId}),/policy_unavailable/);
  assert.equal(attempts(f).length,0);assert.deepEqual(state(f),before);unpaid(f);
});

test('switching the exact environment DB reference during approval lookup refuses before read debit',async t=>{
  const f=await fixture(t),saved=await f.prepare(),req=request(f),authority=await identifySponsorIntakeRead(req,f.env,{operation:'image-intake-draft',draftId:saved.plan.draftId});
  const database=f.env.DB,prepare=database.prepare.bind(database),batch=database.batch.bind(database),before=state(f);let switched=false,debitBatches=0;
  database.batch=async statements=>{if(statements.some(statement=>/INSERT\s+INTO\s+experience_sponsor_intake_read_attempts\b/iu.test(statement.sql)))debitBatches++;return batch(statements);};
  database.prepare=sql=>{
    const statement=prepare(sql);if(!sql.startsWith('SELECT policy.campaign_id,policy.sponsor_policy_digest,policy.read_policy_digest'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);
      bound.first=async()=>{const result=await first();switched=true;f.env.DB={...database};return result;};return bound;};return statement;
  };
  await assert.rejects(reserveSponsorIntakeReadAttempt(authority,req,f.env,'image-intake-draft'),/authority_changed/);
  assert.equal(switched,true);assert.notEqual(f.env.DB,database);assert.equal(debitBatches,0);assert.equal(attempts(f).length,0);
  assert.deepEqual(state(f),before);unpaid(f);
});

test('switching the exact DB after the final valid custody result refuses disclosure and retains its charge',async t=>{
  const f=await fixture(t),saved=await f.prepare();await f.commit(saved.plan);
  const input=await f.reserve({operation:'image-intake-receipt',draftId:saved.plan.draftId}),database=f.env.DB;
  const prepare=database.prepare.bind(database),before=state(f),charged=attempts(f);let switched=false;
  database.prepare=sql=>{
    const statement=prepare(sql);if(!sql.includes('sponsor_intake_final_gate')||!sql.includes('SELECT 1 AS current FROM'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),first=bound.first.bind(bound);
      bound.first=async()=>{const result=await first();assert.equal(result?.current,1);switched=true;f.env.DB={...database};return result;};return bound;};return statement;
  };
  try{
    await assert.rejects(f.resolve(input),/authority_unavailable/);assert.equal(switched,true);assert.notEqual(f.env.DB,database);
    assert.deepEqual(state(f),before);assert.deepEqual(attempts(f),charged);assert.equal(charged.length,1);unpaid(f);
  }finally{f.env.DB=database;}
  await assert.rejects(f.resolve(input),/attempt_unavailable/);assert.deepEqual(attempts(f),charged);
});

test('an added oversized native event column never crosses the bounded receipt projection',async t=>{
  const f=await fixture(t),saved=await f.prepare();await f.commit(saved.plan);
  const expected=await(await f.nativeCall(`drafts/${saved.plan.draftId}/receipt`)).json();assert.equal(expected.status,'complete');
  f.sqlite.exec(`ALTER TABLE events ADD COLUMN fixture_unapproved_extra TEXT DEFAULT '${'x'.repeat(2_000_000)}'`);
  assert.equal(f.sqlite.prepare('SELECT length(fixture_unapproved_extra) AS n FROM events WHERE event_id=?').get(expected.appended[0].eventId).n,2_000_000);
  const input=await f.reserve({operation:'image-intake-receipt',draftId:saved.plan.draftId}),prepare=f.DB.prepare.bind(f.DB),before=state(f);
  let receiptReads=0,returnedBytes=0;
  f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!sql.includes('sponsor_intake_read_rows')||!sql.includes('SELECT expected.value AS requested_key'))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values),all=bound.all.bind(bound);
      bound.all=async()=>{const result=await all();receiptReads++;returnedBytes+=Buffer.byteLength(JSON.stringify(result.results));
        assert.ok(result.results.every(row=>!Object.hasOwn(row,'fixture_unapproved_extra')));return result;};return bound;};return statement;
  };
  const response=await f.resolve(input);assert.equal(response.status,200);assert.deepEqual(await response.json(),expected);
  assert.ok(receiptReads>0);assert.ok(returnedBytes>0&&returnedBytes<f.readTerms.operations['image-intake-receipt'].maximumBytes);
  assert.equal(attempts(f).length,1);assert.deepEqual(state(f),before);unpaid(f);
});

// Count actual SQL function arguments, respecting nested parentheses and quoted
// literals. This checks D1's SQL boundary; it does not reimplement read logic.
function sqlFunctions(sql){
  const known=new Set(['json_object','json_array','json_extract','json_group_array','json_set','coalesce','length','cast','instr','substr','strftime','julianday','max','min','sum','count']);
  const stack=[],found=[];let quote=null;
  for(let index=0;index<sql.length;index++){
    const char=sql[index];
    if(quote){if(char===quote){if(sql[index+1]===quote)index++;else quote=null;}continue;}
    if(char==="'"||char==='"'||char==='`'){quote=char;continue;}
    if(char==='('){let cursor=index-1;while(cursor>=0&&/\s/u.test(sql[cursor]))cursor--;const end=cursor+1;
      while(cursor>=0&&/\w/u.test(sql[cursor]))cursor--;const name=sql.slice(cursor+1,end).toLowerCase();
      stack.push({name:known.has(name)?name:null,commas:0,start:index});}
    else if(char===','&&stack.length)stack.at(-1).commas++;
    else if(char===')'&&stack.length){const item=stack.pop();if(item.name)found.push({name:item.name,arguments:sql.slice(item.start+1,index).trim()?item.commas+1:0});}
  }
  return found;
}

test('actual metered fresh, saved, pending and complete reads fit D1 SQL, binding and function limits',async t=>{
  const f=await fixture(t),prepare=f.DB.prepare.bind(f.DB),queries=[];let stage=null;
  f.DB.prepare=sql=>{
    const statement=prepare(sql),bind=statement.bind.bind(statement);
    statement.bind=(...values)=>{
      if(stage){const functions=sqlFunctions(sql);queries.push({stage,sqlBytes:Buffer.byteLength(sql),bindings:values.length,
        maximumFunctionArguments:Math.max(0,...functions.map(item=>item.arguments)),
        oversizedFunctions:functions.filter(item=>item.arguments>32),sqlSha256:createHash('sha256').update(sql).digest('hex'),sql});}
      return bind(...values);
    };return statement;
  };
  stage='fresh';assert.equal((await f.read({operation:'image-intake-bootstrap',campaignId:f.campaignId})).status,200);
  stage=null;const saved=await f.prepare();
  stage='draft';assert.equal((await f.read({operation:'image-intake-draft',draftId:saved.plan.draftId})).status,200);
  stage='pending';assert.equal((await f.read({operation:'image-intake-receipt',draftId:saved.plan.draftId})).status,409);
  stage=null;await f.commit(saved.plan);
  stage='complete';assert.equal((await f.read({operation:'image-intake-receipt',draftId:saved.plan.draftId})).status,200);stage=null;
  const limits={sqlBytes:100_000,bindings:100,functionArguments:32};
  const summaries=Object.fromEntries(['fresh','draft','pending','complete'].map(name=>{const rows=queries.filter(row=>row.stage===name);assert.ok(rows.length);
    return[name,{queries:rows.length,maximumSqlBytes:Math.max(...rows.map(row=>row.sqlBytes)),maximumBindings:Math.max(...rows.map(row=>row.bindings)),
      maximumFunctionArguments:Math.max(...rows.map(row=>row.maximumFunctionArguments))}];}));
  const violations=queries.filter(row=>row.sqlBytes>limits.sqlBytes||row.bindings>limits.bindings||row.maximumFunctionArguments>limits.functionArguments);
  const evidence={limits,summaries,violations:violations.map(({sql,...row})=>({...row,sqlPrefix:sql.slice(0,200)})),queries};
  writeFileSync(process.env.FORMA_INTAKE_READ_SQL_EVIDENCE??'/private/tmp/forma-sponsor-intake-read-sql-evidence-20260917.json',JSON.stringify(evidence,null,2)+'\n');
  t.diagnostic(JSON.stringify({summaries,violations:evidence.violations}));
  assert.equal(attempts(f).length,4);unpaid(f);
  assert.equal(violations.length,0,'All actual read SQL must fit D1 limits; exact query evidence is preserved');
});

test('read policy, approval and charged attempt have no rowid aliases and refuse every mutation with recursive triggers off',async t=>{
  const f=await fixture(t);assert.equal((await f.read({operation:'image-intake-bootstrap',campaignId:f.campaignId})).status,200);
  f.sqlite.exec('PRAGMA recursive_triggers=OFF');assert.equal(f.sqlite.prepare('PRAGMA recursive_triggers').get().recursive_triggers,0);
  const before=state(f),charged=attempts(f);
  for(const table of ['experience_sponsor_intake_read_policies','experience_sponsor_intake_read_approvals','experience_sponsor_intake_read_attempts']){
    for(const alias of ['rowid','_rowid_','oid'])assert.throws(()=>f.sqlite.prepare(`SELECT ${alias} FROM ${table}`).all(),/no such column/);
    const row=f.sqlite.prepare(`SELECT * FROM ${table}`).get();assert.ok(row);const columns=Object.keys(row),first=columns[0];
    assert.throws(()=>f.sqlite.prepare(`UPDATE ${table} SET ${first}=${first}`).run(),/immutable/);
    assert.throws(()=>f.sqlite.prepare(`DELETE FROM ${table}`).run(),/immutable/);
    assert.throws(()=>f.sqlite.prepare(`INSERT OR REPLACE INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column])),/exists/);
  }
  assert.deepEqual(state(f),before);assert.deepEqual(attempts(f),charged);unpaid(f);
});

// Fault injection only: the child process redirects this core's project-intake
// import to a facade that still invokes the actual native implementation. Its
// wrapper changes only the SQL/bind vector presented to the private adapter.
// No source file, native producer, guard or adapter implementation is copied.
const nativeReceiptFacade=String.raw`
import {commitAtomicIntake as actualCommit} from __ACTUAL_NATIVE_INTAKE_URL__;
export async function commitAtomicIntake(env,auth,intake,mode,options){
  const state=globalThis.__formaNativeReceiptFault;
  if(mode!=='check')throw Error('Fault facade permits the actual check operation only');
  const DB={...env.DB,prepare(sql){
    if(!sql.startsWith('SELECT expected.value AS requested_key'))return env.DB.prepare(sql);
    state.hookCalls++;let changed=sql;
    if(state.mode==='suffix')changed+=' /* fixture suffix */';
    if(state.mode==='guard'){
      if(!sql.includes(options.guard.sql))throw Error('Actual native guard was not observed');
      changed=sql.replace(options.guard.sql,'('+options.guard.sql+') AND 1=1');
    }
    if(state.mode==='duplicate-marker')changed+=' /* SELECT expected.value AS requested_key */';
    const statement=env.DB.prepare(changed);
    return {bind(...bindings){
      const changedBindings=[...bindings];
      if(state.mode==='binding-tail')changedBindings[changedBindings.length-1]=String(changedBindings.at(-1))+':changed';
      if(state.mode==='binding-order')[changedBindings[0],changedBindings[1]]=[changedBindings[1],changedBindings[0]];
      if(state.mode!=='none'&&changed===sql&&changedBindings.every((v,i)=>Object.is(v,bindings[i])))throw Error('Fault did not alter the native request');
      return statement.bind(...changedBindings);
    }};
  }};
  return actualCommit({...env,DB},auth,intake,mode,options);
}
`;
const nativeReceiptFaultProgram=String.raw`
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),mode=process.env.FORMA_NATIVE_READ_FAULT_MODE;
const coreURL=pathToFileURL(root+'/worker/experience-sponsor-intake-reads.ts').href;
const nativeURL=pathToFileURL(root+'/worker/project-intake.ts').href;
const facade=process.env.FORMA_NATIVE_READ_FAULT_FACADE.replace('__ACTUAL_NATIVE_INTAKE_URL__',JSON.stringify(nativeURL));
const facadeURL='data:text/javascript;base64,'+Buffer.from(facade).toString('base64');
const files=['worker/experience-sponsor-intake-reads.ts','worker/project-intake.ts','worker/project-intake-read.ts','tests/sponsor-initial-intake-fixture.mjs'];
const hashes=()=>files.map(file=>createHash('sha256').update(readFileSync(root+'/'+file)).digest('hex'));
const before=hashes(),cleanup=[];let intercepts=0,network=0;
registerHooks({resolve(specifier,context,next){
  if(context.parentURL===coreURL&&(specifier==='./project-intake.ts'||specifier===nativeURL)){intercepts++;return {url:facadeURL,shortCircuit:true};}
  return next(specifier,context);
}});
globalThis.__formaNativeReceiptFault={mode,hookCalls:0};
globalThis.fetch=()=>{network++;throw Error('Native receipt fault test prohibits network');};
try{
  const {fixture,requestFor}=await import(pathToFileURL(root+'/tests/sponsor-initial-intake-fixture.mjs'));
  const [{prepareSponsorImageDraft},{SPONSOR_INTAKE_READ_POLICY_SCHEMA},
    {SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,prepareSponsorIntakeReadApproval,approveSponsorIntakeReadPolicy},
    {SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA},{readSponsorImageIntake}]=await Promise.all([
    import(pathToFileURL(root+'/worker/experience-sponsor-intake.ts')),import(pathToFileURL(root+'/worker/experience-sponsor-intake-read-policy.ts')),
    import(pathToFileURL(root+'/worker/experience-sponsor-intake-read-approval.ts')),import(pathToFileURL(root+'/worker/experience-sponsor-intake-read-attempts.ts')),
    import(coreURL),
  ]);
  const f=await fixture({after(fn){cleanup.push(fn);}});
  for(const schema of [SPONSOR_INTAKE_READ_POLICY_SCHEMA,SPONSOR_INTAKE_READ_APPROVAL_SCHEMA,SPONSOR_INTAKE_READ_ATTEMPT_SCHEMA])for(const sql of schema)f.sqlite.exec(sql);
  const readPolicy={version:1,windowMs:60000,operations:Object.fromEntries(['image-intake-bootstrap','image-intake-draft','image-intake-receipt'].map(op=>[op,{maximumBytes:1000000,deadlineMs:10000}])),
    actor:{maximumRequestsPerWindow:20,maximumBytesPerWindow:20000000},campaign:{maximumRequestsPerWindow:40,maximumBytesPerWindow:40000000}};
  const proposal={version:1,campaignId:f.campaignId,sponsorPolicyDigest:f.compiled.policyDigest,readPolicy};
  const payer=body=>requestFor(f,body,{actorUserId:f.payer});
  const reviewed=await prepareSponsorIntakeReadApproval(payer({action:'prepare-sponsor-intake-read-policy',proposal}),f.env);
  await approveSponsorIntakeReadPolicy(payer({action:'approve-sponsor-intake-read-policy',approvalId:'facade-read-approval',proposal,
    reviewedTermsDigest:reviewed.termsDigest,confirmation:'APPROVE_SPONSOR_INTAKE_READ_POLICY'}),f.env);
  const saved=await prepareSponsorImageDraft(f.prepareRequest(),f.env),expected=await(await f.nativeCall('drafts/'+saved.plan.draftId+'/receipt')).json();
  const tables=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'experience_sponsor_intake_read_attempts' ORDER BY name").all().map(row=>row.name);
  const snapshot=()=>Object.fromEntries(tables.map(name=>[name,f.sqlite.prepare('SELECT * FROM '+name).all()])),original=snapshot();
  const prepare=f.DB.prepare.bind(f.DB);let nativeReceiptQueries=0;
  f.DB.prepare=sql=>{if(sql.includes('sponsor_intake_read_rows')&&sql.includes('SELECT expected.value AS requested_key'))nativeReceiptQueries++;return prepare(sql);};
  const read=()=>readSponsorImageIntake(new Request('http://localhost/__fixture/native-receipt-fault',{headers:f.actorHeaders}),f.env,
    {operation:'image-intake-receipt',draftId:saved.plan.draftId});
  if(mode==='none'){const response=await read();assert.equal(response.status,409);assert.deepEqual(await response.json(),expected);assert.equal(nativeReceiptQueries,1);}
  else{await assert.rejects(read(),/sponsor_intake_read_native_query_changed/);assert.equal(nativeReceiptQueries,0);}
  assert.equal(intercepts,1);assert.equal(globalThis.__formaNativeReceiptFault.hookCalls,1);
  assert.deepEqual(snapshot(),original);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM experience_sponsor_intake_read_attempts').get().n,1);
  assert.deepEqual(hashes(),before);assert.equal(network,0);
  console.log(JSON.stringify({mode,intercepts,hookCalls:1,nativeReceiptQueries,sourceBookendsMatch:true,network}));
}finally{for(const close of cleanup.reverse())close();}
`;
for(const mode of ['none','suffix','guard','binding-tail','binding-order','duplicate-marker'])test(`actual native receipt facade ${mode==='none'?'preserves the unmodified producer':`refuses injected ${mode} before receipt rows`}`,()=>{
  const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',nativeReceiptFaultProgram],{
    cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',timeout:30_000,maxBuffer:1_000_000,
    env:{...process.env,FORMA_NATIVE_READ_FAULT_MODE:mode,FORMA_NATIVE_READ_FAULT_FACADE:nativeReceiptFacade},
  });
  assert.equal(child.status,0,child.stderr+'\n'+child.stdout);assert.equal(child.error,undefined);
  const result=JSON.parse(child.stdout.trim().split('\n').findLast(line=>line.startsWith('{"mode":')));
  assert.equal(result.mode,mode);assert.equal(result.hookCalls,1);assert.equal(result.nativeReceiptQueries,mode==='none'?1:0);
  assert.equal(result.sourceBookendsMatch,true);assert.equal(result.network,0);
});
