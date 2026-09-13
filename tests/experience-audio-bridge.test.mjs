import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { canonicalJson, digest, freeze } from "../src/experiences/compiler.ts";
import { EXPERIENCE_AUDIO_INTENT } from "../src/experiences/contracts.ts";
import { buildExperiencePlan, registeredExperience, validateIntakeRequest, experienceResourceId, receiptPrefix } from "../src/experiences/intake.ts";
import { experienceSourceMatches } from "../src/experiences/host-source.ts";
import { createAudioOutputContract, parseAudioOutputContract, AUDIO_OUTPUT_POLICY } from "../src/model/output-audio-contract.ts";
import { inspectOutputRequirement, confirmOutputRequirementInterpretation } from "../src/model/output-requirements.ts";
import { compileOutputPlan } from "../src/model/output-plan.ts";
import { experienceOutputBinding } from "../worker/experience-output-binding.ts";
import { createExperienceOutputRecipe, matchExperienceOutputRecipeTarget } from "../worker/experience-output-recipe.ts";
import { audioAuthoringConflict } from "../src/model/audio.ts";
import { selectAudioAdapter } from "../worker/audio-selection.ts";
import { audioPreparationConstraints } from "../worker/audio-prompt-adapter.ts";
import { documentRenderTokenReservation } from "../src/model/generation-budget.ts";
import { estimateOpenAITextCallMaximumMicrousd } from "../worker/openai-text-cost.ts";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
function extracted(path, names, deps) {
  // Execute complete actual module logic, replacing import bindings only. Heavy
  // Worker readers receive finite ports; real pure compiler/profile helpers run.
  const body = source(path).replace(/^import[\s\S]*?;\n/gmu, "").replace(/^export /gmu, "");
  const js = stripTypeScriptTypes(body);
  return new Function(...Object.keys(deps), js + "\nreturn {" + names.join(",") + "};")(...Object.values(deps));
}
class OutputConflictError extends Error { constructor(code, status = 409) { super(code); this.code = code; this.status = status; } }
const creator = "audio-owned-test";
const release = await registeredExperience("audio");
const request = { experienceId: "audio", intentId: "00000000-0000-4000-8000-000000000020", releaseHash: release.releaseHash,
  values: { direction: { value: "A rising motif, then a quiet finish. 水 — موسيقى", provenance: "authored" },
    detail: { value: "One sustained ending.", provenance: "authored" } } };
const plan = await buildExperiencePlan(creator, request, release);
const binding = await experienceOutputBinding(plan);
const contract = createAudioOutputContract({ draftId: binding.draftId, draftHash: binding.draftHash, releaseHash: binding.releaseHash,
  requestHash: binding.requestHash, sourceBindingHash: binding.sourceBindingHash });
const requirementId = await experienceResourceId(plan.draftId, "native-output-requirement");
const deliverableId = await experienceResourceId(plan.draftId, "native-output-deliverable");
const recipe = createExperienceOutputRecipe({ output: "audio", requirementId, deliverableId, contract });
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
  documentId: plan.documentId, removed: false, locked: false, handle: "audio-output", position: "z",
  properties: { output_spec: recipe.spec }, sourceEvents: ["managed-output"] };
const outputEvent = { eventId: "managed-output", actor: "user:" + creator, streamId: plan.streamId, clientId: "server:output-requirements", type: "BlockCreated",
  payload: { block_id: requirementId, type: "output", scope: "document", project_id: plan.projectId, document_id: plan.documentId,
    handle: outputBlock.handle, position: outputBlock.position, properties: outputBlock.properties } };

