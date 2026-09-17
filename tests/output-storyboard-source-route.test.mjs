import assert from 'node:assert/strict';
import test from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const {registerOutputSourceImports}=await import(C+'/tests/output-execution-test-helpers.mjs');registerOutputSourceImports();
registerHooks({resolve(specifier,context,next){
 if(!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.includes(':'))return next(specifier,{...context,parentURL:new URL('file://'+C+'/worker/openai-adapter.ts').href});
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){const normal=new URL(/\.[a-z0-9]+$/iu.test(specifier)?specifier:specifier+'.ts',context.parentURL);if(!existsSync(normal)&&normal.pathname.includes('/src/experiences/'))return next(new URL('file://'+C+'/src/experiences/'+normal.pathname.split('/src/experiences/')[1]).href,context);}
 return next(specifier,context);
}});
const {readFileSync}=await import("node:fs");
const {stripTypeScriptTypes}=await import("node:module");
const {canonicalJson,digest,freeze}=await import("../src/experiences/compiler.ts");
const {buildExperiencePlan,registeredExperience,validateIntakeRequest,experienceResourceId,receiptPrefix}=await import("../src/experiences/intake.ts");
const {experienceSourceMatches}=await import("../src/experiences/host-source.ts");
const {createStoryboardOutputContract,parseStoryboardOutputContract}=await import("../src/model/output-storyboard-contract.ts");
const {confirmOutputRequirementInterpretation}=await import("../src/model/output-requirements.ts");
const {compileOutputPlan}=await import("../src/model/output-plan.ts");
const {experienceOutputBinding}=await import("../worker/experience-output-binding.ts");
const {createExperienceOutputRecipe,matchExperienceOutputRecipeTarget}=await import("../worker/experience-output-recipe.ts");
const {standingConstraints}=await import("../src/model/taste.ts");
const {documentRenderTokenReservation}=await import("../src/model/generation-budget.ts");
const {OUTPUT_NATIVE_EXECUTION_POLICY}=await import("../src/model/output-execution-policy.ts");
const {createOutputFalImageContract,OUTPUT_FAL_PLANNING_MODEL}=await import("../worker/output-fal-image-contract.ts");
const {selectImageAdapter}=await import("../worker/image-adapter-selection.ts");
const {prepareStoryboardPlannerRequest}=await import("../worker/openai-adapter.ts");
const {estimateOpenAITextCallMaximumMicrousd}=await import("../worker/openai-text-cost.ts");
const {outputProofReadStatements}=await import("../worker/output-disclosure-proof.ts");
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=originalFetch;});
const source = path => { const local=new URL("../"+path,import.meta.url);return readFileSync(existsSync(local)?local:C+"/"+path,"utf8"); };
const {readStoryboardExecutionOffer,STORYBOARD_READY_REASON,STORYBOARD_TRANSFER}=await import("../src/model/output-storyboard-offer.ts");
function extracted(path, names, deps) {
  // Execute complete actual module logic, replacing import bindings only. Heavy
  // Worker readers receive finite ports; real pure compiler/profile helpers run.
  const body = source(path).replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, "");
  const js = stripTypeScriptTypes(body);
  return new Function(...Object.keys(deps), js + "\nreturn {" + names.join(",") + "};")(...Object.values(deps));
}
class OutputConflictError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }
const creator = "storyboard-owned-test";
const release = await registeredExperience("storyboard");
const request = { experienceId: "storyboard", intentId: "00000000-0000-4000-8000-000000000020", releaseHash: release.releaseHash,
  values: { story: { value: "A keeper brings a lantern home through the harbor. 水", provenance: "authored" },
    composition: { value: "Charcoal outlines; preserve the keeper and lantern.", provenance: "authored" } } };
const plan = await buildExperiencePlan(creator, request, release);
const binding = await experienceOutputBinding(plan);
const contract = createStoryboardOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
  requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash });
const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
const recipe = createExperienceOutputRecipe({ output: "storyboard", requirementId, deliverableId, contract });
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
  documentId: plan.documentId, removed: false, locked: false, handle: "storyboard-output", position: "z",
  properties: { output_spec: recipe.spec }, sourceEvents: ["managed-output"] };
const outputEvent = { eventId: "managed-output", actor: "user:" + creator, streamId: plan.streamId, clientId: "server:output-requirements", type: "BlockCreated",
  payload: { block_id: requirementId, type: "output", scope: "document", project_id: plan.projectId, document_id: plan.documentId,
    handle: outputBlock.handle, position: outputBlock.position, properties: outputBlock.properties } };

