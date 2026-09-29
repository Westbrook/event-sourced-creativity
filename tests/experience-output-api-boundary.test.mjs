import assert from "node:assert/strict";
import { after, test } from "node:test";
import { registerHooks } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { digest } from "../src/experiences/compiler.ts";
import { buildExperiencePlan, experienceResourceId, initialValues, registeredExperience } from "../src/experiences/intake.ts";
import { experienceOutputBinding, experienceOutputCommandKey, experienceOutputEnvelope } from "../worker/experience-output-binding.ts";
import { createExperienceOutputRecipe } from "../worker/experience-output-recipe.ts";

/**
 * Boundary harness: imports the exact candidate API module, not a copied adapter.
 * Actual runtime helpers: compiler/catalog/intake, source matcher, binding, recipe,
 * and ratio validator. Explicit seams: auth/draft persistence/intake check, native
 * Output Requirements commands, command-receipt reads, disclosure and DB metadata.
 * Synthetic JS maps are NOT D1, SQL evaluation, actual native admission or provider
 * execution. No canonical mixed graph, accepted test or financial payload is read.
 */
const apiURL = new URL("../worker/experience-output-api.ts", import.meta.url);
const originalsURL = new URL("../worker/experience-output-originals.ts", import.meta.url);
const candidateDigest = () => createHash("sha256").update(readFileSync(apiURL)).digest("hex");
const candidateSourceDigest = candidateDigest();
const seamRegistry = new Map();
const registryKey = Symbol.for("forma.experience.output.api.boundary.seams");
globalThis[registryKey] = seamRegistry;
const seamExports = {
  "./experience-intake-api.ts": ["authorizeExperienceIntake", "readExperienceDraft", "experienceDraftGuard", "readExperienceBody"],
  "./project-intake.ts": ["commitAtomicIntake"],
  "./output-requirements-api.ts": ["loadOutputTrustedContext", "outputDigest", "outputExperienceCommands"],
  "./output-requirements-ledger.ts": ["readOutputCommand", "outputCommandReceiptAssertion", "outputSourceEpochAssertion"],
  "./output-command-core.ts": ["outputCommandReceiptAssertion", "readOutputCommand"],
  "./output-fal-recovery.ts": ["recoverOutputFalImage"],
  "./output-video-recovery.ts": ["recoverOutputVideo"],
  "./output-model3d-recovery.ts": ["recoverOutputModel3d"],
  "./output-model3d-recovery-availability.ts": ["outputModel3dRecoveryAvailable"],
  "./experience-model3d-reference-source.ts": ["prepareExperienceModel3dReference"],
  "./experience-video-output-source.ts": ["prepareExperienceVideoOutputSource"],
  "./output-scene-source.ts": ["outputScenePreparationIdentity"],
  "./output-video-source.ts": ["outputVideoPreparationIdentity"],
};
const actualAPIImports = new Set(["../src/experiences/compiler.ts", "../src/experiences/intake.ts",
  "../src/experiences/host-source.ts", "./experience-output-binding.ts", "./experience-output-recipe.ts", "./experience-output-originals.ts", "./output-fal-recovery-policy.ts",
  "../src/model/audio-mini-app-consent.ts", "../src/model/output-audio-contract.ts",
  "../src/model/output-storyboard-contract.ts", "../src/model/output-storyboard-offer.ts",
  "../src/model/output-scene-contract.ts", "../src/model/scene-mini-app-consent.ts",
  "./output-scene-preflight-contract.ts", "../src/model/output-narrative-contract.ts",
  "./experience-model3d-recipe.ts", "../src/model/output-video-offer.ts", "./experience-scene-renewal.ts", "./experience-scene-renewal-proof.ts", "./output-proof-capacity-diagnostic.ts",
  "../src/model/model3d-mini-app-consent.ts", "./output-model3d-execution.ts"]);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  const parent = context.parentURL && new URL(context.parentURL);
  const apiBoundary = parent?.pathname === apiURL.pathname && parent.searchParams.has("boundary");
  const originalsBoundary = parent?.pathname === originalsURL.pathname && parent.searchParams.has("boundary");
  // Keep the real originals validator, with this case's existing receipt seam.
  if (apiBoundary && specifier === "./experience-output-originals.ts") {
    const selected = new URL(originalsURL);
    selected.searchParams.set("boundary", parent.searchParams.get("boundary"));
    return nextResolve(selected.href, context);
  }
  if ((apiBoundary || (originalsBoundary && specifier === "./output-command-core.ts")) && seamExports[specifier]) {
    const id = parent.searchParams.get("boundary");
    const source = `const s=globalThis[Symbol.for(${JSON.stringify(Symbol.keyFor(registryKey))})].get(${JSON.stringify(id)});\n`
      + seamExports[specifier].map(name => `export const ${name}=s.${name};`).join("\n");
    return { url: `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`, shortCircuit: true };
  }
  if (apiBoundary && !actualAPIImports.has(specifier)) {
    throw new Error(`boundary_unapproved_api_import: ${specifier}`);
  }
  if (originalsBoundary && !["./experience-output-binding.ts", "./experience-scene-renewal.ts"].includes(specifier)) {
    throw new Error(`boundary_unapproved_originals_import: ${specifier}`);
  }
  return nextResolve(specifier, context);
} });
after(() => {
  hooks.deregister(); seamRegistry.clear(); delete globalThis[registryKey];
  assert.equal(candidateDigest(), candidateSourceDigest, "API source changed during this boundary run; repeat qualification of the selected final candidate");
});

const copy = value => structuredClone(value);
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const future = () => new Date(Date.now() + 3_600_000).toISOString();
const phases = ["save", "confirm", "preflight", "authorize", "run"];