function fixture() {
  const reads = [], selects = [], principal = { userId: creator, streamId: plan.streamId, access: { capabilities: ["project.author"] }, consent: true };
  const input = { request: new Request("https://forma.test"), principal,
    env: { OPENAI_API_KEY: "synthetic-configured-no-network", FAL_KEY: "synthetic-configured-no-network", DB: {
      prepare(sql) { assert.match(sql, /^SELECT 1 AS current WHERE /u); selects.push(sql);
        return { bind(...values) { selects.push(values); return { async first() { return input.current ? { current: 1 } : null; } }; } }; },
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
    })) }, projection: { documentId: plan.documentId, projectId: plan.projectId,
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
  const resolver = extracted("worker/output-audio-source.ts", ["resolveOutputAudioSource", "outputAudioPreparationIdentity"], {
    canonicalJson, digest, freeze, buildExperiencePlan, experienceResourceId, receiptPrefix, validateIntakeRequest, experienceSourceMatches,
    createAudioOutputContract, parseAudioOutputContract, experienceOutputBinding, createExperienceOutputRecipe, matchExperienceOutputRecipeTarget, OutputConflictError, ...ports,
  });
  const preflight = extracted("worker/output-audio-preflight.ts", ["preflightOutputAudioTarget", "outputAudioPreflightAssertions"], {
    canonicalJson, freeze, EXPERIENCE_AUDIO_INTENT, parseAudioOutputContract, audioAuthoringConflict, documentRenderTokenReservation,
    estimateOpenAITextCallMaximumMicrousd, selectAudioAdapter, audioPreparationConstraints, resolveOutputAudioSource: resolver.resolveOutputAudioSource,
  });
  return { input, reads, selects, ...resolver, ...preflight };
}

test("closed Audio contract snapshots exact original source; malformed/accessor fields never widen intent", () => {
  assert.ok(contract); assert.ok(Object.isFrozen(contract.source));
  assert.deepEqual(parseAudioOutputContract(contract), contract);
  for (const mutate of [
    c => { c.durationSeconds = 30; }, c => { c.requireInstrumental = false; }, c => { c.goal = "narration"; },
    c => { c.transcript = "spoken words"; }, c => { c.source.requestHash = "bad"; }, c => { c.source.extra = true; },
  ]) { const c = structuredClone(contract); mutate(c); assert.equal(parseAudioOutputContract(c), null); }
  let reads = 0; const c = structuredClone(contract); Object.defineProperty(c.source, "draftHash", { enumerable: true, get() { reads++; return binding.draftHash; } });
  assert.equal(parseAudioOutputContract(c), null); assert.equal(reads, 0);
  assert.equal(AUDIO_OUTPUT_POLICY.durationSeconds, 20); assert.equal("measuredSeconds" in contract, false);
});

test("actual recipe and plan retain one episode plus requested profile, not a fabricated measured second count", () => {
  assert.equal(inspectOutputRequirement(recipe.spec).status, "valid");
  assert.deepEqual(compiled.targets[0].audio_contract, contract); assert.equal(compiled.targets[0].content_quantity, null);
  assert.ok(matchExperienceOutputRecipeTarget(recipe, compiled, { documentId: plan.documentId, sourceRevision: sourceDigest, requirementRevision: requirementsDigest }));
  for (const key of ["content_quantity", "scene_contract", "narrative_contract", "format_variants", "series"]) {
    const spec = structuredClone(recipe.spec); spec.deliverables[0][key] = null; assert.notEqual(inspectOutputRequirement(spec).status, "valid", key);
  }
  const old = structuredClone(recipe.spec); delete old.deliverables[0].audio_contract;
  const legacy = compileOutputPlan([confirmOutputRequirementInterpretation(old)], { document_id: plan.documentId, source_revision: sourceDigest, requirement_revision: requirementsDigest });
  assert.equal(Object.hasOwn(legacy.targets[0], "audio_contract"), false);
  const changed = structuredClone(compiled); changed.targets[0].audio_contract.source.draftHash = "sha256:" + "c".repeat(64);
  assert.equal(matchExperienceOutputRecipeTarget(recipe, changed, { documentId: plan.documentId, sourceRevision: sourceDigest, requirementRevision: requirementsDigest }), null);
});

test("actual resolver reuses original private intake check, exact current source and immutable operation expiry", async () => {
  const f = fixture(), resolved = await f.resolveOutputAudioSource(f.input);
  assert.deepEqual(f.reads, ["draft", "check"]); assert.deepEqual(resolved.plan, plan);
  assert.match(resolved.requestId, /^audio-[a-f0-9]{64}$/u);
  assert.equal(resolved.expiresAt, new Date(Date.parse(f.input.confirmedPlan.confirmedAt) + 900000).toISOString());
  const repeated = await f.outputAudioPreparationIdentity(contract, f.input.confirmedPlan, f.input.target.id);
  assert.equal(repeated.requestId, resolved.requestId); assert.equal(repeated.expiresAt, resolved.expiresAt);
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("event_private_payloads") && g.sql.includes("redacted_at IS NULL")));
  assert.ok(resolved.sourceAssertions.some(g => g.sql.includes("private_draft_current")));
});

