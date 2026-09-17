import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
const {fileURLToPath}=await import('node:url');
const C=process.env.FORMA_SOURCE_ROOT??fileURLToPath(new URL('../',import.meta.url));
const {registerOutputSourceImports}=await import(C+'/tests/output-execution-test-helpers.mjs');registerOutputSourceImports();
registerHooks({resolve(specifier,context,next){
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const normal=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);if(!existsSync(normal)&&normal.pathname.includes('/src/experiences/'))return next(new URL('file://'+C+'/src/experiences/'+normal.pathname.split('/src/experiences/')[1]).href,context);}
 return next(specifier,context);
}});
const {readFileSync}=await import("node:fs");
const {stripTypeScriptTypes}=await import("node:module");
const {readVideoReferencePlan}=await import("../src/experiences/video-reference-plan.ts");
const {canonicalJson,digest,freeze}=await import("../src/experiences/compiler.ts");
const {buildExperiencePlan,registeredExperience,validateIntakeRequest,experienceResourceId,receiptPrefix}=await import("../src/experiences/intake.ts");
const {experienceSourceMatches}=await import("../src/experiences/host-source.ts");
const {createVideoOutputContract,parseVideoOutputContract}=await import("../src/model/output-video-contract.ts");
const {confirmOutputRequirementInterpretation}=await import("../src/model/output-requirements.ts");
const {compileOutputPlan}=await import("../src/model/output-plan.ts");
const {experienceOutputBinding}=await import("../worker/experience-output-binding.ts");
const {createExperienceOutputRecipe,matchExperienceOutputRecipeTarget}=await import("../worker/experience-output-recipe.ts");
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
const source = path => { const local=new URL("../"+path,import.meta.url);return readFileSync(existsSync(local)?local:C+"/"+path,"utf8"); };
function extracted(path, names, deps) {
  // Execute complete actual module logic, replacing import bindings only. Heavy
  // Worker readers receive finite ports; real pure compiler/profile helpers run.
  const body = source(path).replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, "");
  const js = stripTypeScriptTypes(body);
  return new Function(...Object.keys(deps), js + "\nreturn {" + names.join(",") + "};")(...Object.values(deps));
}
const {OutputConflictError}=await import('../worker/output-command-core.ts');
const creator = "video-owned-test";
const release = await registeredExperience("video");
const referenceSelection = { version: 1, sourceProjectId: "original-project", sourceDocumentId: "original-document",
  sourceBlockId: "original-block", referenceId: "original-reference", sha256: "f".repeat(64), permissionAttestation: "i-own-or-have-permission" };
const referencePlan = { version: 1, selection: referenceSelection, sourceDigest: "e".repeat(64), properties: {
  label: "Owned still", reference_id: referenceSelection.referenceId, source_content_hash: referenceSelection.sha256,
  media_url: "/api/media/u-766964656f2d6f776e65642d74657374/still.png", media_type: "image/png", rights_class: "owned", pixel_reference_mode: "inspiration", weight: 1,
} };
const request = { experienceId: "video", intentId: "00000000-0000-4000-8000-000000000020", releaseHash: release.releaseHash,
  values: { motion: { value: "A slow pan. 水\nKeep the subject still.", provenance: "authored" }, frame: { value: "portrait", provenance: "authored" } }, reference: referenceSelection };
const plan = await buildExperiencePlan(creator, request, release, referencePlan);
const binding = await experienceOutputBinding(plan);
const contract = createVideoOutputContract({ source: {draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
  requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash}, reference: referenceSelection, frameSize: "720x1280" });
const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
const recipe = createExperienceOutputRecipe({ output: "video", requirementId, deliverableId, contract });
const sourceDigest = "a".repeat(64), requirementsDigest = "b".repeat(64);
const compiled = compileOutputPlan([confirmOutputRequirementInterpretation(recipe.spec)],
  { document_id: plan.documentId, source_revision: sourceDigest, requirement_revision: requirementsDigest });
const receipt = { status: "complete", generation: "unavailable", projectId: plan.projectId, documentId: plan.documentId,
  draftId: plan.draftId, draftHash: plan.draftHash,
  appended: plan.events.map((event, i) => ({ eventId: "intake-event-" + i, sequence: i + 1, type: event.type, payload: structuredClone(event.payload) })) };
const originalEvents = receipt.appended.map(event => ({ ...event, streamId: plan.streamId, actor: "user" }));
const authoredBlocks = receipt.appended.filter(event => event.type === "BlockCreated").map(event => ({
  id: event.payload.block_id, projectId: plan.projectId, documentId: plan.documentId, scope: "document", canvasId: "",
  removed: false, locked: false, type: event.payload.type, handle: event.payload.handle, position: event.payload.position,
  properties: event.payload.properties, sourceEvents: [event.eventId],
}));
const outputBlock = { id: requirementId, type: "output", scope: "document", canvasId: "", projectId: plan.projectId,
  documentId: plan.documentId, removed: false, locked: false, handle: "video-output", position: "z",
  properties: { output_spec: recipe.spec }, sourceEvents: ["managed-output"] };