// Explicit stub output compiler. It supplies synthetic canonical-shaped evidence;
// this fixture does not establish compatibility with the canonical compiler.
function syntheticOutputPlan(recipe, plan, sourceDigest, requirementsDigest) {
  const entry = recipe.spec.deliverables[0], variant = entry.format_variants?.[0];
  const obligationId = variant?.id ?? entry.id, label = variant?.label ?? entry.label;
  return {
    schema_version: 1, document_id: plan.documentId, source_revision: sourceDigest, requirement_revision: requirementsDigest,
    groups: [{ id: entry.id, requirement_id: recipe.spec.id, label: entry.label, media_kind: recipe.output,
      required: true, obligation_ids: [obligationId] }],
    obligations: [{ id: obligationId, requirement_id: recipe.spec.id, deliverable_id: entry.id,
      variant_id: variant?.id ?? null, member_id: null, label, media_kind: recipe.output,
      required: true, selected: true, quantity: copy(entry.quantity), quantity_policy: copy(entry.quantity),
      target_ids: [recipe.targetId], resolution: "resolved" }],
    targets: [{ id: recipe.targetId, requirement_id: recipe.spec.id, deliverable_id: entry.id, obligation_id: obligationId,
      variant_id: variant?.id ?? null, member_id: null, label, media_kind: recipe.output, required: true, selected: true,
      ordinal: 1, quantity: copy(entry.quantity), aspect_ratio: copy(variant?.aspect_ratio ?? null),
      source_scope: { kind: "document" }, coverage: copy(entry.coverage), content_quantity: copy(entry.content_quantity ?? null),
      count_policy: copy(entry.content_quantity ?? null), suggested_count: null,
      instruction_text: variant?.original_text ?? entry.original_text, source_revision: sourceDigest,
      requirement_revision: requirementsDigest, blocking_issues: [] }],
    unresolved_groups: [], issues: [],
  };
}