test("actual resolver refuses foreign/consent/source/target/receipt changes rather than adopting nearby Audio", async () => {
  const changes = [
    f => { f.input.scope.ownerUserId = "foreign"; }, f => { f.input.scope.contextId = "context"; },
    f => { f.input.principal.consent = false; }, f => { f.input.principal.projectExecution = {}; },
    f => { f.input.principal.access.capabilities = []; }, f => { f.input.missing = true; },
    f => { f.input.context.projection.libraryBlocks[0].properties = { text: "edited" }; },
    f => { f.input.context.projection.libraryBlocks.at(-1).sourceEvents = ["other-output"]; },
    f => { f.input.target.audio_contract.source.requestHash = "sha256:" + "f".repeat(64); },
    f => { f.input.badReceipt = true; }, f => { f.input.sourceAssertions = []; },
    f => { f.input.sourceEvents.at(-1).actor = "user:foreign"; },
  ];
  for (const change of changes) { const f = fixture(); change(f); await assert.rejects(f.resolveOutputAudioSource(f.input)); }
});

test("actual preflight uses existing manual selector/constraints, prices all three bounded stages and sends nothing", async () => {
  const f = fixture(), result = await f.preflightOutputAudioTarget(f.input);
  assert.equal(result.available, true); assert.equal(result.model, "fal-ai/stable-audio-3/medium/text-to-audio");
  assert.equal(result.maximumCalls, 3); assert.equal(result.maximumTokens, 128000);
  assert.deepEqual(result.settings.payload.audioProfile, EXPERIENCE_AUDIO_INTENT);
  assert.deepEqual(result.settings.calls.map(c => c.stage), ["planning:0:initial", "planning:0:repair", "audio:initial"]);
  assert.equal(result.maximumMicrousd, result.settings.calls.reduce((sum, call) => sum + call.maximumMicrousd, 0));
  assert.equal(result.settings.preparationOnly, true); assert.equal(result.settings.executionAvailable, false);
  assert.deepEqual(result.settings.duration, { requestedSeconds: 20, measuredSeconds: null });
  assert.equal(result.settings.payload.paidMediaConfirmed, undefined);
  assert.equal(f.selects.length, 2); assert.ok(f.outputAudioPreflightAssertions(result)?.length);
  assert.equal(f.outputAudioPreflightAssertions(structuredClone(result)), null);
});

test("preflight refuses configured-model/profile/currentness/expired original and preserves author constraints", async () => {
  const changes = [
    [f => { f.input.env.FAL_KEY = ""; }, "output_audio_provider_unavailable"],
    [f => { f.input.env.OPENAI_MODEL = "unknown"; }, "output_audio_provider_unavailable"],
    [f => { f.input.target.audio_contract.requireInstrumental = false; }, "output_audio_contract_unsupported"],
    [f => { f.input.current = false; }, "output_audio_source_changed"],
    [f => { f.input.confirmedPlan.confirmedAt = new Date(Date.now() - 1000000).toISOString(); }, "output_audio_original_expired"],
    [f => { f.input.context.snapshot.facts.push({ type: "exclusion", intent: "prohibit", active: true, properties: { text: "No music", weight: 1 } }); }, "audio_output_forbidden"],
  ];
  for (const [change, code] of changes) { const f = fixture(); change(f); const value = await f.preflightOutputAudioTarget(f.input); assert.equal(value.available, false, code); assert.equal(value.reasonCode, code); }
});

