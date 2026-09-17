import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {enforceD1ExpressionDepth} from './helpers/d1-expression-depth.mjs';
registerOutputSourceImports();
const [{ensureSchema},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {prepareGuestImageProducer,recheckGuestImagePreparation},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {registeredExperience,initialValues,experienceResourceId},{canonicalJson,digest},{createExperienceOutputRecipe}]=await Promise.all([
  import('../worker/runtime.ts'),import('../worker/experience-guest-session.ts'),import('../worker/experience-guest-source.ts'),
  import('../worker/experience-guest-context-inventory.ts'),import('../worker/experience-guest-image-preparation.ts'),
  import('../worker/output-image-slides-preflight.ts'),import('../worker/experience-sponsor-image-evidence.ts'),
  import('../src/experiences/intake.ts'),import('../src/experiences/compiler.ts'),import('../worker/experience-output-recipe.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge';
const request=()=>new Request(`${origin}/unregistered-guest-image-preparation`,{method:'POST',headers:{origin}});
const proofFor=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
  return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)])),changes:changes(f)};};
const sameDatabase=(f,before)=>assert.deepEqual(snapshot(f),before);
const memoryFiles=['0027_memory_native_origins.sql','0033_memory_structured_answer_provenance.sql','0034_memory_document_job_origins.sql'];
const installMemory=f=>{for(const file of memoryFiles)f.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));};
const finalSql=sql=>sql.startsWith('WITH guest_bootstrap_native AS MATERIALIZED');
async function templateFor(env, release) {
  const offered = await preflightOutputImageSlidesTarget({ env,
    target: { id: 'synthetic-template', selected: true, blocking_issues: [], media_kind: 'image', source_scope: { kind: 'document' },
      aspect_ratio: { width: 1, height: 1 }, instruction_text: 'Show a pear orchard', label: 'Synthetic template', coverage: { kind: 'document_outline' } },
    context: { snapshot: { facts: [{ type: 'subject', properties: { text: 'A pear orchard' } }] } } });
  assert.equal(offered.available, true);
  const settings = offered.settings, payload = settings.payload;
  return { version: 2, appId: 'image', recipeVersion: `image@${release.definition.revision}`, releaseDigest: release.releaseHash,
    outputKind: 'image', inputMode: 'text-only', outputCount: 1, durationMs: 0, width: 1024, height: 1024,
    route: offered.route, maximumCalls: offered.maximumCalls, maximumTokens: offered.maximumTokens, maximumMicrousd: offered.maximumMicrousd,
    calls: structuredClone(settings.calls), settings: { kind: settings.kind, productionMode: payload.productionMode,
      budgetAcknowledged: payload.budgetAcknowledged, preflightAcknowledged: payload.preflightAcknowledged,
      imageRender: structuredClone(settings.imageRender), imageBudget: structuredClone(settings.imageBudget), executionPolicy: structuredClone(settings.executionPolicy) },
    transport: await sponsorImageTransport(env) };
}
async function candidatePolicy(f) {
  const now = (await f.DB.prepare(`SELECT ${GUEST_DB_NOW} AS value`).first()).value, template = await templateFor(f.env, f.release);
  const allowance = { maximumOperations: 100, maximumTextBytes: 1000000, maximumOperationsPerWindow: 100, maximumTextBytesPerWindow: 1000000,
    maximumPendingGrants: 10, maximumInflightJobs: 1 };
  const resources = { version: 1, startsAtMs: now - 60000, expiresAtMs: now + 60000, windowMs: 60000, maximumOperationTextBytes: 65536,
    campaign: { ...allowance, maximumInflightJobs: 3 }, actor: { ...allowance } };
  return { version: 3, mode: 'candidate', campaignId: 'synthetic-guest-campaign', policyVersion: 'synthetic-guest@1', payerUserId: 'synthetic-unprovisioned-payer',
    audience: 'guest-session', approvalReceiptDigest: `sha256:${'d'.repeat(64)}`, startsAtMs: resources.startsAtMs, expiresAtMs: resources.expiresAtMs,
    maximumGrantLifetimeMs: 30000, maximumAdmissions: 10, maximumMicrousd: Math.max(1000000, template.maximumMicrousd * 10), maximumAdmissionsPerActor: 5,
    windowMs: 60000, maximumAdmissionsPerWindow: 10, maximumAdmissionsPerActorWindow: 5, templates: [template], resources,
    guestAdmission: { protocol: 'guest-image-source@1', origin, sessionPolicyId: f.terms.policyId, sessionTermsDigest: await digest(f.terms),
      sourcePolicyId: f.sourcePolicy.policyId, sourcePolicyDigest: await digest(f.sourcePolicy), releaseHash: f.release.releaseHash } };
}