async function harness(output = "slides") {
  const owner = "boundary-owner", release = await registeredExperience(output);
  assert.ok(release);
  const values = initialValues(release);
  if (output === "image") {
    values.subject = { value: "Boundary image source", provenance: "authored" };
    values.ratio = { value: { width: 16, height: 9 }, provenance: "authored" };
  } else {
    values.claim = { value: "Boundary slide claim", provenance: "authored" };
    values.evidence = { value: [1, 2, 3].map(n => ({ id: `e${n}`, text: `Evidence ${n}` })), provenance: "authored" };
  }
  const plan = await buildExperiencePlan(owner, { intentId: randomUUID(), experienceId: output, releaseHash: release.releaseHash, values }, release);
  const binding = await experienceOutputBinding(plan);
  const ids = { requirementId: await experienceResourceId(plan.draftId, "native-output-requirement"),
    deliverableId: await experienceResourceId(plan.draftId, "native-output-deliverable") };
  const recipe = createExperienceOutputRecipe(output === "image" ? { output, ...ids,
    variantId: await experienceResourceId(plan.draftId, "native-output-variant"), aspectRatio: values.ratio.value } : { output, ...ids });
  const h = { owner, plan, binding, recipe, commands: new Map(), receipts: new Map(), calls: [], queries: [], preparedSql: [],
    writes: [], disclosures: [], reads: [], authCalls: 0, schemaCalls: 0, checkCalls: 0,
    sourceDigest: "synthetic-source-digest", requirementsDigest: "synthetic-requirements-empty",
    sourceProblems: [], snapshotPermissions: { canRequest: true }, guardAlive: true,
    missingDraft: false, authStatus: null, trustedStatus: null,
    missingSchema: false, scopeOverride: {},
    failBefore: null, failAfter: null, afterWrite: null, unboundPlan: false, unboundPreflight: false,
    unboundOperation: false, confirmed: null, preflight: null, evidence: null, grant: null, job: null };
  h.events = plan.events.map((event, index) => ({ eventId: `intake-event-${index}`, sequence: index + 1,
    streamId: plan.streamId, actor: "user", type: event.type, payload: copy(event.payload) }));
  h.receipt = { status: "complete", projectId: plan.projectId, documentId: plan.documentId,
    appended: h.events.map(({ eventId, sequence }) => ({ eventId, sequence })) };
  h.projection = { documentId: plan.documentId, projectId: plan.projectId,
    documents: [{ id: plan.documentId, projectId: plan.projectId, title: plan.title, removed: false }],
    libraryBlocks: h.events.filter(event => event.type === "BlockCreated").map(event => ({
      id: event.payload.block_id, projectId: plan.projectId, documentId: plan.documentId,
      scope: "document", canvasId: "", removed: false, locked: false, type: event.payload.type,
      handle: event.payload.handle, position: event.payload.position, properties: copy(event.payload.properties), sourceEvents: [event.eventId] })),
    libraryBlockRelations: [] };
  const scope = { key: `personal:${owner}:${plan.documentId}`, kind: "personal", actorUserId: owner,
    ownerUserId: owner, projectId: plan.projectId, documentId: plan.documentId };
  const guard = () => ({ sql: "synthetic retained draft custody guard", bindings: [plan.draftId] });
  const env = { DB: { prepare(sql) {
    h.preparedSql.push(sql);
    return { bind(...args) { return { async first() {
      h.queries.push({ sql, args });
      if (h.missingSchema) throw new Error("no such table: output_commands");
      if (sql.includes("FROM output_commands command LEFT JOIN events")) return copy(h.commands.get(args[2]) ?? null);
      if (sql.includes("FROM output_operation_slots")) return h.unboundOperation ? { present: 1 } : null;
      if (sql.includes("FROM output_preflights")) return h.unboundPreflight ? { present: 1 } : null;
      if (sql.includes("FROM document_jobs")) return copy(h.job);
      fail("synthetic_unmodeled_metadata_query");
    } }; } };
  } } };
  const trusted = permission => ({ env, scope: { ...scope, ...h.scopeOverride }, projection: h.projection,
    events: h.events, sourceAssertions: [{ sql: "synthetic native source assertion", bindings: [] }],
    sourceProblems: h.sourceProblems, sourceDigest: h.sourceDigest, requirementsDigest: h.requirementsDigest,
    ownerHead: h.events.length, permission });
  function checkGuards(ctx) {
    assert.ok(ctx.sourceAssertions.some(item => item.sql === "synthetic retained draft custody guard"));
    if (!h.guardAlive) fail("synthetic_custody_guard_failed", 410);
  }
  async function saveReceipt(phase, envelope, payload) {
    const key = envelope.clientMutationId, eventId = `output-event-${phase}`, sequence = h.events.length + 1;
    payload.output_command_envelope = copy(envelope);
    const requestDigest = (await digest(envelope)).slice(7);
    const receipt = { key, eventId, action: phase, payload: copy(payload) };
    h.commands.set(key, { request_digest: requestDigest, event_id: eventId, sequence });
    h.receipts.set(key, receipt);
    h.events.push({ eventId, sequence, streamId: plan.streamId, actor: `user:${owner}`,
      type: phase === "save" ? "BlockCreated" : `SyntheticOutput${phase}`, payload: copy(payload) });
    return receipt;
  }
  async function execute(ctx, envelope) {
    h.calls.push(copy(envelope)); checkGuards(ctx);
    const phase = envelope.action;
    const prior = h.commands.get(envelope.clientMutationId);
    if (prior) {
      assert.equal(prior.request_digest, (await digest(envelope)).slice(7), "replay must use exact retained envelope");
      return { synthetic: true, replayed: true };
    }
    if (h.failBefore === phase) return Response.json({ error: "synthetic_native_refused" }, { status: 409 });
    const payload = { project_id: plan.projectId, document_id: plan.documentId };
    if (phase === "save") {
      assert.deepEqual(envelope.spec, recipe.spec);
      Object.assign(payload, { block_id: recipe.spec.id, type: "output", scope: "document",
        handle: `output/${recipe.spec.id}`, position: `z-output-${recipe.spec.id}`,
        properties: { text: recipe.spec.original_text, subtype: recipe.spec.label, output_spec: copy(recipe.spec),
          output_plan_suggestions: { count_policies: {}, suggested_counts: {} }, authority: "authored" } });
      h.requirementsDigest = "synthetic-requirements-saved";
    } else if (phase === "confirm") {
      h.confirmed = { id: "synthetic-plan", revisionId: "synthetic-plan-revision", revision: 1,
        confirmedAt: new Date().toISOString(), sourceDigest: h.sourceDigest, requirementsDigest: h.requirementsDigest,
        plan: syntheticOutputPlan(recipe, plan, h.sourceDigest, h.requirementsDigest),
        targetContractDigests: { [recipe.targetId]: "synthetic-target-contract" }, confirmationOptions: {} };
      Object.assign(payload, { plan_revision_id: h.confirmed.revisionId, confirmed_plan: copy(h.confirmed) });
    } else if (phase === "preflight") {
      h.preflight = { id: "synthetic-preflight", planRevisionId: h.confirmed.revisionId,
        termsDigest: "synthetic-terms", sourceDigest: h.sourceDigest, requirementsDigest: h.requirementsDigest,
        targets: [{ targetId: recipe.targetId, available: true, reason: "synthetic only", provider: "stub-provider",
          model: "stub-model", route: "stub-route", maximumMicrousd: 123, maximumCalls: 1, maximumTokens: 1,
          settings: {}, transferDescription: "Synthetic disclosure" }], maximumMicrousd: 123, maximumCalls: 1,
        expiresAt: future(), createdAt: new Date().toISOString(), operationAttempts: {} };
      payload.preflight = copy(h.preflight);
    } else if (phase === "authorize") {
      const slot = { grantId: "synthetic-grant", slotId: "synthetic-slot", jobId: "synthetic-job",
        targetId: recipe.targetId, planRevisionId: h.confirmed.revisionId,
        targetContractDigest: h.confirmed.targetContractDigests[recipe.targetId], sourceDigest: h.sourceDigest,
        attemptOrdinal: 0, previousSlotId: null, routeDigest: "synthetic-route-digest", status: "authorized" };
      h.evidence = { row: { expires_at: future(), deadline_current: 1, status: "authorized" },
        slots: [slot], confirmedPlan: copy(h.confirmed), preflight: copy(h.preflight) };
      h.job = { job_id: slot.jobId, status: "queued", expires_at: future(), correlation_id: "synthetic-correlation" };
      h.grant = { id: slot.grantId, planRevisionId: slot.planRevisionId, actorUserId: owner, payerUserId: owner,
        status: "authorized", pendingCalls: 0, usedMicrousd: 0, exposedMicrousd: 0,
        expiresAt: h.evidence.row.expires_at, maximumMicrousd: 123, maximumCalls: 1, disclosure: copy(h.preflight),
        operations: [{ id: slot.slotId, jobId: slot.jobId, targetId: slot.targetId, status: slot.status,
          pendingCalls: 0, usedMicrousd: 0, exposedMicrousd: 0 }] };
      Object.assign(payload, { grant_id: slot.grantId, authorized_targets: [{ target_id: slot.targetId,
        operation_slot_id: slot.slotId, job_id: slot.jobId, route_digest: slot.routeDigest }] });
    } else if (phase === "run") {
      h.evidence.slots[0].status = "running"; h.evidence.row.status = "active";
      h.grant.status = "active"; h.grant.operations[0].status = "running"; h.job.status = "running";
      Object.assign(payload, { grant_id: "synthetic-grant", job_ids: ["synthetic-job"], existing_jobs_only: true });
    } else fail("synthetic_unmodeled_command");
    const receipt = await saveReceipt(phase, envelope, payload);
    if (phase === "save") h.projection.libraryBlocks.push({ id: recipe.spec.id, projectId: plan.projectId,
      documentId: plan.documentId, scope: "document", canvasId: "", removed: false, locked: false,
      type: "output", handle: payload.handle, position: payload.position,
      properties: copy(payload.properties), sourceEvents: [receipt.eventId] });
    h.writes.push(phase);
    if (h.afterWrite) await h.afterWrite(phase, h);
    if (h.failAfter === phase) fail("synthetic_lost_ack");
    return { synthetic: true, replayed: false };
  }
  seamRegistry.set(binding.draftId, {
    outputScenePreparationIdentity: async () => { throw new Error("boundary_scene_preparation_forbidden"); },
    // These Image/Slides controls do not exercise 3D source custody. Never
    // silently simulate that helper or load its native runtime dependency graph.
    prepareExperienceModel3dReference: async () => { throw new Error("boundary_model3d_reference_forbidden"); },
    // Video custody is likewise outside these Image/Slides boundary controls.
    prepareExperienceVideoOutputSource: async () => { throw new Error("boundary_video_source_forbidden"); },
    recoverOutputFalImage: async () => { throw new Error("boundary_recovery_forbidden"); },
    recoverOutputVideo: async () => { throw new Error("boundary_video_recovery_forbidden"); },
    recoverOutputModel3d: async () => { throw new Error("boundary_model3d_recovery_forbidden"); },
    outputModel3dRecoveryAvailable: async () => { throw new Error("boundary_model3d_advisory_forbidden"); },
    outputVideoPreparationIdentity: async () => { throw new Error("boundary_video_preparation_forbidden"); },
    outputSourceEpochAssertion: () => { throw new Error("boundary_recovery_forbidden"); },
    authorizeExperienceIntake: async () => { h.authCalls++; return h.authStatus ? Response.json({ error: "synthetic_auth_denied" },
      { status: h.authStatus, headers: { "www-authenticate": 'Bearer realm="boundary"' } }) : { user: { userId: owner } }; },
    readExperienceDraft: async () => h.missingDraft ? null : { plan: h.plan, content: "synthetic-retained-content" },
    experienceDraftGuard: guard,
    readExperienceBody: request => request.json(),
    commitAtomicIntake: async (_env, _auth, body, mode) => { h.checkCalls++; assert.equal(mode, "check");
      assert.deepEqual(body.events, h.plan.events); return Response.json(copy(h.receipt)); },
    loadOutputTrustedContext: async (_request, _env, _documentId, permission) => { h.reads.push(permission);
      return h.trustedStatus ? Response.json({ error: "synthetic_trusted_scope_denied" }, { status: h.trustedStatus }) : trusted(permission); },
    outputDigest: async value => (await digest(value)).slice(7),
    readOutputCommand: async (_env, _scope, key) => copy(h.receipts.get(key) ?? null),
    outputCommandReceiptAssertion: (_scope, receipt) => ({ sql: "synthetic command receipt assertion", bindings: [receipt.key, receipt.eventId] }),
    outputExperienceCommands: {
      ensureSchema: async () => { h.schemaCalls++; },
      readConfirmedPlan: async () => copy(h.confirmed ?? (h.unboundPlan ? { revisionId: "foreign-plan" } : null)),
      readGrantEvidence: async () => copy(h.evidence), snapshot: async () => ({
        grants: h.grant ? [copy(h.grant)] : [], permissions: copy(h.snapshotPermissions) }),
      execute,
      disclose: async (ctx, value, status, assertions) => {
        checkGuards(ctx); h.disclosures.push({ assertions: copy(assertions), sourceAssertions: copy(ctx.sourceAssertions) });
        return Response.json(value, { status, headers: { "cache-control": "private, no-store" } });
      },
    },
  });
  const moduleURL = new URL(apiURL); moduleURL.searchParams.set("boundary", binding.draftId);
  const { handleExperienceOutput } = await import(moduleURL.href);
  h.request = async (action = "", body, options = {}) => {
    const url = options.url ?? `https://forma.invalid/api/experiences/drafts/${plan.draftId}/output${action ? `/${action}` : ""}`;
    const request = new Request(url, { method: options.method ?? (action ? "POST" : "GET"),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { "content-type": "application/json", ...options.headers } });
    const response = await handleExperienceOutput(request, env, { waitUntil() { fail("synthetic_unexpected_dispatch"); } }, {});
    return { response, value: await response.json() };
  };
  h.prepareBody = () => ({ draftHash: h.plan.draftHash, explicitRequirementsConfirmation: true });
  h.authorizeBody = () => ({ draftHash: h.plan.draftHash, termsDigest: h.preflight.termsDigest,
    maximumMicrousd: h.preflight.maximumMicrousd, explicitAuthorization: true });
  h.runBody = () => ({ draftHash: h.plan.draftHash, grantId: "synthetic-grant", explicitRun: true });
  h.stageKey = phase => experienceOutputCommandKey(binding, phase);
  h.stageReceipt = async phase => h.receipts.get(await h.stageKey(phase));
  h.seedOrphan = async phase => {
    const envelope = await experienceOutputEnvelope(binding, phase, h.events.length);
    return saveReceipt(phase, envelope, {});
  };
  return h;
}

