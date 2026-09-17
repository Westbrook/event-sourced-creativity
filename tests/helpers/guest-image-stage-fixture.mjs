import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outputTestDatabase,registerOutputSourceImports} from '../output-execution-test-helpers.mjs';
registerOutputSourceImports();
const [{ensureSchema},{POLICY_VERSION},{GUEST_CUSTODY_SCHEMA,GUEST_DB_NOW,issueGuestClaimSession,readGuestCustodyTerms},
  {GUEST_SOURCE_SCHEMA,readGuestSourcePolicy,prepareGuestImageSource,commitGuestImageSource},{inspectGuestContextInventory},
  {SPONSOR_ENTITLEMENT_SCHEMA},{SPONSOR_RESOURCE_SCHEMA},{SPONSOR_APPROVAL_SCHEMA},{approveGuestSponsorCampaign},
  {compileGuestSponsorApprovalProposal},{saveGuestImageRequirement,readGuestImageRequirement},
  {registeredExperience,initialValues},{canonicalJson,digest},{preflightOutputImageSlidesTarget},{sponsorImageTransport},
  {experienceOutputBinding,experienceOutputCommandKey},{createExperienceOutputRecipe},{serializeEvent},{foldEvents},
  {outputRequirements},{authoritativeCreativeContext},{outputDigest},{publicEventPayload},{makeEvent},{insertEventAtHead},{SPONSOR_DRIVER_SCHEMA}]=await Promise.all([
  import('../../worker/runtime.ts'),import('../../worker/policy-version.ts'),import('../../worker/experience-guest-session.ts'),
  import('../../worker/experience-guest-source.ts'),import('../../worker/experience-guest-context-inventory.ts'),
  import('../../worker/experience-sponsor-entitlement.ts'),import('../../worker/experience-sponsor-resources.ts'),import('../../worker/experience-sponsor-approval.ts'),
  import('../../worker/experience-guest-sponsor-approval.ts'),import('../../worker/experience-guest-sponsor-contract.ts'),import('../../worker/experience-guest-image-output.ts'),
  import('../../src/experiences/intake.ts'),import('../../src/experiences/compiler.ts'),import('../../worker/output-image-slides-preflight.ts'),import('../../worker/experience-sponsor-image-evidence.ts'),
  import('../../worker/experience-output-binding.ts'),import('../../worker/experience-output-recipe.ts'),import('../../worker/event-read-primitives.ts'),import('../../src/model/events.ts'),
  import('../../worker/output-trusted-context.ts'),import('../../worker/context-authority.ts'),import('../../worker/output-disclosure-proof.ts'),import('../../worker/event-privacy.ts'),import('../../worker/event-write-primitives.ts'),import('../../worker/event-append.ts'),import('../../worker/experience-sponsor-driver.ts')]);
const origin='https://guest.example.invalid',subject='A blue heron on a stone bridge',payer='synthetic-image-payer',time='2020-01-01T00:00:00.000Z';
const request=()=>new Request(`${origin}/unregistered-guest-image-output`,{method:'POST',headers:{origin}});
const proofFor=session=>({sessionId:session.sessionId,sessionToken:session.sessionToken,claimToken:session.claimToken});
const rows=(f,table)=>f.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all();
const snapshot=f=>{const schema=f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();return {schema,contents:Object.fromEntries(schema.filter(row=>row.type==='table').map(row=>[row.name,rows(f,row.name)]))};};
const changes=f=>f.sqlite.prepare('SELECT total_changes() AS n').get().n;
const outputTables=['events','event_private_payloads','output_commands','experience_sponsor_resource_receipts'];
const nativeEvents=f=>f.sqlite.prepare('SELECT event.*,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE stream_id=? ORDER BY sequence').all(`creative:${f.session.guestSubject}`).map(serializeEvent);
function unchangedExcept(f,before,allowed=outputTables){const after=snapshot(f);assert.deepEqual(after.schema,before.schema);for(const [table,value]of Object.entries(before.contents))if(!allowed.includes(table))assert.deepEqual(after.contents[table],value,table);}
function insert(f,table,row){const keys=Object.keys(row);f.sqlite.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}
const memoryFiles=['0027_memory_native_origins.sql','0033_memory_structured_answer_provenance.sql','0034_memory_document_job_origins.sql'];
const installMemory=f=>{for(const file of memoryFiles)f.sqlite.exec(readFileSync(new URL('../../drizzle/'+file,import.meta.url),'utf8'));};
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


