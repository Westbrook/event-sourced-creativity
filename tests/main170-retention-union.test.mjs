import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { outputAssetObjectKeys } from "../worker/output-asset-storage-identity.ts";
import { outputRecoveryRecordIsInert, organizationOutputSubmissionBlockers } from "../worker/output-requirement-retention.ts";
import { publicEventPayload } from "../worker/event-privacy.ts";
import { openOrganizationPayload, sealOrganizationPayload } from "../worker/organization-crypto.ts";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

// Reuse every declaration of the existing full-Worker/actual-SQLite fixture.
// Only its top-level test registrations are omitted; no runtime method is replaced.
const ts = createRequire(import.meta.url)("typescript");
const fixtureUrl = new URL("./assistant-runtime.test.mjs", import.meta.url);
const fixtureSource = readFileSync(fixtureUrl, "utf8");
const fixtureAst = ts.createSourceFile(fixtureUrl.pathname, fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fixtureDeclarations = fixtureAst.statements.filter((node) =>
  ts.isImportDeclaration(node) || ts.isVariableStatement(node) || ts.isFunctionDeclaration(node));
const fixtureModule = fixtureDeclarations.map((node) => node.getFullText(fixtureAst)).join("\n")
  + "\nexport { sharedProjectFixture, json, specialistApprovedTurn, specialistFreeTurn, seedLegacyAssistantTask, seedExpiredConsentedAssistantLease, consequential, consequentialBalances, consequentialReceipt, adaptiveReentryFinancialState, deletionSignedBacklog, interceptConsequentialDb, deleteAssistantOrganization, reserveBudget, reserveCostBudget, settleCostBudget, claimCostBudgetReservation, requireUser };";
const fixtureModuleUrl = new URL("./.main170-retention-existing-fixture.mjs", import.meta.url).href;
const fixtureHook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === fixtureModuleUrl ? { url: fixtureModuleUrl, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url === fixtureModuleUrl ? { format: "module", source: fixtureModule, shortCircuit: true } : next(url, context);
  },
});
const actual = await import(fixtureModuleUrl).finally(() => fixtureHook.deregister());
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fixtureSecret = "Synthetic retained Output source; not a provider response.";
const now = () => new Date().toISOString();
const insert = (state, table, row) => state.sqlite.prepare(
  "INSERT INTO " + table + "(" + Object.keys(row).join(",") + ") VALUES(" + Object.keys(row).map(() => "?").join(",") + ")",
).run(...Object.values(row));
const rows = (state, table) => state.sqlite.prepare("SELECT * FROM " + table).all().map((row) => ({ ...row }));

async function retainedFixture(t) {
  const state = await actual.sharedProjectFixture({ actions: true, provider: true });
  const originalFetch = globalThis.fetch, calls = [], objects = new Map(), deleted = [], reads = [];
  globalThis.fetch = async (...args) => { calls.push(args); throw new Error("Retention must not call a network/provider"); };
  const object = (key) => {
    reads.push(key);
    const saved = objects.get(key);
    return saved ? { body: new Uint8Array(saved.bytes), size: saved.bytes.byteLength,
      customMetadata: { ...saved.metadata }, writeHttpMetadata(headers) { headers.set("content-type", saved.contentType ?? "image/png"); } } : null;
  };
  state.env.MEDIA = { get: async (key) => object(key), head: async (key) => object(key),
    delete: async (key) => { deleted.push(key); objects.delete(key); },
    put: async (key, bytes, options) => { objects.set(key, { bytes: new Uint8Array(bytes), metadata: options?.customMetadata ?? {}, contentType: options?.httpMetadata?.contentType }); return object(key); } };
  state.env.FORMA_ENCRYPTION_ROOT_KEY = "10".repeat(32); // Synthetic test-only key material.
  Object.assign(state, { calls, objects, deleted, storageReads: reads });
  t.after(async () => {
    try { await state.drainBackground(); assert.equal(calls.length, 0, "No provider or external-storage request"); }
    finally { globalThis.fetch = originalFetch; state.sqlite.close(); }
  });
  return state;
}