async function prepare(h) { const result = await h.request("prepare", h.prepareBody()); assert.equal(result.response.status, 200, JSON.stringify(result.value)); return result; }
async function authorize(h) { await prepare(h); const result = await h.request("authorize", h.authorizeBody()); assert.equal(result.response.status, 200, JSON.stringify(result.value)); return result; }
function assertUnavailable(result, code, status) {
  assert.equal(result.response.status, status ?? 409, JSON.stringify(result.value));
  // The production fixed-code boundary deliberately does not echo arbitrary
  // synthetic seam errors (or codes outside its disclosure registry).
  const withheld = new Set(["synthetic_auth_denied", "synthetic_trusted_scope_denied", "synthetic_native_refused",
    "synthetic_lost_ack", "synthetic_custody_guard_failed", "experience_output_explicit_authorization_required"]);
  assert.equal(result.value.error, withheld.has(code) ? "experience_output_unavailable" : code); assert.equal(result.value.status, "unavailable");
  assert.deepEqual(result.value.permitted, { prepare: false, authorize: false, run: false, resumeRun: false, recoverResult: false });
}

test("routing, queries and cross-site mutations stop before authorization/native commands", async () => {
  const h = await harness();
  for (const [options, status] of [
    [{ url: "https://forma.invalid/api/experiences/drafts/not-a-draft/output" }, 404],
    [{ url: `https://forma.invalid/api/experiences/drafts/${h.plan.draftId}/output/other` }, 404],
    [{ url: `https://forma.invalid/api/experiences/drafts/${h.plan.draftId}/output?retry=1` }, 405],
    [{ method: "POST" }, 405],
  ]) assert.equal((await h.request("", undefined, options)).response.status, status);
  for (const headers of [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    assertUnavailable(await h.request("prepare", h.prepareBody(), { headers }), "same_origin_required", 403);
  }
  assert.equal(h.authCalls, 0); assert.deepEqual(h.calls, []);
});

test("GET absent performs passive source/metadata reads but no native command", async () => {
  const h = await harness("image"), result = await h.request();
  assert.equal(result.response.status, 200, JSON.stringify(result.value));
  assert.equal(result.value.status, "absent"); assert.equal(result.value.stage, null);
  assert.equal(result.value.original, null); assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
  assert.deepEqual(h.reads, ["read"]); assert.equal(h.checkCalls, 1);
  assert.equal(h.schemaCalls, 0); assert.ok(h.preparedSql.length > 0);
  assert.ok(h.preparedSql.every(sql => /^\s*SELECT\b/iu.test(sql)), "adapter metadata access must remain SELECT-only");
  assert.equal(result.response.headers.get("cache-control"), "private, no-store");
});

async function completedChangedImage(output = "image") {
  const h = await harness(output); await authorize(h);
  assert.equal((await h.request("run", h.runBody())).response.status, 200);
  h.job.status = "completed"; h.evidence.row.status = h.grant.status = "completed";
  h.evidence.slots[0].status = h.grant.operations[0].status = "succeeded";
  h.projection.libraryBlocks.push({ id: "adopted-original-reference", documentId: h.plan.documentId });
  h.sourceDigest = "current-source-after-adoption";
  return h;
}
test("passive completed Image reopen preserves original receipts and current changed source", async () => {
  const h = await completedChangedImage(), before = copy(h.writes), result = await h.request();
  assert.equal(result.response.status, 200, JSON.stringify(result.value));
  assert.equal(result.value.current.source, "changed");
  assert.equal(result.value.current.sourceDigest, h.sourceDigest);
  assert.equal(result.value.plan.sourceDigest, "synthetic-source-digest");
  assert.equal(result.value.original.sourceDigest, result.value.plan.sourceDigest);
  assert.equal(result.value.original.jobId, "synthetic-job");
  assert.ok(Object.values(result.value.permitted).every(flag => flag === false));
  assert.deepEqual(h.writes, before);
  assert.ok(h.disclosures.at(-1).sourceAssertions.some(a => a.sql.includes("document_jobs")));
  for (const [action, body] of [["prepare", h.prepareBody()], ["authorize", h.authorizeBody()], ["run", h.runBody()],
    ["recover-result", { draftHash: h.plan.draftHash, grantId: "synthetic-grant", jobId: "synthetic-job", explicitRecovery: true }]]) {
    assertUnavailable(await h.request(action, body), "experience_output_source_changed");
  }
  assert.deepEqual(h.writes, before);
});
test("changed source never enables another output or incomplete original", async () => {
  assertUnavailable(await (await completedChangedImage("slides")).request(), "experience_output_source_changed");
  for (const change of [h => { h.job.status = "running"; }, h => { h.evidence.row.status = h.grant.status = "active"; },
    h => { h.grant.pendingCalls = 1; }, h => { h.grant.operations[0].pendingCalls = 1; }]) {
    const h = await completedChangedImage(); change(h);
    assertUnavailable(await h.request(), "experience_output_source_changed");
  }
});
test("changed-source result retains current custody, private source, managed requirement and original expiry gates", async () => {
  for (const [change, code, status] of [
    [h => { h.guardAlive = false; }, "experience_output_unavailable", 410],
    [h => { h.sourceProblems.push("private source unavailable"); }, "experience_output_source_unavailable", 410],
    [h => { h.job.expires_at = "2020-01-01T00:00:00.000Z"; }, "experience_output_original_job_unavailable", 410],
    [h => { h.evidence.slots[0].attemptOrdinal = 1; }, "experience_output_original_operation_changed", 409],
    [h => { h.grant.actorUserId = "foreign"; }, "experience_output_original_grant_unavailable", 410],
    [h => { h.projection.libraryBlocks.find(b => b.id === h.recipe.spec.id).locked = true; }, "experience_output_requirement_changed", 409],
  ]) {
    const h = await completedChangedImage(); change(h); assertUnavailable(await h.request(), code, status);
  }
});

for (const output of ["image", "slides"]) test(`${output}: separate prepare/authorize/run then GET reuses exact original identity`, async () => {
  const h = await harness(output), prepared = await prepare(h);
  assert.deepEqual(h.writes, ["save", "confirm", "preflight"]);
  assert.equal(prepared.value.status, "review"); assert.equal(prepared.value.original, null);
  assert.equal(prepared.value.permitted.authorize, true); assert.equal(prepared.value.permitted.run, false);
  assert.equal(prepared.value.permitted.resumeRun, false);
  const authorized = await h.request("authorize", h.authorizeBody());
  assert.equal(authorized.response.status, 200, JSON.stringify(authorized.value));
  assert.equal(authorized.value.original.jobId, "synthetic-job"); assert.equal(authorized.value.permitted.run, true);
  assert.equal(authorized.value.permitted.resumeRun, false);
  const ran = await h.request("run", h.runBody());
  assert.equal(ran.response.status, 200, JSON.stringify(ran.value)); assert.equal(ran.value.status, "running");
  assert.deepEqual(h.writes, phases);
  const count = h.calls.length, reload = await h.request();
  assert.equal(reload.response.status, 200, JSON.stringify(reload.value));
  assert.equal(h.calls.length, count); assert.deepEqual(reload.value.original, ran.value.original);
  assert.equal(reload.value.permitted.prepare, false); assert.equal(reload.value.permitted.authorize, false);
  assert.equal(reload.value.permitted.run, false);
  assert.equal(reload.value.permitted.resumeRun, true);
  assert.equal(h.disclosures.at(-1).assertions.length, 5);
  assert.ok(h.disclosures.at(-1).sourceAssertions.some(item => item.sql.includes("document_jobs")));
});

test("client cannot substitute identity/envelope fields or merge recipe confirmation with spending", async () => {
  const h = await harness();
  for (const body of [{}, { ...h.prepareBody(), clientMutationId: "new-command" },
    { ...h.prepareBody(), documentId: "foreign" }, { ...h.prepareBody(), maximumMicrousd: 123 },
    { ...h.prepareBody(), action: "authorize" }]) assertUnavailable(await h.request("prepare", body), "experience_output_request_invalid", 400);
  assertUnavailable(await h.request("prepare", { ...h.prepareBody(), explicitRequirementsConfirmation: false }), "experience_output_recipe_confirmation_required", 403);
  assert.deepEqual(h.writes, []);
  await prepare(h);
  assertUnavailable(await h.request("authorize", { ...h.authorizeBody(), explicitAuthorization: false }), "experience_output_explicit_authorization_required");
  assertUnavailable(await h.request("authorize", { ...h.authorizeBody(), maximumMicrousd: 124 }), "experience_output_explicit_authorization_required");
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_explicit_run_required", 403);
  assert.deepEqual(h.writes, ["save", "confirm", "preflight"]);
});

test("draft/source/custody changes prevent new stages", async () => {
  const h = await harness();
  assertUnavailable(await h.request("prepare", { ...h.prepareBody(), draftHash: "stale" }), "experience_review_stale");
  for (const override of [{ kind: "project" }, { actorUserId: "other" }, { ownerUserId: "new-owner" },
    { projectId: "foreign-project" }, { documentId: "foreign-document" }]) {
    h.scopeOverride = override;
    assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_scope_changed", 403);
  }
  h.scopeOverride = {};
  h.projection.libraryBlocks[0].properties.text = "Changed source";
  assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_source_changed");
  assert.deepEqual(h.writes, []);
});

test("auth denial, missing original intake and unavailable source fail closed", async () => {
  const h = await harness(); h.authStatus = 401;
  assert.equal((await h.request()).response.status, 401); h.authStatus = null; h.missingDraft = true;
  assertUnavailable(await h.request(), "experience_draft_unavailable", 410); h.missingDraft = false;
  h.receipt.status = "partial";
  assertUnavailable(await h.request(), "experience_intake_original_unavailable", 410); h.receipt.status = "complete";
  h.sourceProblems.push("synthetic-source-unavailable");
  assertUnavailable(await h.request(), "experience_output_source_unavailable", 410);
  assert.deepEqual(h.calls, []);
});

test("missing native schema fails closed without setup, DDL or replacement execution", async () => {
  const h = await harness(); h.missingSchema = true;
  assertUnavailable(await h.request(), "experience_output_unavailable");
  assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_unavailable");
  assert.equal(h.schemaCalls, 0); assert.deepEqual(h.calls, []); assert.deepEqual(h.writes, []);
  assert.ok(h.preparedSql.length > 0); assert.ok(h.preparedSql.every(sql => /^\s*SELECT\b/iu.test(sql)));
});

test("auth and trusted-context refusals retain status/code but expose uniform unavailable permissions", async () => {
  const h = await harness(); h.authStatus = 401;
  const auth = await h.request(); assertUnavailable(auth, "synthetic_auth_denied", 401);
  assert.equal(auth.response.headers.get("www-authenticate"), 'Bearer realm="boundary"');
  assert.equal(auth.response.headers.get("cache-control"), "private, no-store");
  h.authStatus = null; h.trustedStatus = 403;
  const scope = await h.request(); assertUnavailable(scope, "synthetic_trusted_scope_denied", 403);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.disclosures, []);
});