const outputEvent = { sequence: 100, eventId: "managed-output", actor: "user:" + creator, streamId: plan.streamId, clientId: "server:output-requirements", type: "BlockCreated",
  payload: { block_id: requirementId, type: "output", scope: "document", project_id: plan.projectId, document_id: plan.documentId,
    handle: outputBlock.handle, position: outputBlock.position, properties: outputBlock.properties } };

function fixture() {
  const reads = [], selects = [], principal = { userId: creator, streamId: plan.streamId, access: { capabilities: ["project.author"] }, consent: true };
  const input = { request: new Request("https://forma.test"), principal,
    env: { FORMA_IMAGE_PROVIDER: "fal", OPENAI_API_KEY: "synthetic-configured-no-network", FAL_KEY: "synthetic-configured-no-network", DB: {
      prepare(sql) { assert.match(sql, /^SELECT (?:1 AS current WHERE |CASE WHEN )/u); selects.push(sql);
        return { bind(...values) { selects.push(values); return { async first() { return input.current ? { current: 1 } : null; },async all(){return {success:true,results:[{current:input.current?1:0}]};} }; } }; },
      async batch(statements){return Promise.all(statements.map(s=>s.all()));},
    } }, current: true,
    scope: { kind: "personal", key: `personal:${creator}:${plan.projectId}`, actorUserId: creator, ownerUserId: creator, projectId: plan.projectId, documentId: plan.documentId,
      organizationId: null, projectAccessId: null, contextId: null },
    sourceDigest, requirementsDigest, ownerHead: 42, sourceAssertions: [{ sql: "source_head_current = ?", bindings: [42] }],
    sourceEvents: structuredClone([...originalEvents, outputEvent]),
    confirmedPlan: { revisionId: "confirmed-original", confirmedAt: new Date(Date.now() - 1000).toISOString(),
      plan: structuredClone(compiled), sourceDigest, requirementsDigest },
    target: structuredClone(compiled.targets[0]),
    context: { snapshot: { document: { title: plan.title }, facts: authoredBlocks.map(block => ({
      block_id: block.id, type: block.type, active: true, properties: block.properties,
    })) }, projection: { documentId: plan.documentId, documentTitle: plan.title, projectId: plan.projectId,
      documents: [{ id: plan.documentId, projectId: plan.projectId, title: plan.title, removed: false }],
      libraryBlocks: structuredClone([...authoredBlocks, outputBlock]), libraryBlockRelations: [] } },
  };
  const ports = {
    readExperienceDraft: async (_env, auth, draftId) => { reads.push("draft"); assert.equal(auth.principal, principal); assert.equal(draftId, plan.draftId);
      return input.missing ? null : { plan: input.retainedPlan ?? plan, content: { exact: "retained-source" }, expiresAt: new Date(Date.now() + 86400000).toISOString() }; },
    experienceDraftGuard: (_auth, actual) => { assert.equal(actual.draftId, plan.draftId); return input.draftGuard ?? { sql: "private_draft_current = ?", bindings: [plan.draftHash] }; },
    projectIntakeAuthority: (_env, auth) => { assert.equal(auth.principal, principal); return { sql: "actor_current = ?", bindings: [creator] }; },
    join: (...guards) => ({ sql: guards.map(g => "(" + g.sql + ")").join(" AND "), bindings: guards.flatMap(g => g.bindings) }),
    requireConsent: actor => { assert.equal(actor, principal); return actor.consent ? null : new Response(null, { status: 403 }); },
    commitAtomicIntake: async (_env, auth, actual, mode, options) => {
      reads.push("check"); assert.equal(auth.principal, principal); assert.equal(mode, "check");
      assert.deepEqual(actual.events, plan.events); assert.equal(options.receiptPrefix, receiptPrefix(plan.draftId));
      return Response.json(input.badReceipt ? { ...receipt, status: "unavailable" } : receipt);
    },
  };
  const fresh = extracted("worker/experience-video-output-source.ts", ["prepareExperienceVideoOutputSource"], {
    canonicalJson, buildExperiencePlan, validateIntakeRequest, readVideoReferencePlan, createVideoOutputContract, experienceOutputBinding, OutputConflictError,
    prepareExperienceVideoReference: async (request, env, auth, selection) => {
      reads.push("original-image"); assert.equal(request, input.request); assert.equal(env,input.env); assert.equal(auth.principal,principal); assert.deepEqual(selection, referenceSelection);
      if(input.imageUnavailable)throw new OutputConflictError("video_reference_source_unavailable");
      return { reference: input.freshReference ?? referencePlan, head:input.originalHead ?? 42, guard:input.originalGuard??{sql:"original_image_current = ?",bindings:[referenceSelection.sha256]} };
    },
  });
  const resolver = extracted("worker/output-video-source.ts", ["resolveOutputVideoSource", "outputVideoPreparationIdentity"], {
    canonicalJson, digest, freeze, buildExperiencePlan, experienceResourceId, receiptPrefix, validateIntakeRequest, experienceSourceMatches,
    createVideoOutputContract, parseVideoOutputContract, prepareExperienceVideoOutputSource: fresh.prepareExperienceVideoOutputSource, createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, OutputConflictError, ...ports,
  });
  return { input, reads, selects, principal, ports, ...fresh, ...resolver };
}
test("actual resolver reuses original private intake check, exact current source and immutable operation expiry", async () => {
  const f = fixture(), resolved = await f.resolveOutputVideoSource(f.input);
  assert.deepEqual(f.reads, ["draft", "original-image", "check"]); assert.deepEqual(resolved.plan, plan);
  assert.match(resolved.requestId, /^video-[a-f0-9]{64}$/u);
  assert.equal(resolved.expiresAt, new Date(Date.parse(f.input.confirmedPlan.confirmedAt) + 900000).toISOString());
  const repeated = await f.outputVideoPreparationIdentity(contract, f.input.confirmedPlan, f.input.target.id);
  assert.equal(repeated.requestId, resolved.requestId); assert.equal(repeated.expiresAt, resolved.expiresAt);
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("event_private_payloads") && g.sql.includes("redacted_at IS NULL")));
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("private_draft_current")));
});