function fixture() {
  const reads = [], selects = [], principal = { userId: creator, streamId: plan.streamId, access: { capabilities: ["project.author"] }, consent: true };
  const input = { request: new Request("https://forma.test"), principal,
    env: { FORMA_IMAGE_PROVIDER: "fal", OPENAI_API_KEY: "synthetic-configured-no-network", FAL_KEY: "synthetic-configured-no-network", DB: {
      prepare(sql) { assert.match(sql, /^SELECT (?:1 AS current WHERE |CASE WHEN )/u); selects.push(sql);
        return { bind(...values) { assert.ok(values.length<=100);selects.push(values); return {
          async first() { return input.current ? { current: 1 } : null; },
          async all() { return {success:true,results:input.current?[{current:1}]:[]}; },
        }; } }; },
      async batch(statements){return Promise.all(statements.map(statement=>statement.all()));},
    } }, current: true,
    scope: { kind: "personal", actorUserId: creator, ownerUserId: creator, projectId: plan.projectId, documentId: plan.documentId,
      organizationId: null, projectAccessId: null, contextId: null },
    sourceDigest, requirementsDigest, sourceAssertions: [{ sql: "source_head_current = ?", bindings: [42] }],
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
    experienceDraftGuard: (_auth, actual) => { assert.equal(actual.draftId, plan.draftId); return { sql: "private_draft_current = ?", bindings: [plan.draftHash] }; },
    projectIntakeAuthority: (_env, auth) => { assert.equal(auth.principal, principal); return { sql: "actor_current = ?", bindings: [creator] }; },
    join: (...guards) => ({ sql: guards.map(g => "(" + g.sql + ")").join(" AND "), bindings: guards.flatMap(g => g.bindings) }),
    requireConsent: actor => { assert.equal(actor, principal); return actor.consent ? null : new Response(null, { status: 403 }); },
    commitAtomicIntake: async (_env, auth, actual, mode, options) => {
      reads.push("check"); assert.equal(auth.principal, principal); assert.equal(mode, "check");
      assert.deepEqual(actual.events, plan.events); assert.equal(options.receiptPrefix, receiptPrefix(plan.draftId));
      return Response.json(input.badReceipt ? { ...receipt, status: "unavailable" } : receipt);
    },
  };
  const resolver = extracted("worker/output-storyboard-source.ts", ["resolveOutputStoryboardSource", "outputStoryboardPreparationIdentity"], {
    canonicalJson, digest, freeze, buildExperiencePlan, experienceResourceId, receiptPrefix, validateIntakeRequest, experienceSourceMatches,
    createStoryboardOutputContract, parseStoryboardOutputContract, experienceOutputBinding, createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, OutputConflictError, ...ports,
  });
  const preflight = extracted("worker/output-storyboard-preflight.ts", ["preflightOutputStoryboardTarget", "outputStoryboardPreflightProof"], {
    freeze, parseStoryboardOutputContract, standingConstraints, documentRenderTokenReservation, OUTPUT_NATIVE_EXECUTION_POLICY,
    createOutputFalImageContract, OUTPUT_FAL_PLANNING_MODEL, selectImageAdapter, prepareStoryboardPlannerRequest,
    estimateOpenAITextCallMaximumMicrousd, resolveOutputStoryboardSource: resolver.resolveOutputStoryboardSource,
    readStoryboardExecutionOffer,STORYBOARD_READY_REASON,STORYBOARD_TRANSFER,outputProofReadStatements,
  });
  return { input, reads, selects, ...resolver, ...preflight };
}
test("actual resolver reuses original private intake check, exact current source and immutable operation expiry", async () => {
  const f = fixture(), resolved = await f.resolveOutputStoryboardSource(f.input);
  assert.deepEqual(f.reads, ["draft", "check"]); assert.deepEqual(resolved.plan, plan);
  assert.match(resolved.requestId, /^storyboard-[a-f0-9]{64}$/u);
  assert.equal(resolved.expiresAt, new Date(Date.parse(f.input.confirmedPlan.confirmedAt) + 900000).toISOString());
  const repeated = await f.outputStoryboardPreparationIdentity(contract, f.input.confirmedPlan, f.input.target.id);
  assert.equal(repeated.requestId, resolved.requestId); assert.equal(repeated.expiresAt, resolved.expiresAt);
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("event_private_payloads") && g.sql.includes("redacted_at IS NULL")));
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("private_draft_current")));
});