async function fixture(t,{memory=false,committed=true,draftLifetimeMs=120000,sessionLifetimeMs=300000,ratio={width:1,height:1}}={}){
  const f=outputTestDatabase();t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA])f.sqlite.exec(sql);if(memory)installMemory(f);
  let egress=0,media=0;t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('network forbidden');});
  for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});
  t.after(()=>{assert.equal(egress,0);assert.equal(media,0);});
  const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,
    sessionLifetimeMs,leaseLifetimeMs:Math.min(60000,sessionLifetimeMs),maximumSessions:5,maximumLeaseAcquisitions:3});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subject,provenance:'authored'};values.ratio={value:ratio,provenance:'authored'};
  const sourcePolicy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,
    maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(sourcePolicy.policyId,await digest(sourcePolicy),canonicalJson(sourcePolicy),`sha256:${'c'.repeat(64)}`);
  const proof=proofFor(session),prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:sourcePolicy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}});
  const committedSource=committed?await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash}):null;
  const inventory=committed?await inspectGuestContextInventory(request(),f.env,{proof}):null;
  Object.assign(f,{session,terms,sourcePolicy,release,proof,prepared,committed:committedSource,inventory});
  f.policy=await candidatePolicy(f);f.request=request();f.input={proof,policy:f.policy,draftHash:prepared.plan.draftHash};
  f.prepare=(input=f.input,req=f.request,env=f.env)=>prepareGuestImageProducer(req,env,input);
  f.recheck=(seal,req=f.request,env=f.env)=>recheckGuestImagePreparation(req,env,seal);
  assert.equal(rows(f,'users').length,0);return f;
}
function hook(f,predicate,action,{method='first',after=true}={}){
  const prepare=f.DB.prepare;let hit=false;
  const wrap=(statement,sql)=>{const original=statement[method],bind=statement.bind;
    statement.bind=function(...args){return wrap(bind.apply(this,args),sql);};
    statement[method]=async function(){if(!hit&&predicate(sql)){hit=true;if(!after)action();const result=await original.call(this);if(after)action();return result;}return original.call(this);};return statement;};
  f.DB.prepare=function(sql){return wrap(prepare.call(this,sql),sql);};
  return()=>{f.DB.prepare=prepare;assert.equal(hit,true,'native read hook executed');};
}
const redact=f=>f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId);
function lease(f,expired=false){const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  f.sqlite.prepare('INSERT INTO experience_guest_claim_leases VALUES(?,?,?,?,?,?,?,?,?)').run(f.session.sessionId,crypto.randomUUID(),'unprovisioned-destination',f.inventory.manifestDigest,'fixture-request','["fixture-request"]',1,now-1000,expired?now-1:now+60000);}
function tail(f){const now=new Date().toISOString();f.sqlite.prepare('INSERT INTO events(event_id,stream_id,sequence,occurred_at,recorded_at,actor,client_id,correlation_id,schema_version,type,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(crypto.randomUUID(),`creative:${f.session.guestSubject}`,f.committed.head+1,now,now,f.session.guestSubject,'fixture:later','fixture:later',1,'DocumentRemoved',JSON.stringify({project_id:f.session.projectId,document_id:f.session.documentId}));}
function checkResult(f,result){assert.equal(result.status,'source-bound');assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.summary));assert.ok(Object.isFrozen(result.preparation));
  assert.equal(Object.getPrototypeOf(result.preparation),null);assert.equal(JSON.stringify(result.preparation),'{}');
  assert.equal(result.summary.protocol,'guest-image-source@1');assert.equal(result.summary.campaignId,f.policy.campaignId);assert.equal(result.summary.draftHash,f.prepared.plan.draftHash);
  for(const flag of ['issuerVerified','admissionCommitted','providerSubmitted','generationAvailable','custodyTransferred'])assert.equal(result.summary[flag],false,flag);
  for(const hash of ['sessionDigest','guestSourceDigest','policyDigest','proposedRequirementDigest'])assert.match(result.summary[hash],/^sha256:[a-f0-9]{64}$/u);
  for(const secret of [subject,f.session.sessionToken,f.session.claimToken,f.session.guestSubject,f.session.sessionId,f.session.projectId,f.session.documentId,'private_json','SELECT'])assert.ok(!JSON.stringify(result).includes(secret),'source-free preparation summary');
  assert.ok(result.summary.expiresAtMs<=f.session.expiresAtMs);assert.ok(result.summary.expiresAtMs<=Date.parse(f.prepared.expiresAt));
}
async function waitUntil(predicate){const start=performance.now();while(!predicate()){assert.ok(performance.now()-start<5000);await delay(10);}}