test("actual resolver refuses foreign/consent/source/target/receipt changes rather than adopting nearby Video", async () => {
  const changes = [
    f => { f.input.scope.ownerUserId = "foreign"; }, f => { f.input.scope.contextId = "context"; },
    f => { f.input.principal.consent = false; }, f => { f.input.principal.projectExecution = {}; },
    f => { f.input.principal.access.capabilities = []; }, f => { f.input.missing = true; },
    f => { f.input.context.projection.libraryBlocks[0].properties = { text: "edited" }; },
    f => { f.input.context.projection.libraryBlocks.at(-1).sourceEvents = ["other-output"]; },
    f => { f.input.target.video_contract.source.requestHash = "sha256:" + "f".repeat(64); },
    f => { f.input.imageUnavailable = true; },
    f => { f.input.originalHead = 43; }, f => { delete f.input.ownerHead; },
    f => { f.input.freshReference = {...referencePlan, sourceDigest:"d".repeat(64)}; },
    f => { f.input.freshReference = {...referencePlan, properties:{...referencePlan.properties,label:"Changed"}}; },
    f => { f.input.retainedPlan = {...plan,request:{...request,reference:{...referenceSelection,referenceId:"nearby"}}}; },
    f => { f.input.confirmedPlan.confirmedAt = new Date(Date.now()+10000).toISOString(); },
    f => { f.input.confirmedPlan.confirmedAt = new Date(Date.now()-1000000).toISOString(); },
    f => { f.input.badReceipt = true; }, f => { f.input.sourceAssertions = []; },
    f => { f.input.sourceEvents.at(-1).actor = "user:foreign"; },
  ];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.resolveOutputVideoSource(f.input)); }
});

function oneFunction(path, start, end, deps) {
  const text=source(path), from=text.indexOf(start), to=text.indexOf(end,from+start.length);
  assert(from>=0&&to>from);return new Function(...Object.keys(deps),stripTypeScriptTypes(text.slice(from,to).replace(/^export /u,''))+'\nreturn '+start.match(/function (\w+)/u)[1]+';')(...Object.values(deps));
}