test("indexed receipt withholding is retained-unavailable, not absent/new prepare", async () => {
  const h = await harness(); await prepare(h);
  const key = await h.stageKey("save"), saved = h.receipts.get(key), count = h.calls.length;
  for (const receipt of [undefined, { ...saved, privateUnavailable: true }, { ...saved, eventId: "other" }, { ...saved, action: "confirm" }]) {
    if (receipt) h.receipts.set(key, receipt); else h.receipts.delete(key);
    assertUnavailable(await h.request(), "experience_output_original_unavailable", 410);
    assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_original_unavailable", 410);
  }
  h.receipts.set(key, saved); assert.equal(h.calls.length, count);
});

test("index event sequence damage and missing earlier stages cannot become new intent", async () => {
  const h = await harness(); await prepare(h);
  const key = await h.stageKey("save"), row = h.commands.get(key);
  for (const sequence of [null, 0, 1.5]) {
    h.commands.set(key, { ...row, sequence });
    assertUnavailable(await h.request(), "experience_output_original_unavailable", 410);
  }
  h.commands.delete(key);
  assertUnavailable(await h.request(), "experience_output_stage_evidence_unavailable", 410);
  assert.deepEqual(h.writes, ["save", "confirm", "preflight"]);
});

test("altered original command envelope cannot escape the retained stage identity", async () => {
  const h = await harness(); await prepare(h);
  const saved = await h.stageReceipt("save"); saved.payload.output_command_envelope.expectedRevision = "output:999";
  const count = h.calls.length;
  assertUnavailable(await h.request(), "experience_output_original_envelope_unavailable");
  assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_original_envelope_unavailable");
  assert.equal(h.calls.length, count);
});