test("actual resolver refuses foreign/consent/source/target/receipt changes rather than adopting nearby Storyboard", async () => {
  const changes = [
    f => { f.input.scope.ownerUserId = "foreign"; }, f => { f.input.scope.contextId = "context"; },
    f => { f.input.principal.consent = false; }, f => { f.input.principal.projectExecution = {}; },
    f => { f.input.principal.access.capabilities = []; }, f => { f.input.missing = true; },
    f => { f.input.context.projection.libraryBlocks[0].properties = { text: "edited" }; },
    f => { f.input.context.projection.libraryBlocks.at(-1).sourceEvents = ["other-output"]; },
    f => { f.input.target.storyboard_contract.source.requestHash = "sha256:" + "f".repeat(64); },
    f => { f.input.badReceipt = true; }, f => { f.input.sourceAssertions = []; },
    f => { f.input.sourceEvents.at(-1).actor = "user:foreign"; },
  ];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.resolveOutputStoryboardSource(f.input)); }
});

test("actual Storyboard preflight uses exact offline planner request and five bounded stages, with no execution authority",async()=>{
 const f=fixture(),result=await f.preflightOutputStoryboardTarget(f.input);
 assert.equal(result.available,true);assert.equal(result.maximumCalls,5);assert.equal(result.settings.executionAvailable,true);assert.equal(result.settings.preparationOnly,false);
 assert.match(result.transferDescription,/Before each of the four images.*OpenAI \(omni-moderation-latest\)/u);
 assert.match(result.transferDescription,/up to four safety checks are separate from the five paid generation stages/u);
 const mixed=fixture();mixed.input.target.video_contract={};assert.equal((await mixed.preflightOutputStoryboardTarget(mixed.input)).reasonCode,'output_storyboard_contract_unsupported');
 assert.deepEqual(result.settings.calls.map(c=>c.stage),['planning:0:initial','image:frame:1','image:frame:2','image:frame:3','image:frame:4']);
 assert.equal(result.maximumMicrousd,result.settings.calls.reduce((n,c)=>n+c.maximumMicrousd,0));
 assert.equal(result.settings.payload.outputStoryboard.frameCount,4);assert.equal(result.settings.payload.itemCount,4);
 assert.match(result.settings.payload.outputStoryboardPlanner.requestDigest,/^[a-f0-9]{64}$/);
 const proof=f.outputStoryboardPreflightProof(result);assert(proof.sourceAssertions.length);assert.equal(proof.expiresAt,new Date(Date.parse(f.input.confirmedPlan.confirmedAt)+900000).toISOString());
 assert.equal(f.outputStoryboardPreflightProof(structuredClone(result)),null);
 for(const [change,code] of [[f=>f.input.env.FAL_KEY='', 'output_storyboard_provider_unavailable'],[f=>f.input.current=false,'output_storyboard_source_changed'],[f=>f.input.target.storyboard_contract.frameCount=3,'output_storyboard_contract_unsupported'],[f=>f.input.confirmedPlan.confirmedAt=new Date(Date.now()-1000000).toISOString(),'output_storyboard_original_expired']]){const g=fixture();change(g);const value=await g.preflightOutputStoryboardTarget(g.input);assert.equal(value.available,false);assert.equal(value.reasonCode,code);}
});
function oneFunction(path, start, end, deps) {
  const text = source(path), from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Exact function boundary");
  return new Function(...Object.keys(deps), stripTypeScriptTypes(text.slice(from, to).replace(/^export /u, "")) + "\nreturn " + start.match(/function (\w+)/u)[1] + ";")(...Object.values(deps));
}
test("actual native router reaches the source-bound Storyboard preparer, never a fallback media route", async () => {
  const f = fixture();
  const route = oneFunction("worker/output-document-execution.ts", "export async function preflightOutputNativeTarget", "\n/** The reviewed target", {
    preflightOutputStoryboardTarget: f.preflightOutputStoryboardTarget, preflightOutputAudioTarget:()=>assert.fail("Audio fallback"),
    preflightOutputSceneTarget: () => assert.fail("Scene fallback"), preflightOutputNarrativeTarget: () => assert.fail("Story fallback"),
    outputNativeTargetRefusal: () => assert.fail("3D fallback"), preflightOutputModel3dTarget: () => assert.fail("3D fallback"),
    preflightOutputImageSlidesTarget: () => assert.fail("Image/Slides fallback"),
  });
  const result = await route(f.input); assert.equal(result.available, true); assert.equal(result.settings.executionAvailable, true);
});
test("actual preflight command finalization preserves original deadline and transactional custody without allocating work", async () => {
  const f = fixture(), trusted = { ...f.input, sourceAssertions: [...f.input.sourceAssertions] };
  f.input.confirmedPlan.targetContractDigests = { [f.input.target.id]: (await digest(f.input.target)).slice(7) };
  let persisted;
  // Finite read/commit ports only; this exercises real preflightPlan finalization,
  // not actual SQLite or a claimed committed financial/native operation.
  trusted.env = { ...f.input.env, DB: { prepare(sql) { assert.match(sql, /^SELECT slot\./u); return { bind() { return { all: async () => ({ results: [] }) }; } }; } } };
  const preflight = oneFunction("worker/output-requirements-api.ts", "async function preflightPlan", "\nfunction outputProviderStages", {
    requireCurrentSource: () => f.input.context, currentPlan: (_t, p) => p, readConfirmedPlan: async () => f.input.confirmedPlan,
    identifier: v => v, OUTPUT_PREFLIGHT_TARGET_MAX_COUNT: 32, fail: code => { throw new Error(code); },
    bridgeTarget: () => f.input, outputStoryboardPreflightProof: f.outputStoryboardPreflightProof,
    outputProviderStages: value => { assert.equal(value.maximumCalls, value.settings.calls.length); },
    nowIso: () => new Date().toISOString(), uuidV7: () => "new-preflight-only", outputDigest: digest,
    commandWrite: t => ({ assertions: t.sourceAssertions }),
    commitOutputCommand: async (_env, options) => { persisted = options; return options.events[0].payload.preflight; },
  });
  const result = await preflight(trusted, { planRevisionId: "confirmed-original" }, "synthetic-command-digest", { preflight: f.preflightOutputStoryboardTarget });
  assert.equal(result.expiresAt, new Date(Date.parse(f.input.confirmedPlan.confirmedAt) + 900000).toISOString());
  assert.equal(result.operationAttempts[f.input.target.id].ordinal, 0); assert.equal(result.operationAttempts[f.input.target.id].previousSlotId, null);
  assert.ok(persisted.assertions.some(value => value.sql.includes("event_private_payloads")));
  assert.ok(persisted.assertions.some(value => value.deadlineMs === Date.parse(result.expiresAt)));
  assert.equal(persisted.events.length, 1); assert.equal(persisted.events[0].type, "OutputPlanPreflighted");
  const offered = await f.preflightOutputStoryboardTarget(f.input);
  await assert.rejects(preflight(trusted, { planRevisionId: "confirmed-original" }, "synthetic-command-digest", { preflight: async () => structuredClone(offered) }), /output_storyboard_original_unavailable/u);
});