for(const memory of [false,true])test(`native preparation and recheck fit strict D1 limits with ${memory?'complete':'absent'} Memory schema and perform zero writes`,async t=>{
  const f=await fixture(t,{memory}),before=snapshot(f),limits=enforceD1ExpressionDepth(f,{queryLimits:{functionArguments:32,parameters:100,sqlBytes:100000}});
  try{const result=await f.prepare();checkResult(f,result);await f.recheck(result.preparation);limits.assertVerified();
    t.diagnostic(JSON.stringify({memory,qualifiedQueries:limits.records.length,maxBindings:Math.max(...limits.boundCounts),maxSqlBytes:Math.max(...limits.records.map(row=>row.statementBytes))}));
  }finally{limits.restore();}sameDatabase(f,before);
});
test('actual guest source yields an opaque frozen prerequisite without a user, sponsor approval or provider work',async t=>{
  const f=await fixture(t),before=snapshot(f),prepare=f.DB.prepare;f.DB.prepare=function(sql){assert.match(sql,/^\s*(?:SELECT|WITH|PRAGMA)\b/iu,'read-only preparation SQL');return prepare.call(this,sql);};
  const first=await f.prepare();checkResult(f,first);await f.recheck(first.preparation);await f.recheck(first.preparation);const second=await f.prepare();checkResult(f,second);
  assert.equal(second.summary.intentKey,first.summary.intentKey);assert.equal(second.summary.driverId,first.summary.driverId);assert.equal(second.summary.guestSourceDigest,first.summary.guestSourceDigest);
  assert.equal(first.summary.policyDigest,await digest(f.policy));const requirementId=await experienceResourceId(f.prepared.plan.draftId,'native-output-requirement');
  const recipe=createExperienceOutputRecipe({output:'image',requirementId,deliverableId:await experienceResourceId(f.prepared.plan.draftId,'native-output-deliverable'),variantId:await experienceResourceId(f.prepared.plan.draftId,'native-output-variant'),aspectRatio:{width:1,height:1}});
  assert.equal(first.summary.proposedRequirementDigest,await digest(recipe.spec));assert.equal(first.summary.targetId,recipe.targetId);
  assert.equal(Object.isFrozen(f.env),false);assert.equal(Object.isFrozen(f.DB),false);f.DB.prepare=prepare;sameDatabase(f,before);
});
test('uncommitted guest draft cannot be silently committed by producer preparation',async t=>{const f=await fixture(t,{committed:false}),before=snapshot(f);await assert.rejects(f.prepare());sameDatabase(f,before);});
test('opaque preparation is bound to exact Request, env and database identities',async t=>{
  const f=await fixture(t),{preparation}=await f.prepare(),before=snapshot(f);
  for(const fake of [{},{...preparation},structuredClone(preparation),JSON.parse(JSON.stringify(preparation)),null])await assert.rejects(f.recheck(fake));
  await assert.rejects(f.recheck(preparation,new Request(f.request)));await assert.rejects(f.recheck(preparation,f.request,{...f.env}));
  f.env.DB={...f.DB};await assert.rejects(f.recheck(preparation),/database_changed/);f.env.DB=f.DB;await f.recheck(preparation);sameDatabase(f,before);
});
test('closed input, swapped credential purposes and an unknown guest session are refused without writes',async t=>{
  const f=await fixture(t),before=snapshot(f);
  for(const input of [{...f.input,extra:true},{...f.input,draftHash:'invalid'},{...f.input,proof:{...f.proof,extra:true}},
    {...f.input,proof:{...f.proof,claimToken:f.proof.sessionToken}},{...f.input,proof:{...f.proof,sessionId:'missing'}}])await assert.rejects(f.prepare(input));sameDatabase(f,before);
});
test('every candidate guest admission binding must match the real native source',async t=>{
  const f=await fixture(t),before=snapshot(f);
  for(const key of ['sessionPolicyId','sessionTermsDigest','sourcePolicyId','sourcePolicyDigest','releaseHash']){const policy=structuredClone(f.policy);
    policy.guestAdmission[key]=key.endsWith('Id')?'wrong-policy':`sha256:${'0'.repeat(64)}`;if(key==='releaseHash')policy.templates[0].releaseDigest=policy.guestAdmission[key];
    await assert.rejects(f.prepare({...f.input,policy}));}
  await assert.rejects(f.prepare({...f.input,draftHash:`sha256:${'0'.repeat(64)}`}));const policy=structuredClone(f.policy);policy.payerUserId=f.session.guestSubject;await assert.rejects(f.prepare({...f.input,policy}));sameDatabase(f,before);
});
test('source authored ratio must match the candidate Image template',async t=>{const f=await fixture(t,{ratio:{width:3,height:2}}),before=snapshot(f);await assert.rejects(f.prepare());sameDatabase(f,before);});
test('HTTPS POST and exact same-origin request envelope are required',async t=>{
  const f=await fixture(t),before=snapshot(f),cases=[new Request(f.request.url,{headers:{origin}}),new Request(f.request.url,{method:'POST'}),
    new Request(f.request.url,{method:'POST',headers:{origin:'https://other.invalid'}}),new Request(f.request.url+'?x=1',{method:'POST',headers:{origin}}),
    new Request(f.request.url+'#x',{method:'POST',headers:{origin}}),new Request(f.request.url,{method:'POST',headers:{origin,'sec-fetch-site':'cross-site'}}),
    new Request(f.request.url.replace('https:','http:'),{method:'POST',headers:{origin}})];
  for(const req of cases)await assert.rejects(f.prepare(f.input,req));for(const site of ['same-origin','none']){const req=new Request(f.request.url,{method:'POST',headers:{origin,'sec-fetch-site':site}});checkResult(f,await f.prepare(f.input,req));}sameDatabase(f,before);
});
for(const stage of ['prepare','recheck'])test(`aborted request denies ${stage} without writes`,async t=>{
  const f=await fixture(t),controller=new AbortController();f.request=new Request(f.request,{signal:controller.signal});const result=stage==='recheck'?await f.prepare():null;controller.abort();const before=snapshot(f);
  await assert.rejects(stage==='prepare'?f.prepare():f.recheck(result.preparation));sameDatabase(f,before);
});
test('mutable request headers cannot change the origin or fetch-site of an issued preparation',async t=>{
  const f=await fixture(t),{preparation}=await f.prepare(),before=snapshot(f);f.request.headers.set('origin','https://other.invalid');await assert.rejects(f.recheck(preparation));f.request.headers.set('origin',origin);
  f.request.headers.set('sec-fetch-site','cross-site');await assert.rejects(f.recheck(preparation));sameDatabase(f,before);
});
for(const field of ['session','session-policy','source-policy'])test(`current ${field} revocation prevents first preparation and invalidates an issued seal`,async t=>{
  const f=await fixture(t),{preparation}=await f.prepare();const table=field==='session'?'experience_guest_sessions':field==='session-policy'?'experience_guest_policies':'experience_guest_source_policies';
  f.sqlite.prepare(`UPDATE ${table} SET revoked_at_ms=1`).run();const before=snapshot(f);
  if(field==='source-policy')assert.equal((await inspectGuestContextInventory(request(),f.env,{proof:f.proof})).manifestDigest,f.inventory.manifestDigest,'historical context inventory remains intentionally valid');
  await assert.rejects(f.prepare());await assert.rejects(f.recheck(preparation));sameDatabase(f,before);
});
for(const expired of [false,true])test(`${expired?'expired':'active'} pre-existing claim lease prevents preparation and a late lease invalidates recheck`,async t=>{
  const f=await fixture(t),{preparation}=await f.prepare();lease(f,expired);const before=snapshot(f);await assert.rejects(f.prepare());await assert.rejects(f.recheck(preparation));sameDatabase(f,before);
});
for(const kind of ['draft','native-private','tail','sidecar','memory-schema'])test(`current ${kind} drift invalidates preparation with no repairs or writes`,async t=>{
  const f=await fixture(t),{preparation}=await f.prepare();
  if(kind==='draft')redact(f);else if(kind==='native-private')f.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at='2026-01-01T00:00:00.000Z' WHERE private_event_id=?").run(f.committed.eventIds[0]);
  else if(kind==='tail')tail(f);else if(kind==='sidecar')f.sqlite.prepare('INSERT INTO private_content VALUES(?,?,?,?,?,?,NULL)').run('additional-guest-content',f.session.guestSubject,'prompt','other private body','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z');else installMemory(f);
  const before=snapshot(f);await assert.rejects(f.recheck(preparation));if(kind!=='memory-schema')await assert.rejects(f.prepare());sameDatabase(f,before);
});
for(const kind of ['source','session','candidate'])test(`database-time ${kind} expiry cannot be revived by a caller clock`,async t=>{
  const f=await fixture(t,{...(kind==='source'?{draftLifetimeMs:450}:{}),...(kind==='session'?{sessionLifetimeMs:450,draftLifetimeMs:120000}: {})});
  if(kind==='candidate')f.policy.maximumGrantLifetimeMs=180;const {preparation,summary}=await f.prepare();await waitUntil(()=>f.sqlite.prepare(`SELECT ${GUEST_DB_NOW}>=? AS expired`).get(summary.expiresAtMs).expired);
  t.mock.method(Date,'now',()=>0);const before=snapshot(f);await assert.rejects(f.recheck(preparation));if(kind!=='candidate')await assert.rejects(f.prepare());sameDatabase(f,before);
});
test('nested caller-owned inputs are captured before the first awaited source read',async t=>{
  const f=await fixture(t),original=structuredClone(f.input),expected=await digest(f.policy),before=snapshot(f),done=hook(f,sql=>sql.includes('FROM experience_guest_sessions'),()=>{
    f.input.draftHash=`sha256:${'0'.repeat(64)}`;f.input.proof.claimToken=f.input.proof.sessionToken;f.input.policy.guestAdmission.sourcePolicyId='changed';f.input.policy.campaignId='changed';
  });const result=await f.prepare();done();f.policy=original.policy;checkResult(f,result);assert.equal(result.summary.policyDigest,expected);sameDatabase(f,before);
});
test('native drift during asynchronous source hashing is rejected by the final full proof',async t=>{
  const f=await fixture(t),original=crypto.subtle.digest;let hit=false,damaged;
  t.mock.method(crypto.subtle,'digest',async function(...args){const result=await original.apply(this,args);if(!hit&&new TextDecoder().decode(args[1]).includes('forma-sponsor-guest-source@1')){hit=true;redact(f);damaged=snapshot(f);}return result;});
  await assert.rejects(f.prepare());assert.equal(hit,true);sameDatabase(f,damaged);
});
test('a lease racing the final native proof denies preparation without retrying or undoing the lease',async t=>{
  const f=await fixture(t);let raced;const done=hook(f,finalSql,()=>{lease(f);raced=snapshot(f);},{after:false});await assert.rejects(f.prepare());done();sameDatabase(f,raced);
});
for(const phase of ['prepare','recheck'])for(const change of ['database','abort'])test(`${change} replacement at outer ${phase} proof settlement denies stale success`,async t=>{
  const f=await fixture(t),controller=new AbortController();f.request=new Request(f.request,{signal:controller.signal});const existing=phase==='recheck'?await f.prepare():null,before=snapshot(f);
  const done=hook(f,finalSql,()=>queueMicrotask(()=>queueMicrotask(()=>{if(change==='database')f.env.DB={...f.DB};else controller.abort();})));
  await assert.rejects(phase==='prepare'?f.prepare():f.recheck(existing.preparation));done();f.env.DB=f.DB;sameDatabase(f,before);
});
test('cold missing native schema fails closed without account or schema initialization',async t=>{
  const source=await fixture(t),f=outputTestDatabase();t.after(()=>f.sqlite.close());const before=snapshot(f);await assert.rejects(prepareGuestImageProducer(source.request,f.env,source.input));sameDatabase(f,before);
});