test("managed requirement edits or detached event evidence stop preparation", async () => {
  const h = await harness(); h.failBefore = "confirm";
  assertUnavailable(await h.request("prepare", h.prepareBody()), "synthetic_native_refused"); h.failBefore = null;
  const block = h.projection.libraryBlocks.find(value => value.id === h.recipe.spec.id);
  block.locked = true;
  assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_requirement_changed"); block.locked = false;
  h.events.find(value => value.eventId === "output-event-save").actor = "user:other";
  assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_requirement_evidence_unavailable", 410);
  h.commands.delete(await h.stageKey("save"));
  assertUnavailable(await h.request("prepare", h.prepareBody()), "experience_output_unbound_requirement", 410);
  assert.deepEqual(h.writes, ["save"]);
});

test("partial preparation retries only missing stages, never resaves confirmed requirements", async () => {
  const h = await harness(); h.failBefore = "confirm";
  assertUnavailable(await h.request("prepare", h.prepareBody()), "synthetic_native_refused");
  assert.deepEqual(h.writes, ["save"]); h.failBefore = null;
  await prepare(h); assert.deepEqual(h.writes, ["save", "confirm", "preflight"]);
  assert.equal(h.calls.filter(value => value.action === "save").length, 1);
});

test("unbound plan, preflight and operation rows cannot trigger replacement work", async () => {
  for (const phase of ["plan", "preflight", "operation"]) {
    const h = await harness();
    if (phase === "plan") { h.unboundPlan = true; }
    else if (phase === "preflight") { h.unboundPreflight = true; }
    else { await prepare(h); h.unboundOperation = true; }
    const expected = phase === "plan" ? ["save"] : phase === "preflight" ? ["save", "confirm"] : ["save", "confirm", "preflight"];
    assertUnavailable(await h.request("prepare", h.prepareBody()), `experience_output_unbound_${phase}`, 410);
    assert.deepEqual(h.writes, expected);
  }
});

test("lost authorization ACK reloads indexed original without a replacement command", async () => {
  const h = await harness(); await prepare(h); h.failAfter = "authorize";
  assertUnavailable(await h.request("authorize", h.authorizeBody()), "synthetic_lost_ack");
  const count = h.calls.length; h.failAfter = null;
  const reload = await h.request(); assert.equal(reload.response.status, 200, JSON.stringify(reload.value));
  assert.equal(reload.value.original.jobId, "synthetic-job"); assert.equal(h.calls.length, count);
  const replay = await h.request("authorize", h.authorizeBody());
  assert.equal(replay.response.status, 200, JSON.stringify(replay.value));
  assert.equal(h.writes.filter(value => value === "authorize").length, 1);
  assert.deepEqual(h.calls.at(-1), h.calls.at(-2));
});

test("lost run ACK and terminal job reload never initiate a new run", async () => {
  const h = await harness(); await authorize(h); h.failAfter = "run";
  assertUnavailable(await h.request("run", h.runBody()), "synthetic_lost_ack"); h.failAfter = null;
  const count = h.calls.length;
  for (const [slotStatus, jobStatus, expected] of [["running", "running", "running"],
    ["succeeded", "completed", "succeeded"], ["failed", "failed", "failed"],
    ["cancelled", "canceled", "cancelled"], ["uncertain", "running", "uncertain"],
    ["running", "partial", "partial"]]) {
    h.evidence.slots[0].status = slotStatus; h.grant.operations[0].status = slotStatus; h.job.status = jobStatus;
    const result = await h.request(); assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.status, expected); assert.equal(result.value.permitted.run, false);
    assert.equal(result.value.original.jobId, "synthetic-job");
  }
  assert.equal(h.calls.length, count); assert.equal(h.writes.filter(value => value === "run").length, 1);
});