test("actual native state offers authorization only for the exact current Storyboard quote", async () => {
  const f = fixture(), prepared = await f.preflightOutputStoryboardTarget(f.input);
  const preflight = { planRevisionId: "confirmed-original", sourceDigest, requirementsDigest, targets: [prepared],
    expiresAt: new Date(Date.now() + 60000).toISOString() };
  const loaded = { binding, recipe, trusted: { scope: f.input.scope, sourceDigest, requirementsDigest,
    env: { DB: { prepare(sql) { assert.match(sql, /^SELECT 1 AS present FROM output_operation_slots/u);
      return { bind() { return { first: async () => null }; } }; } } } },
    originals: { preflight: { receipt: { payload: { preflight } }, envelope: { planRevisionId: "confirmed-original" } } } };
  const state = oneFunction("worker/experience-output-api.ts", "async function state", "\nasync function execute", {
    confirmed: async () => ({ ...f.input.confirmedPlan, targetContractDigests: { [recipe.targetId]: "synthetic-target-digest" } }),
    record: value => Boolean(value && typeof value === "object" && !Array.isArray(value)), canonicalJson,
    phases: ["save", "confirm", "preflight", "authorize", "run"],
    error: code => { throw new Error(code); },
    readStoryboardExecutionOffer,
  });
  let value = await state(loaded); assert.equal(value.status, "review");
  assert.deepEqual(value.permitted, { prepare: false, authorize: true, run: false, resumeRun: false });
  preflight.targets = [{ ...prepared, available: false, reasonCode: "output_storyboard_provider_unavailable" }];
  value = await state(loaded); assert.equal(value.status, "unavailable"); assert.equal(value.permitted.authorize, false);
  preflight.targets = [prepared]; preflight.expiresAt = new Date(Date.now() - 1).toISOString();
  value = await state(loaded); assert.equal(value.status, "unavailable");
  loaded.originals.authorize = {receipt:{payload:{}},envelope:{}}; await assert.rejects(state(loaded), /experience_output_original_authorization_unavailable/u);
});
export {fixture,oneFunction,canonicalJson,digest};