test('native load maps the retained Video plan and carries original-image guard to final disclosure',async()=>{
 const f=fixture(),trusted={...f.input,projection:f.input.context.projection,events:f.input.sourceEvents,sourceProblems:[]};
 const auth={user:f.principal,principal:f.principal,impersonation:null};
 const saved={receipt:{payload:outputEvent.payload,eventId:outputEvent.eventId},sequence:outputEvent.sequence};
 const error=(code,status=409)=>{throw new OutputConflictError(code,status);},record=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
 const validateManagedRequirement=oneFunction('worker/experience-output-api.ts','function validateManagedRequirement','\nasync function load',{record,canonicalJson,error});
 const load=oneFunction('worker/experience-output-api.ts','async function load','\nasync function confirmed',{
  authorizeExperienceIntake:async()=>auth,readExperienceDraft:f.ports.readExperienceDraft,experienceOutputBinding,experienceResourceId,
  prepareExperienceVideoOutputSource:f.prepareExperienceVideoOutputSource,createExperienceOutputRecipe,commitAtomicIntake:f.ports.commitAtomicIntake,
  receiptPrefix,experienceDraftGuard:f.ports.experienceDraftGuard,loadOutputTrustedContext:async()=>{ if(f.input.mutateAtDestinationRead)trusted.ownerHead++; return trusted; },
  readExperienceOutputLineage:async(_trusted,root)=>({binding:root,originals:{save:saved},witnesses:[saved],cycleCommandKeys:[]}),
  sceneRenewalIndexAssertion:()=>({sql:'cycle_index_current = ?',bindings:[1]}),outputCommandReceiptAssertion:()=>({sql:'managed_current = ?',bindings:[1]}),
  validateManagedRequirement,experienceSourceMatches,canonicalJson,record,error,
 });
 const loaded=await load(f.input.request,f.input.env,plan.draftId,'read');
 assert.equal(loaded.binding.output,'video');assert.deepEqual(loaded.recipe.spec,recipe.spec);assert.deepEqual(f.reads,['draft','original-image','check']);
 assert(trusted.sourceAssertions.some(g=>g.sql==='original_image_current = ?'));
 assert.equal(loaded.recipe.nativeReadiness,'eligible_for_existing_preflight');
 f.input.originalHead=41;await assert.rejects(load(f.input.request,f.input.env,plan.draftId,'read'),/output_video_source_changed/);f.input.originalHead=42;
 f.input.mutateAtDestinationRead=true;await assert.rejects(load(f.input.request,f.input.env,plan.draftId,'read'),/output_video_source_changed/);f.input.mutateAtDestinationRead=false;trusted.ownerHead=42;
 f.input.imageUnavailable=true;await assert.rejects(load(f.input.request,f.input.env,plan.draftId,'read'),/video_reference_source_unavailable/);
});

test('Video source preparation cannot offer authorization or accept a forged retained grant',async()=>{
 const f=fixture(),preflight={planRevisionId:f.input.confirmedPlan.revisionId,sourceDigest,requirementsDigest,
  expiresAt:new Date(Date.now()+60000).toISOString(),targets:[{targetId:recipe.targetId,available:true}]};
 const loaded={binding,recipe,trusted:{scope:f.input.scope,sourceDigest,requirementsDigest,env:{DB:{prepare(){return{bind(){return{first:async()=>null};}};}}}},
  originals:{preflight:{receipt:{payload:{preflight}},envelope:{planRevisionId:preflight.planRevisionId}}}};
 const state=oneFunction('worker/experience-output-api.ts','async function state','\nasync function execute',{
  confirmed:async()=>({...f.input.confirmedPlan,targetContractDigests:{[recipe.targetId]:'synthetic-target'}}),
  renewalOffer:async()=>null,
  readVideoExecutionOffer,record:v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)),canonicalJson,phases:['save','confirm','preflight','authorize','run'],
  error:code=>{throw new Error(code);},
 });
 await assert.rejects(state(loaded),/experience_video_preflight_unavailable/);
 preflight.targets[0].available=false;
 const value=await state(loaded);assert.equal(value.status,'unavailable');assert.equal(value.permitted.authorize,false);assert.equal(value.permitted.run,false);
 loaded.originals.authorize={receipt:{payload:{}},envelope:{}};await assert.rejects(state(loaded),/experience_output_original_authorization_unavailable/);
});

test('original receipt SQL rejects missing, redirected, redacted and altered private evidence',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE event_client_receipts(stream_id TEXT,client_event_id TEXT,event_id TEXT,sequence INTEGER); CREATE TABLE events(event_id TEXT,stream_id TEXT,sequence INTEGER,actor TEXT,type TEXT,compensates_event_id TEXT); CREATE TABLE event_private_payloads(private_event_id TEXT,owner_id TEXT,redacted_at TEXT,private_json TEXT);');
  for(const e of receipt.appended){
   db.prepare('INSERT INTO event_client_receipts VALUES(?,?,?,?)').run(plan.streamId,e.payload.client_event_id,e.eventId,e.sequence);
   db.prepare('INSERT INTO events VALUES(?,?,?,?,?,NULL)').run(e.eventId,plan.streamId,e.sequence,'user',e.type);
   db.prepare('INSERT INTO event_private_payloads VALUES(?,?,NULL,?)').run(e.eventId,creator,JSON.stringify(e.payload));
  }
  const f=fixture(),resolved=await f.resolveOutputVideoSource(f.input),guard=resolved.sourceAssertions.find(g=>g.sql.includes('event_private_payloads'));
  const current=()=>Boolean(db.prepare('SELECT 1 AS current WHERE '+guard.sql).get(...guard.bindings));assert.equal(current(),true);
  for(const sql of ["DELETE FROM event_client_receipts WHERE sequence=1","UPDATE event_client_receipts SET event_id='other' WHERE sequence=1","UPDATE events SET actor='foreign' WHERE sequence=1","UPDATE events SET compensates_event_id='other' WHERE sequence=1","UPDATE event_private_payloads SET redacted_at='now' WHERE private_event_id='intake-event-0'","UPDATE event_private_payloads SET private_json='{}' WHERE private_event_id='intake-event-0'","UPDATE event_private_payloads SET owner_id='foreign' WHERE private_event_id='intake-event-0'","INSERT INTO event_client_receipts SELECT stream_id,client_event_id,event_id,sequence FROM event_client_receipts LIMIT 1"]){
   db.exec('SAVEPOINT mutation');db.exec(sql);assert.equal(current(),false,sql);db.exec('ROLLBACK TO mutation; RELEASE mutation');assert.equal(current(),true);
  }
 }finally{db.close();}
});