test("terminal original POST run inspects existing state without replaying the native command", async () => {
  const h = await harness(); await authorize(h);
  assert.equal((await h.request("run", h.runBody())).response.status, 200);
  const count = h.calls.length;
  for (const [slotStatus, jobStatus] of [["succeeded", "completed"], ["failed", "failed"],
    ["cancelled", "canceled"], ["uncertain", "running"], ["running", "partial"]]) {
    h.evidence.slots[0].status = slotStatus; h.grant.operations[0].status = slotStatus; h.job.status = jobStatus;
    const result = await h.request("run", h.runBody());
    assert.equal(result.response.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.original.jobId, "synthetic-job"); assert.equal(result.value.permitted.run, false);
  }
  assert.equal(h.calls.length, count); assert.equal(h.writes.filter(value => value === "run").length, 1);
});

test("changed or expired original job cannot be started as a new attempt", async () => {
  const h = await harness(); await authorize(h); const count = h.calls.length;
  h.job.status = "completed";
  const completed = await h.request(); assert.equal(completed.response.status, 200, JSON.stringify(completed.value));
  assert.equal(completed.value.permitted.run, false);
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_run_unavailable");
  h.job.expires_at = "2000-01-01T00:00:00.000Z";
  assertUnavailable(await h.request(), "experience_output_original_job_unavailable", 410);
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_original_job_unavailable", 410);
  assert.equal(h.calls.length, count);
});

test("custody loss after a stage prevents subsequent synthetic writes and final disclosure", async () => {
  const h = await harness(); h.afterWrite = phase => { if (phase === "save") h.guardAlive = false; };
  assertUnavailable(await h.request("prepare", h.prepareBody()), "synthetic_custody_guard_failed", 410);
  assert.deepEqual(h.writes, ["save"]); assert.equal(h.disclosures.length, 0);
});

test("expired or unavailable retained preflight does not authorize or refresh itself", async () => {
  const h = await harness(); await prepare(h);
  const receipt = await h.stageReceipt("preflight"); receipt.payload.preflight.expiresAt = "2000-01-01T00:00:00.000Z";
  const count = h.calls.length, result = await h.request();
  assert.equal(result.response.status, 200, JSON.stringify(result.value)); assert.equal(result.value.status, "unavailable");
  assert.equal(result.value.permitted.prepare, false); assert.equal(result.value.permitted.authorize, false);
  assert.equal(h.calls.length, count);
});

test("retained preflight presence requires a valid disclosed preflight body", async () => {
  const h = await harness(); await prepare(h);
  const receipt = await h.stageReceipt("preflight"), original = copy(receipt.payload.preflight), count = h.calls.length;
  for (const value of [undefined, null, { ...original, targets: undefined }, { ...original, targets: [null] }]) {
    if (value === undefined) delete receipt.payload.preflight; else receipt.payload.preflight = value;
    const result = await h.request();
    assertUnavailable(result, "experience_output_preflight_changed");
  }
  assert.equal(h.calls.length, count);
});

for (const output of ["image", "slides"]) test(`${output}: lost run ACK exposes explicit resume of the unchanged original envelope`, async () => {
  const h = await harness(output); await authorize(h); h.failAfter = "run";
  assertUnavailable(await h.request("run", h.runBody()), "synthetic_lost_ack"); h.failAfter = null;
  const runKey = await h.stageKey("run"), originalIndex = copy(h.commands.get(runKey));
  const originalReceipt = copy(h.receipts.get(runKey));
  const originalEnvelope = copy(originalReceipt.payload.output_command_envelope);
  // Advance only the synthetic stream head, not authored source or retained
  // output requirement. Resume must not create an envelope at this new revision.
  h.events.push({ eventId: "synthetic-head-advance", sequence: h.events.length + 1,
    streamId: h.plan.streamId, actor: `user:${h.owner}`, type: "SyntheticUnrelatedHeadAdvance", payload: {} });
  const before = h.calls.length;
  const reloaded = await h.request(); assert.equal(reloaded.response.status, 200, JSON.stringify(reloaded.value));
  assert.equal(h.calls.length, before, "GET does not wake the recorded job");
  assert.equal(reloaded.value.permitted.run, false); assert.equal(reloaded.value.permitted.resumeRun, true);
  assert.equal(reloaded.value.original.jobId, "synthetic-job");
  const resumed = await h.request("run", h.runBody()); assert.equal(resumed.response.status, 200, JSON.stringify(resumed.value));
  assert.equal(h.calls.length, before + 1); assert.deepEqual(h.calls.at(-1), originalEnvelope);
  assert.deepEqual(h.commands.get(runKey), originalIndex); assert.deepEqual(h.receipts.get(runKey), originalReceipt);
  assert.equal(h.writes.filter(phase => phase === "run").length, 1);
  assert.equal(resumed.value.original.jobId, reloaded.value.original.jobId);
});

test("resume admits only the recorded queued/running slot-job pairs with current matching grant status", async () => {
  const h = await harness(); await authorize(h); assert.equal((await h.request("run", h.runBody())).response.status, 200);
  for (const grantStatus of ["authorized", "active"]) for (const slotStatus of ["queued", "running"]) for (const jobStatus of ["queued", "running"]) {
    h.grant.status = grantStatus; h.evidence.row.status = grantStatus;
    h.evidence.slots[0].status = slotStatus; h.grant.operations[0].status = slotStatus; h.job.status = jobStatus;
    const before = h.calls.length, state = await h.request();
    assert.equal(state.response.status, 200, JSON.stringify(state.value));
    assert.equal(state.value.permitted.run, false); assert.equal(state.value.permitted.resumeRun, true);
    assert.equal(h.calls.length, before);
    assert.equal((await h.request("run", h.runBody())).response.status, 200);
    assert.equal(h.calls.length, before + 1);
  }
  assert.equal(h.writes.filter(phase => phase === "run").length, 1);
});

test("recorded terminal, partial, uncertain and incompatible status pairs deny resume without dispatch", async () => {
  const h = await harness(); await authorize(h); assert.equal((await h.request("run", h.runBody())).response.status, 200);
  const before = h.calls.length;
  for (const [slotStatus, jobStatus] of [["authorized", "running"], ["running", "committing"],
    ["succeeded", "completed"], ["failed", "failed"], ["cancelled", "canceled"],
    ["uncertain", "running"], ["running", "partial"], ["unavailable", "queued"], ["running", "unknown"]]) {
    h.evidence.slots[0].status = slotStatus; h.grant.operations[0].status = slotStatus; h.job.status = jobStatus;
    const state = await h.request(); assert.equal(state.response.status, 200, JSON.stringify(state.value));
    assert.equal(state.value.permitted.run, false); assert.equal(state.value.permitted.resumeRun, false);
    const requested = await h.request("run", h.runBody());
    assert.equal(requested.response.status, 200, JSON.stringify(requested.value));
    assert.equal(requested.value.permitted.resumeRun, false);
  }
  assert.equal(h.calls.length, before);
});