function scopedEvent(state, suffix, type, { organizationId = state.organizationId, projectAccessId = state.projectAccessId, owner = "assistant-owner", projectId = "project-atmosphere", documentId = "doc-atmosphere" } = {}) {
  const eventId = suffix + "-" + crypto.randomUUID(), timestamp = now(), stream = "creative:" + owner;
  const sequence = Number(state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM events WHERE stream_id=?").get(stream).n) + 1;
  const split = publicEventPayload(eventId, { project_id: projectId, document_id: documentId, text: fixtureSecret }, true);
  insert(state, "events", { event_id: eventId, stream_id: stream, sequence, occurred_at: timestamp, recorded_at: timestamp,
    actor: "user:" + owner, client_id: "retention-union-fixture", correlation_id: eventId, causation_id: null,
    compensates_event_id: null, schema_version: 1, type, payload: JSON.stringify(split.payload) });
  insert(state, "event_private_payloads", { private_event_id: eventId, owner_id: owner, project_id: projectId, document_id: documentId,
    private_json: split.privateJson, created_at: timestamp, redacted_at: null });
  if (organizationId) {
    const projectSequence = Number(state.sqlite.prepare("SELECT COALESCE(MAX(project_sequence),0) AS n FROM project_event_scopes WHERE project_access_id=?").get(projectAccessId).n) + 1;
    insert(state, "project_event_scopes", { event_id: eventId, project_access_id: projectAccessId, organization_id: organizationId,
      project_id: projectId, owner_user_id: owner, source_stream_id: stream, source_sequence: sequence, project_sequence: projectSequence,
      actor_user_id: owner, created_at: timestamp });
  }
  return eventId;
}

// Synthetic durable Output rows use the actual installed schema and canonical custody
// indexes. They are historical test inputs, never a second execution implementation.
function outputPlan(state, key, { slotStatus = "queued", callStatus = null, organizationId = state.organizationId, projectAccessId = state.projectAccessId, owner = "assistant-owner", projectId = "project-atmosphere", documentId = "doc-atmosphere" } = {}) {
  const timestamp = now();
  const scope = { organizationId, projectAccessId, owner, projectId, documentId };
  const planId = key + "-plan", targetId = key + "-target", grantId = key + "-grant", slotId = key + "-slot";
  const confirmation = scopedEvent(state, key, "OutputPlanConfirmed", scope), preflight = scopedEvent(state, key, "OutputPreflightPrepared", scope), authorization = scopedEvent(state, key, "OutputExecutionAuthorized", scope);
  const fields = { scope_key: key, plan_revision_id: planId };
  insert(state, "output_plan_revisions", { ...fields, scope_kind: organizationId ? "project" : "personal", owner_user_id: owner,
    project_id: projectId, document_id: documentId, organization_id: organizationId, project_access_id: organizationId ? projectAccessId : null,
    plan_id: planId, revision: 1, confirmed_event_id: confirmation, requirements_digest: digest(key), source_digest: digest(key),
    resolver_version: "1", source_head: 1, target_count: 1, created_at: timestamp });
  insert(state, "output_plan_targets", { ...fields, target_id: targetId, target_contract_digest: digest(key), media_kind: "image", required: 1, selected: 1, ordinal: 0 });
  insert(state, "output_preflights", { ...fields, preflight_id: key + "-preflight", actor_user_id: owner, terms_digest: digest(key), event_id: preflight,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: timestamp });
  insert(state, "output_execution_grants", { ...fields, grant_id: grantId, actor_user_id: owner, payer_user_id: owner, context_id: null,
    preflight_id: key + "-preflight", authorization_event_id: authorization, maximum_microusd: 1000, maximum_calls: 2, status: "authorized",
    expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: timestamp });
  insert(state, "output_operation_slots", { ...fields, slot_id: slotId, grant_id: grantId, target_id: targetId,
    target_contract_digest: digest(key), source_digest: digest(key), provider: "test-transport", model: "fixture", route_digest: digest(key),
    job_id: key + "-job", cost_reservation_id: key + "-cost", token_reservation_id: key + "-token",
    maximum_microusd: 1000, maximum_calls: 2, maximum_tokens: 1000, status: slotStatus, outcome_event_id: null, created_at: timestamp, updated_at: timestamp });
  insert(state, "output_operation_routes", { scope_key: key, slot_id: slotId, stage_key: "initial", provider: "test-transport", model: "fixture", maximum_calls: 2 });
  if (callStatus) insert(state, "output_provider_calls", { scope_key: key, slot_id: slotId, call_key: "initial:1",
    client_request_id: key + "-client", request_digest: digest(key), stage_key: "initial", provider: "test-transport", model: "fixture",
    reserved_microusd: 1000, used_microusd: callStatus === "settled" ? 123 : null, status: callStatus,
    provider_response_id: callStatus === "settled" ? key + "-receipt" : null, created_at: timestamp, settled_at: callStatus === "settled" ? timestamp : null });
  return { key, planId, targetId, grantId, slotId, confirmation, authorization, owner, projectId, documentId, organizationId, projectAccessId };
}

function outputAsset(state, key, { scope = null, adopted = true, acknowledged = 1, status = "written", published = true, objectPresent = true, organizationId = state.organizationId, projectAccessId = state.projectAccessId, owner = "assistant-owner", projectId = "project-atmosphere", documentId = "doc-atmosphere" } = {}) {
  const timestamp = now();
  const scopeKey = scope?.key ?? key, assetId = key + "-asset", bytes = new TextEncoder().encode(fixtureSecret + key), hash = digest(bytes);
  const storageKey = outputAssetObjectKeys({ ownerUserId: owner, projectId, documentId, key: scopeKey }, assetId, hash, "png").key;
  const eventId = adopted || published ? scopedEvent(state, key, "OutputAssetAdopted", { organizationId, projectAccessId, owner, projectId, documentId }) : null;
  const metadata = { outputRequirementAsset: "1", ownerId: owner, projectId, documentId, scopeKey, assetId, sha256: hash };
  if (adopted) insert(state, "output_assets", { scope_key: scopeKey, asset_id: assetId, document_id: documentId,
    owner_user_id: owner, created_by_user_id: owner, source_digest: digest(key), storage_key: storageKey, content_sha256: hash,
    byte_length: bytes.length, mime_type: "image/png", media_kind: "image", created_event_id: eventId, created_at: timestamp, redacted_at: null });
  insert(state, "output_asset_storage_writes", { scope_key: scopeKey, asset_id: assetId, owner_user_id: owner, actor_user_id: owner,
    organization_id: organizationId, project_access_id: organizationId ? projectAccessId : null, project_id: projectId, document_id: documentId,
    context_id: organizationId ? "fixture-original-context" : null, command_key: key + "-command", request_digest: digest(key), source_digest: digest(key),
    storage_key: storageKey, content_sha256: hash, byte_length: bytes.length, status, write_acknowledged: acknowledged,
    publication_event_id: published ? eventId : null, created_at: timestamp, updated_at: new Date(Date.now() - 600_000).toISOString() });
  if (objectPresent) state.objects.set(storageKey, { bytes, metadata });
  return { key: scopeKey, assetId, storageKey, hash, bytes, metadata, eventId };
}

function nativeStorage(state, scope, { acknowledged = 1, status = "written", published = true, objectPresent = true } = {}) {
  const bytes = new TextEncoder().encode(fixtureSecret + scope.key + "native"), hash = digest(bytes), storageKey = "native/" + scope.owner + "/" + scope.key + ".png";
  const eventId = published ? scopedEvent(state, scope.key, "GenerationCompleted", scope) : null, timestamp = now();
  insert(state, "output_native_storage_writes", { scope_key: scope.key, slot_id: scope.slotId, storage_key: storageKey, content_sha256: hash,
    status, write_acknowledged: acknowledged, publication_event_id: eventId, created_at: timestamp, updated_at: new Date(Date.now() - 600_000).toISOString() });
  const metadata = { outputNativeStorage: "1", outputOwnerId: scope.owner, outputScopeKey: scope.key, outputSlotId: scope.slotId, outputDocumentId: scope.documentId, outputSha256: hash };
  if (objectPresent) state.objects.set(storageKey, { bytes, metadata });
  return { ...scope, storageKey, hash, bytes, metadata, eventId };
}

async function queuedAssistant(state, { held = false, submitted = false } = {}) {
  state.controls.skipAssistantTaskClaimOnce = true;
  const approved = await actual.specialistApprovedTurn(state, "Keep this exact synthetic approval until deletion is safe.");
  await state.drainBackground();
  if (held || submitted) await actual.seedExpiredConsentedAssistantLease(state, approved.review, { submitted });
  return approved;
}
const deletion = (state) => actual.deleteAssistantOrganization(state);
const recovery = (state, body) => state.request("/api/workspaces/" + state.organizationId + "/recovery", actual.json(body, state.owner));
const privateBodies = (state) => rows(state, "event_private_payloads").filter((row) => row.owner_id === "assistant-owner" && row.project_id === "project-atmosphere" && row.redacted_at === null).length;


test("retention union: queued signed work and published Output bytes share one safe deletion", async (t) => {
  const state = await retainedFixture(t), assistant = await queuedAssistant(state, { held: true });
  const output = outputPlan(state, "union-safe"), asset = outputAsset(state, "union-asset"), native = nativeStorage(state, output);
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(body.status, "completed"); assert.equal(body.receipt.outputOperationalTombstonesRetained, true);
  assert.equal(body.receipt.removedOutputAssets, 2);
  assert.deepEqual(new Set(state.deleted), new Set([asset.storageKey, native.storageKey]));
  assert.equal(rows(state, "output_execution_grants")[0].status, "revoked");
  assert.equal(rows(state, "output_operation_slots")[0].status, "cancelled");
  assert.equal(rows(state, "output_asset_storage_writes")[0].status, "deleted");
  assert.equal(rows(state, "output_native_storage_writes")[0].status, "deleted");
  assert.ok(rows(state, "output_assets")[0].redacted_at);
  const receipt = actual.consequentialReceipt(state, assistant.task.id);
  assert.equal(receipt.steps[0].status, "not-submitted");
  assert.equal(receipt.tokens[0].status, "released"); assert.equal(receipt.cost[0].status, "released");
  assert.equal(rows(state, "assistant_specialist_tasks").length, 0);
  assert.equal(privateBodies(state), 0);
});


for (const kind of ["signed-submitting", "legacy-token-only", "legacy-active-cost", "output-pending", "output-uncertain", "output-slot-uncertain"]) test("retention union: " + kind + " keeps private evidence and every original hold", async (t) => {
  const state = await retainedFixture(t);
  let expectedAssistant, expectedToken;
  if (kind === "signed-submitting") {
    expectedAssistant = (await queuedAssistant(state, { submitted: true })).task.id;
  } else if (kind.startsWith("legacy")) {
    const turn = await actual.specialistFreeTurn(state), legacy = await actual.seedLegacyAssistantTask(state, turn, { status: "queued", submitted: false });
    if (kind === "legacy-token-only") await actual.settleCostBudget(state.env, "assistant-owner", legacy.costReservationId, 0);
    state.sqlite.prepare("DELETE FROM assistant_specialist_tasks WHERE task_id=?").run(legacy.id);
    expectedToken = legacy.tokenReservationId;
  }
  const output = outputPlan(state, "union-blocker", { slotStatus: kind === "output-slot-uncertain" ? "uncertain" : "queued",
    callStatus: kind === "output-pending" ? "pending" : kind === "output-uncertain" ? "uncertain" : null });
  const asset = outputAsset(state, "blocker-asset"), before = actual.adaptiveReentryFinancialState(state), bodies = privateBodies(state);
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(body.error, "provider_submission_in_flight");
  if (expectedAssistant) assert.ok(body.assistantTasks.some((row) => row.taskId === expectedAssistant));
  if (expectedToken) assert.ok(body.tokenReservations.some((row) => row.reservationId === expectedToken));
  if (kind.startsWith("output")) assert.ok(body.outputSlots.some((row) => row.slotId === output.slotId));
  assert.deepEqual(actual.adaptiveReentryFinancialState(state), before);
  assert.equal(privateBodies(state), bodies);
  assert.equal(rows(state, "organization_deletion_jobs").length, 0);
  assert.equal(rows(state, "output_assets")[0].redacted_at, null);
  assert.equal(rows(state, "output_execution_grants")[0].status, "authorized");
  assert.equal(state.objects.has(asset.storageKey), true);
  assert.equal(state.deleted.length, 0);
});

for (const stage of ["admission", "finalization"]) test("retention union: a late Output submission at " + stage + " blocks the actual deletion transaction", async (t) => {
  const state = await retainedFixture(t), output = outputPlan(state, "raced-output", { callStatus: "settled" });
  const bodies = privateBodies(state), before = actual.adaptiveReentryFinancialState(state);
  const pattern = stage === "admission" ? /^\s*INSERT INTO organization_deletion_jobs/u : /AS provider_guard/u;
  let fired = false;
  const restore = actual.interceptConsequentialDb(state, "batch", pattern, () => {
    fired = true;
    state.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL,settled_at=NULL WHERE scope_key=?").run(output.key);
  });
  t.after(restore);
  const response = await deletion(state), body = await response.json();
  assert.equal(fired, true); assert.equal(response.status, 409, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(body.error, "provider_submission_in_flight");
  assert.ok(body.outputSlots.some((row) => row.slotId === output.slotId));
  assert.equal(privateBodies(state), bodies);
  assert.equal(rows(state, "output_execution_grants")[0].status, "authorized", "The final Output guard rolls back its own revocation as well as private erasure");
  assert.equal(rows(state, "output_operation_slots")[0].status, "queued");
  assert.deepEqual(actual.adaptiveReentryFinancialState(state), before);
  assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(state.organizationId).status, "active");
  if (stage === "admission") {
    assert.equal(rows(state, "organization_deletion_jobs").length, 0);
    assert.equal(state.sqlite.prepare("SELECT status FROM organization_projects WHERE project_access_id=?").get(state.projectAccessId).status, "active");
    assert.ok(rows(state, "project_context_sessions").filter((row) => row.organization_id === state.organizationId).every((row) => row.revoked_at === null));
  } else {
    assert.equal(rows(state, "organization_deletion_jobs")[0].status, "partial");
    assert.ok(rows(state, "project_event_scopes").some((row) => row.organization_id === state.organizationId));
  }
});

test("retention union: verified assistant usage is reconciled, never zeroed, before Output tombstones commit", async (t) => {
  const state = await retainedFixture(t), [review] = await actual.deletionSignedBacklog(state, 1, { verified: true });
  const output = outputPlan(state, "verified-output", { callStatus: "settled", slotStatus: "succeeded" });
  const calls = rows(state, "output_provider_calls");
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  const receipt = actual.consequentialReceipt(state, review.quote.executionId);
  assert.equal(receipt.steps[0].status, "settled"); assert.equal(receipt.tokens[0].used_tokens, 1300); assert.equal(receipt.cost[0].used_microusd, 560);
  assert.deepEqual(actual.consequentialBalances(state, "assistant-owner"), { tokens: { used: 1300, reserved: 0 }, cost: { used: 560, reserved: 0 } });
  assert.deepEqual(rows(state, "output_provider_calls"), calls);
  assert.equal(state.sqlite.prepare("SELECT status FROM output_operation_slots WHERE slot_id=?").get(output.slotId).status, "succeeded");
});

test("retention union: the shared 24-work allowance remains resumable with Output inventory present", { timeout: 30_000 }, async (t) => {
  const state = await retainedFixture(t);
  await actual.deletionSignedBacklog(state, 25, { held: "alternating" });
  const asset = outputAsset(state, "bounded-asset"), bodies = privateBodies(state);
  const first = await deletion(state), pending = await first.json();
  assert.equal(first.status, 503, JSON.stringify(pending));
  assert.equal(pending.status, "partial"); assert.equal(pending.assistantCleanup.requestLimit, 24);
  assert.equal(pending.assistantCleanup.attempted, 24);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_execution_steps WHERE status='not-submitted'").get().n, 24);
  assert.equal(privateBodies(state), bodies); assert.equal(state.deleted.length, 0); assert.equal(state.objects.has(asset.storageKey), true);
  const second = await deletion(state), complete = await second.json();
  assert.equal(second.status, 200, JSON.stringify(complete) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(complete.jobId, pending.jobId);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM consequential_execution_steps WHERE status='not-submitted'").get().n, 25);
  assert.deepEqual(actual.consequentialBalances(state, "assistant-owner"), { tokens: { used: 0, reserved: 0 }, cost: { used: 0, reserved: 0 } });
  assert.deepEqual(state.deleted, [asset.storageKey]);
});


for (const kind of ["adopted", "native"]) for (const field of ["owner", "scope", "document", "hash"]) test("retention union: " + kind + " wrong " + field + " custody never deletes or certifies bytes", async (t) => {
  const state = await retainedFixture(t), scope = outputPlan(state, "custody-output");
  const asset = kind === "native" ? nativeStorage(state, scope) : outputAsset(state, "custody-asset");
  const property = kind === "native" ? { owner: "outputOwnerId", scope: "outputScopeKey", document: "outputDocumentId", hash: "outputSha256" }[field]
    : { owner: "ownerId", scope: "scopeKey", document: "documentId", hash: "sha256" }[field];
  state.objects.get(asset.storageKey).metadata[property] = field === "hash" ? "f".repeat(64) : "another-custodian";
  const bodies = privateBodies(state);
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 503, JSON.stringify(body));
  assert.equal(body.error, "media_owner_mismatch"); assert.equal(body.status, "partial"); assert.equal(body.retryable, true);
  assert.equal(state.deleted.length, 0); assert.equal(state.objects.has(asset.storageKey), true); assert.equal(privateBodies(state), bodies);
  assert.equal(rows(state, "output_execution_grants")[0].status, "authorized");
  assert.equal(rows(state, kind === "native" ? "output_native_storage_writes" : "output_asset_storage_writes")[0].status, "written");
});

for (const kind of ["adopted", "native"]) test("retention union: absent but unacknowledged " + kind + " PUT remains a durable blocker", async (t) => {
  const state = await retainedFixture(t), scope = outputPlan(state, "unknown-storage");
  const asset = kind === "native" ? nativeStorage(state, scope, { status: "cleanup_pending", acknowledged: 0, published: false, objectPresent: false })
    : outputAsset(state, "unknown-asset", { adopted: false, status: "cleanup_pending", acknowledged: 0, published: false, objectPresent: false });
  const before = actual.adaptiveReentryFinancialState(state), bodies = privateBodies(state);
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.error, "provider_submission_in_flight");
  assert.ok(body.outputSlots.some((row) => row.storageCleanupPending));
  const row = rows(state, kind === "native" ? "output_native_storage_writes" : "output_asset_storage_writes")[0];
  assert.equal(row.write_acknowledged, 0); assert.equal(row.status, "cleanup_pending");
  assert.equal(privateBodies(state), bodies); assert.deepEqual(actual.adaptiveReentryFinancialState(state), before);
  assert.equal(rows(state, "organization_deletion_jobs").length, 0); assert.equal(state.deleted.length, 0);
  assert.equal(state.objects.has(asset.storageKey), false, "An absent object is not a settled PUT");
});