test('saved default Landscape remains exact 480p intent without silently asserting authored framing',async()=>{
 const f=fixture(),defaultRequest={...request,values:{...request.values,frame:{value:'landscape',provenance:'default'}}};
 const defaultPlan=await buildExperiencePlan(creator,defaultRequest,release,referencePlan);
 const result=await f.prepareExperienceVideoOutputSource(f.input.request,f.input.env,{user:f.principal,principal:f.principal,impersonation:null},{plan:defaultPlan,content:JSON.stringify(defaultPlan),expiresAt:new Date(Date.now()+86400000).toISOString()});
 assert.equal(result.contract.frameSize,'1280x720');assert.equal(result.contract.resolution,'480p');
 assert.equal(defaultPlan.request.values.frame.provenance,'default');
});

test('original-image edit after resolution invalidates the final stream-head SQL without changing earlier private rows',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE events(stream_id TEXT,sequence INTEGER,payload TEXT);');
  db.prepare('INSERT INTO events VALUES(?,?,?)').run(plan.streamId,42,'original-image');
  const f=fixture(),resolved=await f.resolveOutputVideoSource(f.input),head=resolved.sourceAssertions.find(g=>g.sql.includes('MAX(sequence)'));
  assert(head);assert.deepEqual(head.bindings,[plan.streamId,42]);
  const current=()=>Boolean(db.prepare('SELECT 1 AS current WHERE '+head.sql).get(...head.bindings));
  assert.equal(current(),true);db.prepare('INSERT INTO events VALUES(?,?,?)').run(plan.streamId,43,'original-image-edited');
  assert.equal(db.prepare('SELECT payload FROM events WHERE sequence=42').get().payload,'original-image');assert.equal(current(),false);
 }finally{db.close();}
});

test('native bridge forwards captured owner head without manufacturing an epoch from filtered source events',()=>{
 const bridge=oneFunction('worker/output-requirements-api.ts','function bridgeTarget','\nasync function preflightPlan',{requireCurrentSource:trusted=>trusted.context});
 const f=fixture(),trusted={...f.input,events:f.input.sourceEvents,ownerHead:77};const value=bridge(trusted,f.input.confirmedPlan,f.input.target);
 assert.equal(value.ownerHead,77);assert.equal(value.sourceEvents,trusted.events);
});