async function approvePolicy(f,policy=f.policy,approvalId='synthetic-image-approval'){
  const {approvalReceiptDigest:ignored,...proposed}=structuredClone(policy);void ignored;
  const proposal={version:1,purpose:'guest-sponsored-image',issuerProtocol:'guest-image-source@1',policy:proposed},compiled=await compileGuestSponsorApprovalProposal(proposal);
  const command={version:1,action:'approve-guest-sponsor-campaign',approvalId,proposal,reviewedTermsDigest:compiled.termsDigest,confirmation:'APPROVE_GUEST_SPONSOR_CAMPAIGN'};
  const req=new Request(`${origin}/unregistered-guest-approval`,{method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':payer,'oai-authenticated-user-email':`${payer}@example.invalid`},body:JSON.stringify(command)});
  const approved=await approveGuestSponsorCampaign(req,f.env);assert.equal(approved.status,'approved');return compiled;
}
async function baseFixture(t,{memory=false,approved=true,draftLifetimeMs=120000,policyChange,subjectText=subject}={}){
  const f=outputTestDatabase();
  // This frozen helper labels WITH statements as reads. Execute the native resource CTE insertion as a write so its acknowledgment reports real SQLite changes.
  const nativeBatch=f.DB.batch;f.DB.batch=statements=>nativeBatch.call(f.DB,statements.map(statement=>{if(/WITH[\s\S]*INSERT INTO experience_sponsor_resource_receipts/u.test(statement.sql)){const execute=statement.execute;statement.execute=function(kind){return execute.call(this,kind==='all'?'run':kind);};}return statement;}));
  t.after(()=>f.sqlite.close());await ensureSchema(f.env);
  for(const sql of [...GUEST_CUSTODY_SCHEMA,...GUEST_SOURCE_SCHEMA,...SPONSOR_ENTITLEMENT_SCHEMA,...SPONSOR_RESOURCE_SCHEMA,...SPONSOR_APPROVAL_SCHEMA,...SPONSOR_DRIVER_SCHEMA])f.sqlite.exec(sql);
  if(memory)installMemory(f);insert(f,'users',{user_id:payer,email:`${payer}@example.invalid`,display_name:payer,role:'creator',consent_version:POLICY_VERSION,consented_at:time,created_at:time,updated_at:time});
  Object.assign(f.env,{OPENAI_API_KEY:'no-network-fixture',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
  let egress=0,media=0;t.mock.method(globalThis,'fetch',()=>{egress++;throw Error('network forbidden');});for(const method of ['get','head','put','delete','list'])t.mock.method(f.env.MEDIA,method,()=>{media++;throw Error('media forbidden');});
  t.after(()=>{assert.equal(egress,0);assert.equal(media,0);});const now=f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  const terms=readGuestCustodyTerms({version:1,policyId:'guest-policy',origin,startsAtMs:now-60000,expiresAtMs:now+600000,sessionLifetimeMs:300000,leaseLifetimeMs:60000,maximumSessions:5,maximumLeaseAcquisitions:3});
  f.sqlite.prepare('INSERT INTO experience_guest_policies VALUES(?,?,?,?,NULL)').run(terms.policyId,await digest(terms),canonicalJson(terms),`sha256:${'b'.repeat(64)}`);
  const session=await issueGuestClaimSession(request(),f.env,terms.policyId),release=await registeredExperience('image'),values=initialValues(release);
  values.subject={value:subjectText,provenance:'authored'};values.ratio={value:{width:1,height:1},provenance:'authored'};
  const sourcePolicy=readGuestSourcePolicy({version:1,policyId:'source-policy',sessionPolicyId:terms.policyId,sessionTermsDigest:await digest(terms),releaseHash:release.releaseHash,maximumDraftBytes:65536,maximumEventBytes:65536,maximumEvents:16,draftLifetimeMs});
  f.sqlite.prepare('INSERT INTO experience_guest_source_policies VALUES(?,?,?,?,NULL)').run(sourcePolicy.policyId,await digest(sourcePolicy),canonicalJson(sourcePolicy),`sha256:${'c'.repeat(64)}`);
  const proof=proofFor(session),prepared=await prepareGuestImageSource(request(),f.env,{proof,policyId:sourcePolicy.policyId,request:{intentId:session.sessionId,experienceId:'image',releaseHash:release.releaseHash,values}});
  const committed=await commitGuestImageSource(request(),f.env,{proof,draftHash:prepared.plan.draftHash}),inventory=await inspectGuestContextInventory(request(),f.env,{proof});
  Object.assign(f,{session,terms,sourcePolicy,release,proof,prepared,committed,inventory,subject:subjectText});f.policy=await candidatePolicy(f);f.policy.payerUserId=payer;
  if(policyChange)await policyChange(f.policy,f);f.compiled=approved?await approvePolicy(f):await compileGuestSponsorApprovalProposal({version:1,purpose:'guest-sponsored-image',issuerProtocol:'guest-image-source@1',policy:Object.fromEntries(Object.entries(f.policy).filter(([key])=>key!=='approvalReceiptDigest'))});
  f.input={proof,campaignId:f.policy.campaignId,policyDigest:f.compiled.policyDigest,draftHash:prepared.plan.draftHash};f.request=request();
  f.save=(input=f.input,req=f.request,env=f.env)=>saveGuestImageRequirement(req,env,input);f.read=(input=f.input,req=f.request,env=f.env)=>readGuestImageRequirement(req,env,input);
  assert.equal(rows(f,'users').length,1);assert.equal(rows(f,'users')[0].user_id,payer);return f;
}

/** A genuine guest session/source, native payer approval and actual first SAVE.
 * No test file is imported. Stage tests share only setup and read-only helpers. */
export async function fixture(t, { saved = true, ...options } = {}) {
  const f = await baseFixture(t, options);
  if (saved) f.saved = await f.save();
  return f;
}
export function batchHook(f, predicate, action, { after = true } = {}) {
  const batch = f.DB.batch; let attempts = 0;
  f.DB.batch = async statements => {
    if (!predicate(statements)) return batch.call(f.DB, statements);
    attempts++;
    if (attempts === 1 && !after) action(statements);
    const result = await batch.call(f.DB, statements);
    return attempts === 1 && after ? action(result) : result;
  };
  return () => { f.DB.batch = batch; assert.equal(attempts, 1, 'one consequential stage batch attempt'); };
}
export function readHook(f, predicate, action, { after = true, method = 'first' } = {}) {
  const prepare = f.DB.prepare; let hit = false;
  function wrap(statement, sql) {
    const original = statement[method], bind = statement.bind;
    statement.bind = function (...args) { return wrap(bind.apply(this, args), sql); };
    statement[method] = async function () {
      if (!hit && predicate(sql)) {
        hit = true; if (!after) action();
        const result = await original.call(this); if (after) action(); return result;
      }
      return original.call(this);
    };
    return statement;
  }
  f.DB.prepare = function (sql) { return wrap(prepare.call(this, sql), sql); };
  return () => { f.DB.prepare = prepare; assert.equal(hit, true, 'native read hook executed'); };
}
export function redactSource(f) {
  f.sqlite.prepare("UPDATE private_content SET content='',redacted_at='2026-01-01T00:00:00.000Z' WHERE content_id=?").run(f.prepared.plan.draftId);
}
export function addLease(f, expired = false) {
  const now = f.sqlite.prepare(`SELECT ${GUEST_DB_NOW} AS now`).get().now;
  f.sqlite.prepare('INSERT INTO experience_guest_claim_leases VALUES(?,?,?,?,?,?,?,?,?)')
    .run(f.session.sessionId, crypto.randomUUID(), payer, f.inventory.manifestDigest, 'lease-request', '["lease-request"]', 1, now - 1000, expired ? now - 1 : now + 60000);
}
export const contextBytes = f => Buffer.byteLength(canonicalJson(authoritativeCreativeContext(nativeEvents(f).slice(0, f.committed.head),
  { projectId: f.session.projectId, documentId: f.session.documentId }).snapshot));
export { origin, subject, payer, time, request, proofFor, rows, snapshot, changes, nativeEvents, unchangedExcept, insert,
  installMemory, approvePolicy, canonicalJson, digest, outputDigest, foldEvents, outputRequirements, authoritativeCreativeContext,
  experienceOutputBinding, experienceOutputCommandKey, createExperienceOutputRecipe, publicEventPayload,
  makeEvent, insertEventAtHead, GUEST_DB_NOW, SPONSOR_DRIVER_SCHEMA };