test("retention union: unpublished acknowledged cleanup is bounded and reuses the existing storage receipts", async (t) => {
  const state = await retainedFixture(t), originals = [];
  for (let index = 0; index < 3; index++) {
    const scope = outputPlan(state, "cleanup-" + index);
    originals.push(nativeStorage(state, scope, { status: "cleanup_pending", acknowledged: 1, published: false }));
    originals.push(outputAsset(state, "cleanup-asset-" + index, { adopted: false, status: "cleanup_pending", acknowledged: 1, published: false }));
  }
  const before = actual.adaptiveReentryFinancialState(state);
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = state.deleted.length, response = await deletion(state), body = await response.json();
    assert.equal(state.deleted.length - previous, 2, "At most one existing native and one adopted-asset cleanup per request");
    assert.equal(response.status, attempt === 2 ? 200 : 409, JSON.stringify(body));
    assert.deepEqual(actual.adaptiveReentryFinancialState(state), before);
    if (attempt < 2) assert.equal(rows(state, "organization_deletion_jobs").length, 0);
  }
  assert.deepEqual(new Set(state.deleted), new Set(originals.map((asset) => asset.storageKey)));
  assert.ok(rows(state, "output_native_storage_writes").every((row) => row.status === "deleted" && row.write_acknowledged === 1));
  assert.ok(rows(state, "output_asset_storage_writes").every((row) => row.status === "deleted" && row.write_acknowledged === 1));
});