const {outputSourceEpochAssertion}=await import('../worker/output-requirements-ledger.ts');
const {outputProofReadStatements,assertOutputProofRead}=await import('../worker/output-disclosure-proof.ts');
const {DatabaseSync}=await import('node:sqlite');
const {standingConstraints}=await import('../src/model/taste.ts');
const {documentRenderTokenReservation}=await import('../src/model/generation-budget.ts');
const {OUTPUT_VIDEO_EXECUTION_POLICY}=await import('../src/model/output-execution-policy.ts');
const {prepareVideoPlannerRequest}=await import('../worker/openai-adapter.ts');
const {outputVideoMediaPrice}=await import('../worker/output-video-execution.ts');
const {VIDEO_PLANNER_MODEL}=await import('../worker/output-video-planner.ts');
const {estimateOpenAITextCallMaximumMicrousd}=await import('../worker/openai-text-cost.ts');
const {readVideoExecutionOffer,VIDEO_READY_REASON,VIDEO_TRANSFER}=await import('../src/model/output-video-offer.ts');
function quoteFixture(){
 const f=fixture();return {...f,...extracted('worker/output-video-preflight.ts',['preflightOutputVideoTarget','outputVideoPreflightProof','requireOutputVideoOriginal','outputVideoExecutionSourceAssertions'],{
  canonicalJson,freeze,parseVideoOutputContract,standingConstraints,documentRenderTokenReservation,OUTPUT_VIDEO_EXECUTION_POLICY,
  prepareVideoPlannerRequest,outputVideoMediaPrice,VIDEO_PLANNER_MODEL,estimateOpenAITextCallMaximumMicrousd,resolveOutputVideoSource:f.resolveOutputVideoSource,
  readVideoExecutionOffer,VIDEO_READY_REASON,VIDEO_TRANSFER,OutputConflictError,outputSourceEpochAssertion,outputProofReadStatements,assertOutputProofRead,
 })};
}
test('exact read-only Video quote combines original custody, real compiler bytes and480p media price without private writes',async()=>{
 const f=quoteFixture(),quote=await f.preflightOutputVideoTarget(f.input),offer=readVideoExecutionOffer(quote);
 assert.ok(quote.available);assert.ok(offer);assert.deepEqual(quote.settings.executionPolicy,{maximumMilliseconds:900000,heartbeatMilliseconds:60000,maximumRenewals:14});assert.equal(quote.maximumCalls,2);assert.equal(quote.maximumTokens,documentRenderTokenReservation('video',1,1));
 assert.deepEqual(offer.calls.map(c=>c.stage),['planning:0:initial','video:initial']);assert.equal(offer.calls[1].maximumMicrousd,outputVideoMediaPrice().maximumMicrousd);assert.equal(quote.maximumMicrousd,offer.calls.reduce((sum,c)=>sum+c.maximumMicrousd,0));
 assert.equal(offer.payload.videoResolution,'480p');assert.equal(offer.payload.videoSeconds,4);assert.equal(offer.payload.videoAudioMode,'silent');assert.equal(offer.original.draftId,plan.draftId);
 assert.ok(f.selects.length);const proof=f.outputVideoPreflightProof(quote);assert.ok(proof.sourceAssertions.length);assert.equal(proof.requestId,offer.original.requestId);assert.equal(f.outputVideoPreflightProof(structuredClone(quote)),null);
 const repeated=await f.preflightOutputVideoTarget(f.input);assert.deepEqual(repeated,quote);assert.equal(f.outputVideoPreflightProof(repeated).expiresAt,proof.expiresAt);
});
test('Video quote rechecks source and expiry, and unconfigured or malformed routes authorize zero calls',async()=>{
 const absent=quoteFixture();absent.input.env.OPENAI_API_KEY='';const refused=await absent.preflightOutputVideoTarget(absent.input);assert.equal(refused.maximumCalls,0);assert.deepEqual(absent.reads,[]);
 for(const modify of [f=>{f.input.target.quantity.value=2;},f=>{delete f.input.target.content_quantity;},f=>{f.input.target.audio_contract=undefined;}]){const f=quoteFixture();modify(f);const result=await f.preflightOutputVideoTarget(f.input);assert.equal(result.available,false);assert.equal(result.maximumMicrousd,0);assert.equal(f.outputVideoPreflightProof(result),null);}
 const stale=quoteFixture();stale.input.current=false;const result=await stale.preflightOutputVideoTarget(stale.input);assert.equal(result.available,false);assert.equal(result.reasonCode,'output_video_source_changed');
 const head=quoteFixture();head.input.originalHead=43;await assert.rejects(head.preflightOutputVideoTarget(head.input),/source_changed/);
});
test('Video offer parsing rejects drift rather than turning a changed quote into authority',async()=>{
 const f=quoteFixture(),quote=await f.preflightOutputVideoTarget(f.input);
 for(const change of [q=>{q.settings.executionPolicy={maximumMilliseconds:240000,heartbeatMilliseconds:60000,maximumRenewals:3};},q=>{q.maximumCalls=3;},q=>{q.maximumMicrousd++;},q=>{q.settings.payload.videoResolution='720p';},q=>{q.settings.payload.videoSeconds=5;},q=>{q.settings.calls[1].maximumMicrousd++;},q=>{q.settings.original.requestId='other';},q=>{q.settings.videoPricingVersion='future';},q=>{q.settings.approved=true;}]){const changed=structuredClone(quote);change(changed);assert.equal(readVideoExecutionOffer(changed),null);}
 let reads=0;const getter={...quote};Object.defineProperty(getter,'settings',{enumerable:true,get(){reads++;throw Error('getter');}});assert.equal(readVideoExecutionOffer(getter),null);assert.equal(reads,0);
});