test("actual router selects Audio preparation while admission and ordinary/native result paths remain fenced", () => {
  const body = source("worker/output-document-execution.ts"), api = source("worker/output-requirements-api.ts"), mini = source("worker/experience-output-api.ts");
  assert.match(body, /hasOwn\(input.target,"audio_contract"\)\)return preflightOutputAudioTarget\(input\)/u);
  assert.match(body, /hasOwn\(target,"audio_contract"\)\)throw new OutputConflictError\("output_audio_execution_unavailable",409\)/u);
  assert.ok(api.indexOf('fail("output_audio_execution_unavailable", 409)') < api.indexOf("const context = requireCurrentSource(trusted), grantId"));
  assert.match(api, /trusted.sourceAssertions.push\(\.\.\.audioSource\)/u);
  assert.match(mini, /loaded.binding.output === "audio" && action && action !== "prepare"/u);
  assert.match(mini, /result.permitted.authorize = false/u);
  assert.match(source("worker/output-native-result.ts"), /native_audio_contract_result_unavailable/u);
  assert.match(api, /audio_contract_media_validation_unavailable/u);
  // Source assertions above do not claim whole API/SQLite or native UI execution.
});

function oneFunction(path, start, end, deps) {
  const text = source(path), from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, "Exact function boundary");
  return new Function(...Object.keys(deps), stripTypeScriptTypes(text.slice(from, to).replace(/^export /u, "")) + "\nreturn " + start.match(/function (\w+)/u)[1] + ";")(...Object.values(deps));
}
test("actual native router reaches the source-bound Audio preparer, never a fallback media route", async () => {
  const f = fixture();
  const route = oneFunction("worker/output-document-execution.ts", "export async function preflightOutputNativeTarget", "\n/** The reviewed target", {
    preflightOutputAudioTarget: f.preflightOutputAudioTarget,
    preflightOutputSceneTarget: () => assert.fail("Scene fallback"), preflightOutputNarrativeTarget: () => assert.fail("Story fallback"),
    outputNativeTargetRefusal: () => assert.fail("3D fallback"), preflightOutputModel3dTarget: () => assert.fail("3D fallback"),
    preflightOutputImageSlidesTarget: () => assert.fail("Image/Slides fallback"),
  });
  const result = await route(f.input); assert.equal(result.available, true); assert.equal(result.settings.executionAvailable, false);
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
    bridgeTarget: () => f.input, outputAudioPreflightAssertions: f.outputAudioPreflightAssertions,
    outputProviderStages: value => { assert.equal(value.maximumCalls, value.settings.calls.length); },
    nowIso: () => new Date().toISOString(), uuidV7: () => "new-preflight-only", outputDigest: digest,
    commandWrite: t => ({ assertions: t.sourceAssertions }),
    commitOutputCommand: async (_env, options) => { persisted = options; return options.events[0].payload.preflight; },
  });
  const result = await preflight(trusted, { planRevisionId: "confirmed-original" }, "synthetic-command-digest", { preflight: f.preflightOutputAudioTarget });
  assert.equal(result.expiresAt, new Date(Date.parse(f.input.confirmedPlan.confirmedAt) + 900000).toISOString());
  assert.equal(result.operationAttempts[f.input.target.id].ordinal, 0); assert.equal(result.operationAttempts[f.input.target.id].previousSlotId, null);
  assert.ok(persisted.assertions.some(value => value.sql.includes("event_private_payloads")));
  assert.ok(persisted.assertions.some(value => value.deadlineMs === Date.parse(result.expiresAt)));
  assert.equal(persisted.events.length, 1); assert.equal(persisted.events[0].type, "OutputPlanPreflighted");
  const offered = await f.preflightOutputAudioTarget(f.input);
  await assert.rejects(preflight(trusted, { planRevisionId: "confirmed-original" }, "synthetic-command-digest", { preflight: async () => structuredClone(offered) }), /output_audio_original_unavailable/u);
});

test("actual native state distinguishes usable preparation from unavailable/expired Audio without offering paid actions", async () => {
  const f = fixture(), prepared = await f.preflightOutputAudioTarget(f.input);
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
  });
  let value = await state(loaded); assert.equal(value.status, "review");
  assert.deepEqual(value.permitted, { prepare: false, authorize: false, run: false, resumeRun: false });
  preflight.targets = [{ ...prepared, available: false, reasonCode: "output_audio_provider_unavailable" }];
  value = await state(loaded); assert.equal(value.status, "unavailable"); assert.equal(value.permitted.authorize, false);
  preflight.targets = [prepared]; preflight.expiresAt = new Date(Date.now() - 1).toISOString();
  value = await state(loaded); assert.equal(value.status, "unavailable");
  loaded.originals.authorize = {}; await assert.rejects(state(loaded), /experience_audio_execution_unavailable/u);
});