test("retention union: snapshots carry inert Output authority and exact media, and isolated restore remains rollback-only", async (t) => {
  const state = await retainedFixture(t), scope = outputPlan(state, "snapshot-output", { slotStatus: "running", callStatus: "pending" });
  const asset = outputAsset(state, "snapshot-asset"), native = nativeStorage(state, scope);
  const grants = rows(state, "output_execution_grants"), slots = rows(state, "output_operation_slots"), calls = rows(state, "output_provider_calls");
  const created = await recovery(state, { action: "create", confirmation: "CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT" }), body = await created.json();
  assert.equal(created.status, 201, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(body.manifest.outputExecutionRestored, false); assert.equal(body.manifest.outputDeliveryRequiresRevalidation, true);
  assert.equal(body.productionTenantRestoreAvailable, false); assert.equal(body.isolatedRollbackRestoreAvailable, true);
  const saved = state.sqlite.prepare("SELECT * FROM organization_recovery_snapshots WHERE snapshot_id=?").get(body.snapshotId);
  const contents = JSON.parse(await openOrganizationPayload(state.env, state.organizationId, body.snapshotId, saved.key_id, saved.encrypted_payload));
  for (const kind of ["outputPreflights", "outputGrants", "outputSlots", "outputCalls"]) assert.ok(contents.records[kind].every((row) => outputRecoveryRecordIsInert(kind, row)));
  assert.equal(contents.records.outputGrants[0].status, "revoked"); assert.equal(contents.records.outputGrants[0].historical_status, "authorized");
  assert.equal(contents.records.outputSlots[0].status, "uncertain"); assert.equal(contents.records.outputCalls[0].status, "uncertain");
  assert.equal(contents.records.outputAssets[0].asset_id, asset.assetId);
  assert.deepEqual(new Set(contents.media.map((row) => row.key)), new Set([asset.storageKey, native.storageKey]));
  for (const object of contents.media) assert.equal(digest(Buffer.from(object.bytes, "base64")), object.contentSha256);
  const restored = await recovery(state, { action: "restore", snapshotId: body.snapshotId, organizationId: state.organizationId, confirmation: "RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE" });
  const result = await restored.json(); assert.equal(restored.status, 200, JSON.stringify(result) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(result.rollbackVerified, true); assert.equal(result.productionTenantMutated, false); assert.equal(result.objectStorageRestorePerformed, false);
  assert.deepEqual(rows(state, "output_execution_grants"), grants); assert.deepEqual(rows(state, "output_operation_slots"), slots); assert.deepEqual(rows(state, "output_provider_calls"), calls);
  assert.equal(state.deleted.length, 0);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'forma_recovery_rollback_%'").get().n, 0);
});

for (const failure of ["custody", "bytes"]) test("retention union: snapshot refuses Output " + failure + " mismatch", async (t) => {
  const state = await retainedFixture(t), asset = outputAsset(state, "snapshot-mismatch");
  if (failure === "custody") state.objects.get(asset.storageKey).metadata.scopeKey = "foreign";
  else state.objects.get(asset.storageKey).bytes = new TextEncoder().encode("Unrelated actual bytes");
  const created = await recovery(state, { action: "create", confirmation: "CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT" }), body = await created.json();
  assert.equal(created.status, 409, JSON.stringify(body)); assert.equal(body.error, failure === "custody" ? "organization_recovery_output_asset_custody_invalid" : "organization_recovery_media_integrity_failed");
  assert.equal(rows(state, "organization_recovery_snapshots").length, 0); assert.equal(state.deleted.length, 0);
});

test("retention union: authenticated historical snapshot cannot restore a spendable Output grant", async (t) => {
  const state = await retainedFixture(t); outputPlan(state, "restore-inertness");
  const created = await recovery(state, { action: "create", confirmation: "CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT" }), body = await created.json();
  assert.equal(created.status, 201, JSON.stringify(body));
  const saved = state.sqlite.prepare("SELECT * FROM organization_recovery_snapshots WHERE snapshot_id=?").get(body.snapshotId);
  const contents = JSON.parse(await openOrganizationPayload(state.env, state.organizationId, body.snapshotId, saved.key_id, saved.encrypted_payload));
  contents.records.outputGrants[0].status = "authorized";
  const serialized = JSON.stringify(contents), tampered = await sealOrganizationPayload(state.env, state.organizationId, body.snapshotId, serialized);
  state.sqlite.prepare("UPDATE organization_recovery_snapshots SET key_id=?,encrypted_payload=?,content_sha256=? WHERE snapshot_id=?")
    .run(tampered.keyId, tampered.ciphertext, digest(serialized), body.snapshotId);
  const before = rows(state, "output_execution_grants");
  const restored = await recovery(state, { action: "restore", snapshotId: body.snapshotId, organizationId: state.organizationId, confirmation: "RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE" });
  assert.equal(restored.status, 409, JSON.stringify(await restored.clone().json()));
  assert.equal((await restored.json()).error, "organization_recovery_output_authority_must_be_inert");
  assert.deepEqual(rows(state, "output_execution_grants"), before);
  assert.equal(rows(state, "organization_recovery_drills").length, 0);
});

test("retention union: actual admission and final deletion SQL compile at native depth 100", { timeout: 30_000 }, async (t) => {
  const state = await retainedFixture(t);
  await queuedAssistant(state, { held: true });
  outputPlan(state, "depth-output"); outputAsset(state, "depth-asset");
  const depth = enforceD1ExpressionDepth(state);
  try {
    const response = await deletion(state), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
    depth.assertVerified();
    assert.ok(depth.records.some((row) => /INSERT INTO organization_deletion_jobs/u.test(row.sql) && /output_provider_calls/u.test(row.sql) && /consequential_execution_steps/u.test(row.sql)));
    assert.ok(depth.records.some((row) => /AS provider_guard/u.test(row.sql)));
    assert.ok(depth.records.some((row) => /AS output_deletion_guard/u.test(row.sql)));
  } finally { depth.restore(); }
});


test("retention union: unknown Output monetary and token holds remain owned by the original ledgers", async (t) => {
  const state = await retainedFixture(t), scope = outputPlan(state, "held-output", { slotStatus: "running", callStatus: "settled" });
  const projectScope = { organizationId: state.organizationId, projectAccessId: state.projectAccessId, actorUserId: scope.owner };
  const token = await actual.reserveBudget(state.env, scope.owner, 1000, { reservationId: scope.key + "-token", streamId: "creative:" + scope.owner,
    correlationId: scope.key + "-job", operation: "output-requirement", projectScope });
  assert.equal(token.ok, true);
  const cost = await actual.reserveCostBudget(state.env, scope.owner, 1000, { reservationId: scope.key + "-cost", streamId: "creative:" + scope.owner,
    correlationId: scope.key + "-job", operation: "output-requirement", maximumMicrousd: 1000, allowUserOverage: false, projectScope });
  assert.equal(cost.ok, true);
  assert.equal(await actual.claimCostBudgetReservation(state.env, scope.owner, scope.key + "-cost"), true);
  state.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain',used_microusd=NULL,settled_at=NULL WHERE scope_key=?").run(scope.key);
  const before = actual.adaptiveReentryFinancialState(state), bodies = privateBodies(state);
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body)); assert.equal(body.error, "provider_submission_in_flight");
  assert.ok(body.outputSlots.some((row) => row.slotId === scope.slotId));
  assert.ok(body.costReservations.some((row) => row.reservationId === scope.key + "-cost"));
  assert.deepEqual(actual.adaptiveReentryFinancialState(state), before); assert.equal(privateBodies(state), bodies);
  assert.equal(state.sqlite.prepare("SELECT status FROM budget_reservations WHERE reservation_id=?").get(scope.key + "-token").status, "active");
  assert.equal(state.sqlite.prepare("SELECT status FROM cost_budget_reservations WHERE reservation_id=?").get(scope.key + "-cost").status, "executing");
  assert.equal((await organizationOutputSubmissionBlockers(state.env, state.organizationId)).length, 1);
});