test('Video original admission binds the actual quote proof to the first job, scope, source and immutable expiry',async()=>{
 const f=quoteFixture(),quote=await f.preflightOutputVideoTarget(f.input),proof=f.outputVideoPreflightProof(quote);
 const attempt={attemptOrdinal:0,previousSlotId:null,jobId:proof.requestId};
 const admitted=f.requireOutputVideoOriginal(f.input,quote,attempt);assert.equal(admitted.proof,proof);assert.equal(admitted.offer.original.requestId,attempt.jobId);
 assert.throws(()=>f.requireOutputVideoOriginal(f.input,structuredClone(quote),attempt),/original_attempt_required/);
 for(const delta of [{attemptOrdinal:1},{attemptOrdinal:-1},{previousSlotId:'old-slot'},{previousSlotId:undefined},{jobId:'different-job'}]){
  assert.throws(()=>f.requireOutputVideoOriginal(f.input,quote,{...attempt,...delta}),/original_attempt_required/);
 }
 for(const delta of [{kind:'project'},{contextId:'other-context'},{actorUserId:'other'},{ownerUserId:'other'},{projectId:'other'},{documentId:'other'}]){
  assert.throws(()=>f.requireOutputVideoOriginal({...f.input,scope:{...f.input.scope,...delta}},quote,attempt),/original_attempt_required/);
 }
 for(const key of ['sourceDigest','requirementsDigest'])assert.throws(()=>f.requireOutputVideoOriginal({...f.input,[key]:'0'.repeat(64)},quote,attempt),/original_attempt_required/);
 assert.throws(()=>f.requireOutputVideoOriginal({...f.input,target:{...f.input.target,id:'other'}},quote,attempt),/original_attempt_required/);
 const clock=Date.now;try{Date.now=()=>Date.parse(proof.expiresAt);assert.throws(()=>f.requireOutputVideoOriginal(f.input,quote,attempt),/original_attempt_required/);}finally{Date.now=clock;}
});

test('Video execution keeps original still guards while only same-source job events may advance the owner head',async()=>{
 const f=quoteFixture(),quote=await f.preflightOutputVideoTarget(f.input),proof=f.outputVideoPreflightProof(quote),attempt={attemptOrdinal:0,previousSlotId:null,jobId:proof.requestId};
 const assertions=f.outputVideoExecutionSourceAssertions(f.input,quote,attempt),original=proof.sourceAssertions;
 const retained=original.filter(a=>a.sql!=="COALESCE((SELECT MAX(sequence) FROM events WHERE stream_id=?),0)=?");
 for(const guard of retained)assert.ok(assertions.includes(guard),'Original private, source, rights and expiry guard retained by identity');
 const epoch=assertions.find(a=>!original.includes(a));assert.ok(epoch);assert.equal(assertions.length,original.length);
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE events(stream_id TEXT,sequence INTEGER,type TEXT,actor TEXT,correlation_id TEXT);CREATE TABLE output_operation_slots(scope_key TEXT,source_digest TEXT,job_id TEXT);CREATE TABLE document_jobs(job_id TEXT,correlation_id TEXT);');
  db.prepare('INSERT INTO output_operation_slots VALUES(?,?,?)').run(f.input.scope.key,f.input.sourceDigest,attempt.jobId);db.prepare('INSERT INTO document_jobs VALUES(?,?)').run(attempt.jobId,'original-correlation');
  const inspect=()=>Boolean(db.prepare('SELECT 1 AS current WHERE '+epoch.sql).get(...epoch.bindings));assert.equal(inspect(),true);
  const append=(type,correlation='original-correlation',actor='worker:renderer')=>db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run('creative:'+f.input.scope.ownerUserId,f.input.ownerHead+1,type,actor,correlation);
  for(const type of ['DocumentOpened','DocumentRenderRequested','DocumentRenderCompleted','BudgetReserved']){append(type);assert.equal(inspect(),true);db.exec('DELETE FROM events');}
  for(const args of [['BlockUpdated'],['ReferencePermissionsUpdated'],['DocumentRenderRequested','foreign-correlation'],['ModelRegistered','original-correlation','worker:other']]){append(...args);assert.equal(inspect(),false);db.exec('DELETE FROM events');}
  append('DocumentRenderRequested');db.prepare('UPDATE output_operation_slots SET source_digest=?').run('changed-source');assert.equal(inspect(),false);
 }finally{db.close();}
 for(const head of [undefined,-1,f.input.ownerHead+1])assert.throws(()=>f.outputVideoExecutionSourceAssertions({...f.input,ownerHead:head},quote,attempt),/source_epoch_required/);
});

