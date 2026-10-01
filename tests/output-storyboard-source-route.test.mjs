import assert from 'node:assert/strict';
import test from 'node:test';
import helpers from './output-storyboard-source-fixture.mjs';
const { fixture, plan, contract, oneFunction, digest, sourceDigest, requirementsDigest, binding, recipe, canonicalJson, readStoryboardExecutionOffer } = helpers;

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
    record: value => value && typeof value === "object" && !Array.isArray(value) ? value : {},
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
    renewalOffer: oneFunction("worker/experience-output-api.ts", "async function renewalOffer", "\nasync function replacementOffer", {
      scenePreparationPredecessor: oneFunction("worker/experience-output-originals.ts", "export function scenePreparationPredecessor", "\nexport type ExperienceOutputLineage", {
        record: value => Boolean(value && typeof value === "object" && !Array.isArray(value)),
        error: code => { throw Error(code); },
      }),
    }),
  });
  let value = await state(loaded); assert.equal(value.status, "review");
  assert.deepEqual(value.permitted, { prepare: false, authorize: true, run: false, resumeRun: false });
  preflight.targets = [{ ...prepared, available: false, reasonCode: "output_storyboard_provider_unavailable" }];
  value = await state(loaded); assert.equal(value.status, "unavailable"); assert.equal(value.permitted.authorize, false);
  preflight.targets = [prepared]; preflight.expiresAt = new Date(Date.now() - 1).toISOString();
  value = await state(loaded); assert.equal(value.status, "unavailable");
  loaded.originals.authorize = {receipt:{payload:{}},envelope:{}}; await assert.rejects(state(loaded), /experience_output_original_authorization_unavailable/u);
});