test("retention union: another real organization and unscoped personal Output stay outside the deletion", async (t) => {
  const state = await retainedFixture(t);
  const otherResponse = await state.request("/api/workspaces", actual.json({ name: "Other retained organization" }));
  assert.equal(otherResponse.status, 201); const otherOrganizationId = (await otherResponse.json()).organizationId;
  const projectResponse = await state.request("/api/workspaces/" + otherOrganizationId + "/projects", actual.json({ projectId: "project-atmosphere" }));
  assert.equal(projectResponse.status, 201, JSON.stringify(await projectResponse.clone().json()));
  const otherAccessId = (await projectResponse.json()).projectAccessId;
  const foreign = outputPlan(state, "foreign-output", { organizationId: otherOrganizationId, projectAccessId: otherAccessId,
    owner: "dev-local-creative", slotStatus: "uncertain", callStatus: "pending" });
  const theirs = outputAsset(state, "foreign-asset", { scope: foreign, organizationId: otherOrganizationId, projectAccessId: otherAccessId, owner: "dev-local-creative" });
  const personal = outputAsset(state, "personal-asset", { organizationId: null, projectAccessId: null, projectId: "personal-project", documentId: "personal-doc" });
  const ours = outputAsset(state, "owned-asset");
  const otherBytes = state.objects.get(theirs.storageKey), personalBytes = state.objects.get(personal.storageKey);
  const beforeForeign = state.sqlite.prepare("SELECT * FROM output_execution_grants WHERE scope_key=?").get(foreign.key);
  const response = await deletion(state), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  assert.deepEqual(state.deleted, [ours.storageKey]); assert.equal(body.receipt.removedOutputAssets, 1);
  assert.deepEqual(state.objects.get(theirs.storageKey), otherBytes); assert.deepEqual(state.objects.get(personal.storageKey), personalBytes);
  assert.equal(state.sqlite.prepare("SELECT redacted_at FROM output_assets WHERE asset_id=?").get(theirs.assetId).redacted_at, null);
  assert.equal(state.sqlite.prepare("SELECT redacted_at FROM output_assets WHERE asset_id=?").get(personal.assetId).redacted_at, null);
  assert.deepEqual(state.sqlite.prepare("SELECT * FROM output_execution_grants WHERE scope_key=?").get(foreign.key), beforeForeign);
  assert.equal(state.sqlite.prepare("SELECT status FROM organizations WHERE organization_id=?").get(otherOrganizationId).status, "active");
  assert.ok(rows(state, "event_private_payloads").some((row) => row.private_event_id === personal.eventId && row.private_json.includes(fixtureSecret)));
});