test('native Video receipt records the exact two-call cap without paid repair or changing legacy Video accounting',async()=>{
 const {VIDEO_ADAPTER_CONTRACT}=await import('../src/model/video-adapter.ts');let privateReceipt;
 const receipt=oneFunction('worker/document-jobs-api.ts','async function acceptedGenerationReceipt','\nfunction parentJobIdFromRequest',{
  VIDEO_ADAPTER_CONTRACT,sceneConfigurationFromRequest:()=>null,readOutputAudioPayload:()=>null,sourceSnapshotSha256:digest,
  captureDocumentRenderSettings:payload=>({artifact_kind:payload.artifactKind,videoResolution:payload.videoResolution}),
  storePrivateContent:async(_env,owner,kind,raw)=>{privateReceipt=JSON.parse(raw);assert.equal(owner,'owner');assert.equal(kind,'document-artifact-input');return{contentId:'private-input',expiresAt:new Date(Date.now()+86400000).toISOString()};},
 });
 const f=quoteFixture(),offer=readVideoExecutionOffer(await f.preflightOutputVideoTarget(f.input));
 const make=(native,extra={})=>receipt({OPENAI_MODEL:'gpt-5.6-terra'},{userId:'owner'}, {...offer.payload,...extra,snapshot:{facts:[]}},'same-document','original-video',offer.maximumMicrousd,null,undefined,undefined,undefined,undefined,undefined,false,native);
 const result=await make(true);
 for(const view of [result,result.settings,privateReceipt.request]){assert.equal(view.planned_provider_call_count,2);assert.equal(view.maximum_provider_call_count,2);assert.equal(view.max_repair_call_count,0);assert.equal(view.reservation_microusd,offer.maximumMicrousd);}
 assert.equal(result.provider,'fal');assert.equal(result.model,VIDEO_ADAPTER_CONTRACT.model);assert.equal(privateReceipt.planner.model,'gpt-5.6-terra');
 assert.equal(result.settings.video_resolution,'480p');assert.equal(result.reservation_is_application_hard_cap,true);assert.equal(result.reservation_is_provider_hard_cap,false);
 assert.equal(result.settled_cost_microusd,0);assert.equal(result.actual_provider_call_count,null);assert.equal(result.source_transmission_status,'not_transmitted');assert.equal(result.provider_request_status,'not_submitted');
 const legacy=await make(false,{nativeVideoReceipt:true});assert.equal(legacy.planned_provider_call_count,1);assert.equal(legacy.max_repair_call_count,1);assert.equal(legacy.reservation_is_application_hard_cap,false);assert.equal(legacy.provider,'openai');
});

test('actual authorization handoff carries the captured owner head into fresh Video admission',async()=>{
 const f=quoteFixture(),preflight=await f.preflightOutputVideoTarget(f.input),proof=f.outputVideoPreflightProof(preflight);
 const statement=source('worker/output-requirements-api.ts').match(/const prepared = (await bridge\.prepareAdmission\([^\n]+\));/u);assert(statement,'actual native admission handoff');
 const trusted={...f.input,events:f.input.sourceEvents,ownerHead:f.input.ownerHead},slots=[{targetId:f.input.target.id,jobId:proof.requestId,attemptOrdinal:0,previousSlotId:null}];
 const ports={trusted,body:{},plan:f.input.confirmedPlan,context:f.input.context,grantId:'grant',preflight:{targets:[preflight]},slots,sceneTargets:[],audioTargets:[],model3dTargets:[],sponsorAdmission:undefined,bridge:{prepareAdmission:async input=>input}};
 const forward=new Function(...Object.keys(ports),stripTypeScriptTypes('async function handoff(){return '+statement[1]+';}')+';return handoff();');
 const admitted=await forward(...Object.values(ports));assert.equal(admitted.ownerHead,trusted.ownerHead);assert.equal(admitted.sourceEvents,trusted.events);
 assert.equal(Object.hasOwn(admitted,'sponsorAdmission'),false,'ordinary Video admission carries no sponsor authority');
 const current=await f.preflightOutputVideoTarget({...f.input,...admitted,target:f.input.target});assert.equal(current.available,true);
 assert.equal(f.requireOutputVideoOriginal({...f.input,...admitted,target:f.input.target},current,slots[0]).proof.requestId,proof.requestId);
});

test('actual Video preflight batches the102-binding source shape and checks every result plus expiry',async()=>{
 for(const failure of ['none','middle','truncated','expiry']){
  const f=quoteFixture(),guard=count=>({sql:Array.from({length:count},()=>'?').join(' AND '),bindings:Array(count).fill(1)});
  // Match the real caller51 + joined draft23 + original17 + receipt8 + head2
  // + expiry1 shape. Source/auth and DB rows remain explicit fixture ports;
  // the actual preflight, proof builder, size limit and result checker execute.
  f.input.sourceAssertions=[guard(51)];f.input.draftGuard=guard(22);f.input.originalGuard=guard(17);
  const bindings=[];f.input.env.DB.prepare=sql=>({bind(...values){assert(values.length<=100,'D1 per-statement binding maximum');bindings.push(values.length);return{sql,values};}});
  let batchCount=0;const now=Date.now;
  f.input.env.DB.batch=async statements=>{batchCount++;assert.equal(statements.length,6);const results=statements.map(()=>({success:true,results:[{current:1}]}));
   if(failure==='middle')results[2].results[0].current=0;if(failure==='truncated')results.pop();if(failure==='expiry')Date.now=()=>now()+900001;return results;};
  try{const value=await f.preflightOutputVideoTarget(f.input);assert.equal(value.available,failure==='none');assert.equal(batchCount,1);assert.equal(bindings.reduce((a,b)=>a+b,0),102);assert.equal(Math.max(...bindings),51);}
  finally{Date.now=now;}
 }
});