test("running metadata without a recorded original run cannot become a first run or resume", async () => {
  const h = await harness(); await authorize(h);
  h.evidence.slots[0].status = "running"; h.grant.operations[0].status = "running"; h.job.status = "running";
  h.grant.status = "active"; h.evidence.row.status = "active";
  const before = h.calls.length, state = await h.request();
  assert.equal(state.response.status, 200, JSON.stringify(state.value)); assert.equal(state.value.original.run, null);
  assert.equal(state.value.permitted.run, false); assert.equal(state.value.permitted.resumeRun, false);
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_run_unavailable");
  assert.equal(h.calls.length, before); assert.equal(h.commands.has(await h.stageKey("run")), false);
});

test("revoked, unknown, mismatched and expired grant evidence cannot expose resume", async () => {
  const h = await harness(); await authorize(h); assert.equal((await h.request("run", h.runBody())).response.status, 200);
  const before = h.calls.length;
  for (const status of ["revoked", "completed", "exceeded", "unknown"]) {
    h.grant.status = status; h.evidence.row.status = status;
    const state = await h.request(); assert.equal(state.response.status, 200, JSON.stringify(state.value));
    assert.equal(state.value.permitted.resumeRun, false); assert.equal(state.value.permitted.run, false);
    assert.equal((await h.request("run", h.runBody())).response.status, 200);
  }
  h.grant.status = "active"; h.evidence.row.status = "active";
  h.grant.operations[0].status = "queued"; // Does not match the earlier running slot.
  assertUnavailable(await h.request(), "experience_output_original_grant_unavailable", 410);
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_original_grant_unavailable", 410);
  assert.equal(h.calls.length, before, "mixed native operation status must not dispatch resume");
  h.grant.operations[0].status = "running";
  h.evidence.row.status = "authorized";
  assertUnavailable(await h.request(), "experience_output_original_grant_unavailable", 410);
  h.evidence.row.status = "active"; h.evidence.row.deadline_current = 0;
  const expiredGrant = await h.request(); assert.equal(expiredGrant.response.status, 200, JSON.stringify(expiredGrant.value));
  assert.equal(expiredGrant.value.status, "unavailable"); assert.equal(expiredGrant.value.permitted.resumeRun, false);
  assert.equal((await h.request("run", h.runBody())).response.status, 200);
  h.evidence.row.deadline_current = 1; h.job.expires_at = "2000-01-01T00:00:00.000Z";
  assertUnavailable(await h.request(), "experience_output_original_job_unavailable", 410);
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_original_job_unavailable", 410);
  assert.equal(h.calls.length, before);
});

test("unresolved synthetic accounting hides resume without rejecting settled nonzero history", async () => {
  const h = await harness(); await authorize(h); assert.equal((await h.request("run", h.runBody())).response.status, 200);
  const before = h.calls.length;
  for (const [grantPending, operationPending] of [[1, 0], [0, 1], [1, 1],
    [undefined, 0], [0, undefined], ["0", 0], [0, "0"]]) {
    h.grant.pendingCalls = grantPending; h.grant.operations[0].pendingCalls = operationPending;
    const state = await h.request(); assert.equal(state.response.status, 200, JSON.stringify(state.value));
    assert.equal(state.value.permitted.resumeRun, false); assert.equal(state.value.permitted.run, false);
    assert.equal((await h.request("run", h.runBody())).response.status, 200);
  }
  assert.equal(h.calls.length, before);
  h.grant.pendingCalls = 0; h.grant.operations[0].pendingCalls = 0;
  h.grant.usedMicrousd = 42; h.grant.exposedMicrousd = 42;
  h.grant.operations[0].usedMicrousd = 42; h.grant.operations[0].exposedMicrousd = 42;
  const settled = await h.request(); assert.equal(settled.response.status, 200, JSON.stringify(settled.value));
  assert.equal(settled.value.permitted.resumeRun, true); assert.equal(h.calls.length, before);
  assert.equal((await h.request("run", h.runBody())).response.status, 200);
  assert.equal(h.calls.length, before + 1); assert.equal(h.writes.filter(phase => phase === "run").length, 1);
});

test("resume requires explicit current intent and the retained run's explicit acknowledgement", async () => {
  const h = await harness(); await authorize(h); assert.equal((await h.request("run", h.runBody())).response.status, 200);
  const before = h.calls.length;
  assertUnavailable(await h.request("run", { ...h.runBody(), explicitRun: false }), "experience_output_explicit_run_required", 403);
  assertUnavailable(await h.request("run", { ...h.runBody(), grantId: "replacement-grant" }), "experience_output_explicit_run_required", 403);
  const key = await h.stageKey("run"), receipt = h.receipts.get(key);
  receipt.payload.output_command_envelope.explicitRun = false;
  // Synthetic malformed indexed evidence reaches the API guard with a consistent
  // envelope digest. Canonical receipt integrity remains outside this harness.
  h.commands.get(key).request_digest = (await digest(receipt.payload.output_command_envelope)).slice(7);
  assertUnavailable(await h.request(), "experience_output_original_run_unavailable", 410);
  assertUnavailable(await h.request("run", h.runBody()), "experience_output_original_run_unavailable", 410);
  assert.equal(h.calls.length, before);
});

test("missing or denied native requester permission hides resume even with settled current evidence", async () => {
  const h = await harness(); await authorize(h); assert.equal((await h.request("run", h.runBody())).response.status, 200);
  const before = h.calls.length;
  for (const permissions of [undefined, null, {}, { canRequest: false }, { canRequest: "true" }]) {
    h.snapshotPermissions = permissions;
    const state = await h.request(); assert.equal(state.response.status, 200, JSON.stringify(state.value));
    assert.equal(state.value.permitted.run, false); assert.equal(state.value.permitted.resumeRun, false);
    const requested = await h.request("run", h.runBody());
    assert.equal(requested.response.status, 200, JSON.stringify(requested.value));
    assert.equal(requested.value.permitted.resumeRun, false);
  }
  assert.equal(h.calls.length, before);
  h.snapshotPermissions = { canRequest: true };
  const restored = await h.request(); assert.equal(restored.response.status, 200, JSON.stringify(restored.value));
  assert.equal(restored.value.permitted.resumeRun, true); assert.equal(h.calls.length, before);
});