for (const stage of ["admission", "finalization"]) test("retention union: existing assistant and Output guards both remain active at " + stage, async (t) => {
  const state = await retainedFixture(t), assistant = await queuedAssistant(state, { held: true });
  outputPlan(state, "assistant-race");
  const original = actual.consequentialReceipt(state, assistant.task.id), bodies = privateBodies(state);
  let fired = false;
  const restore = actual.interceptConsequentialDb(state, "batch", stage === "admission" ? /^\s*INSERT INTO organization_deletion_jobs/u : /AS provider_guard/u, () => {
    fired = true;
    state.sqlite.prepare("UPDATE consequential_execution_steps SET status='uncertain',verified_tokens=NULL,verified_microusd=NULL,provider_request_id=NULL WHERE execution_id=?").run(assistant.task.id);
    state.sqlite.prepare("UPDATE consequential_executions SET status='uncertain' WHERE execution_id=?").run(assistant.task.id);
  });
  t.after(restore);
  const response = await deletion(state), body = await response.json();
  assert.equal(fired, true); assert.equal(response.status, 409, JSON.stringify(body) + " SQL: " + state.controls.lastDatabaseError);
  assert.equal(body.error, "provider_submission_in_flight"); assert.ok(body.assistantTasks.some((row) => row.taskId === assistant.task.id));
  assert.equal(privateBodies(state), bodies);
  assert.equal(rows(state, "output_execution_grants")[0].status, "authorized");
  assert.equal(rows(state, "output_operation_slots")[0].status, "queued");
  if (stage === "admission") {
    const after = actual.consequentialReceipt(state, assistant.task.id);
    assert.deepEqual(after.tokens, original.tokens); assert.deepEqual(after.cost, original.cost);
    assert.equal(rows(state, "organization_deletion_jobs").length, 0);
  } else assert.equal(rows(state, "organization_deletion_jobs")[0].status, "partial");
});