test('candidate template revision must match the actual retained release revision',async t=>{
  const f=await fixture(t),policy=structuredClone(f.policy),before=snapshot(f);
  policy.templates[0].recipeVersion=`image@${f.release.definition.revision+1}`;
  await assert.rejects(f.prepare({...f.input,policy}));sameDatabase(f,before);
});


test('shorter candidate resource deadline is fixed at preparation and never extended by recheck',async t=>{
  const f=await fixture(t),now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;f.policy.resources.expiresAtMs=now+250;
  const before=snapshot(f),result=await f.prepare();assert.equal(result.summary.expiresAtMs,f.policy.resources.expiresAtMs);
  await f.recheck(result.preparation);assert.equal(result.summary.expiresAtMs,f.policy.resources.expiresAtMs);
  await waitUntil(()=>f.sqlite.prepare(`SELECT ${GUEST_DB_NOW}>=? AS expired`).get(result.summary.expiresAtMs).expired);
  await assert.rejects(f.recheck(result.preparation));await assert.rejects(f.prepare());sameDatabase(f,before);
});
test('future and expired candidate windows cannot turn a current source into issuer approval',async t=>{
  const f=await fixture(t),now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now,before=snapshot(f);
  for(const expired of [false,true]){const policy=structuredClone(f.policy);policy.startsAtMs=expired?now-120000:now+60000;policy.expiresAtMs=expired?now-60000:now+120000;
    policy.resources.startsAtMs=policy.startsAtMs;policy.resources.expiresAtMs=policy.expiresAtMs;await assert.rejects(f.prepare({...f.input,policy}));}sameDatabase(f,before);
});
test('late registered native Memory content is excluded even when the original source body remains intact',async t=>{
  const f=await fixture(t,{memory:true}),{preparation}=await f.prepare(),table='memory_native_answer_origins';
  const row=Object.fromEntries(f.sqlite.prepare(`PRAGMA table_info(${table})`).all().filter(column=>column.notnull).map(column=>[column.name,column.type.toLowerCase()==='integer'?1:column.name.endsWith('_sha256')?'a'.repeat(64):`fixture-${column.name}`]));
  Object.assign(row,{recipe_version:'native-answer-origin-v1',actor_user_id:f.session.guestSubject,owner_user_id:f.session.guestSubject,project_id:f.session.projectId,document_id:f.session.documentId,
    answer_content_id:f.prepared.plan.draftId,user_source_sequence:2,answer_source_sequence:3,selection_cursor:1,answer_expires_at:'2099-01-01T00:00:00.000Z',enrolled_at:'2026-01-01T00:00:00.000Z',
    enrollment_expires_at:'2099-01-01T00:00:00.000Z',source_retention_ceiling:'2099-01-01T00:00:00.000Z',created_at:'2026-01-01T00:00:00.000Z',status:'active'});
  const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
  const before=snapshot(f);await assert.rejects(f.recheck(preparation));await assert.rejects(f.prepare());sameDatabase(f,before);
});
