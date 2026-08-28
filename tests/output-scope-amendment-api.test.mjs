import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";

const hooks = registerOutputSourceImports();
const { handleOutputRequirements } = await import("../worker/output-requirements-api.ts");
const { ensureSchema, appendEvents, makeEvent } = await import("../worker/runtime.ts");
const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
const { OUTPUT_PREFLIGHT_TARGET_MAX_COUNT } = await import("../src/model/output-delivery-contract.ts");
const { OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH } = await import("../src/model/output-scope-amendment.ts");
const { png, readStoredZip } = await import("./output-asset-fixtures.mjs");
hooks.deregister();

const originalFetch = globalThis.fetch;
let externalRequests = 0;
test.before(() => { globalThis.fetch = async () => { externalRequests++; throw new Error("amendment_test_external_request_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(externalRequests, 0); });

const owner = "dev-local-creative", project = "reason-test-project", doc = "reason-test-document", base = "/api/output-requirements";
const historyUnavailable = "output_scope_history_reason_unverified";
const validReason = "  Audience decisions — café 日本 🧪\r\nKeep the square placement.\tWithdraw the feed.  ";

async function fixture(t) {
  const state = outputTestDatabase();
  t.after(() => state.sqlite.close());
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(owner, "reason-test@example.invalid", "Fictional author", now, now, now);
  await appendEvents(state.env, [
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "reason-seed", "ProjectCreated", { project_id: project, name: "Fictional reason project" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "reason-seed", "DocumentCreated", { project_id: project, document_id: doc, title: "Reason contract test", handle: "reason-contract" }),
    makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "reason-seed", "BlockCreated", { project_id: project, document_id: doc, block_id: "reason-source", scope: "document", type: "direction", position: "a0", handle: "direction/reason-source", properties: { text: "Fictional evidence for a private local test.", authority: "authored", weight: 1 } }),
  ]);
  const execution = { waitUntil() { throw new Error("amendment_test_background_work_forbidden"); } };
  const send = (path = `${base}?documentId=${doc}`, options = {}) => handleOutputRequirements(new Request(`http://localhost${path}`, options), state.env, path.split("?")[0], execution);
  const snapshot = async () => { const response = await send(); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  let ordinal = 0;
  const command = async (body, expected = 200) => {
    const current = await snapshot();
    const response = await send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: doc, expectedRevision: current.revision, clientMutationId: `reason-mutation-${++ordinal}`, ...body }) });
    const value = await response.json();
    assert.equal(response.status, expected, JSON.stringify(value));
    return value;
  };
  const upload = async () => {
    const current = await snapshot();
    const response = await send(`${base}/assets?documentId=${doc}`, { method: "POST", headers: { "content-type": "image/png", "x-output-filename": "fictional-square.png", "x-output-rights-confirmed": "true", "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `reason-upload-${++ordinal}` }, body: png({ width: 2, height: 2 }) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const durableState = () => {
    const tables = ["events", "output_commands", "output_plan_revisions", "output_assets", "output_results", "output_target_acceptances", "output_delivery_manifests", "document_jobs", "output_execution_grants"];
    return Object.fromEntries(tables.map((table) => [table, state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  };
  return { ...state, send, snapshot, command, upload, durableState };
}

function imageSpec() {
  const spec = parseOutputRequirement({ id: "reason-images", type: "output", subtype: "Social media image", content: 'Output images at ratios "1:1" square and "4:5" feed.' }).spec;
  for (const variant of spec.deliverables[0].format_variants) variant.quantity = { kind: "exact", unit: "image", value: 1 };
  return spec;
}

async function pendingWithdrawal(t, savedReason) {
  const state = await fixture(t), spec = imageSpec();
  await state.command({ action: "save", blockId: spec.id, spec });
  const initial = await state.command({ action: "confirm" });
  const reduced = structuredClone(spec);
  reduced.deliverables[0].format_variants.splice(1, 1);
  await state.command({ action: "save", blockId: reduced.id, spec: reduced, ...(savedReason === undefined ? {} : { amendmentReason: savedReason }) });
  return { ...state, spec, reduced, initialPlan: initial.snapshot.confirmedPlan };
}

async function acceptedAmendment(t, reason = validReason) {
  const state = await pendingWithdrawal(t, reason);
  const confirmed = await state.command({ action: "confirm", amendmentReason: reason });
  const plan = confirmed.snapshot.confirmedPlan, target = plan.plan.targets[0];
  const uploaded = await state.upload();
  const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId: uploaded.command.assetId });
  const reviewed = await state.command({ action: "review", resultId: bound.command.resultId, decision: "approve", reviewedCoverage: true, reviewedRights: true });
  return { ...state, plan, target, assetId: uploaded.command.assetId, acceptanceId: reviewed.command.acceptanceId };
}

function retainedPlanBody(state, revisionId) {
  return state.sqlite.prepare("SELECT body.private_event_id,body.private_json FROM output_plan_revisions plan JOIN event_private_payloads body ON body.private_event_id=plan.confirmed_event_id WHERE plan.plan_revision_id=?").get(revisionId);
}

function seedLegacyReason(state, revisionId, reason) {
  // Deliberately seed a pre-fix retained payload in this isolated SQLite fixture.
  // Production handlers never edit historical events or private history bodies.
  const row = retainedPlanBody(state, revisionId), payload = JSON.parse(row.private_json);
  payload.scope_amendment.reason = reason;
  const raw = JSON.stringify(payload);
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(raw, row.private_event_id);
  return { ...row, raw };
}

async function unpack(response) {
  assert.equal(response.status, 200, await response.clone().text());
  const files = readStoredZip(new Uint8Array(await response.arrayBuffer()));
  return { files, manifest: JSON.parse(new TextDecoder().decode(files.get("manifest.json"))), csv: new TextDecoder().decode(files.get("manifest.csv")) };
}

test("valid raw multiline Unicode amendment survives Save, Confirm and the actual ZIP unchanged", async (t) => {
  const state = await acceptedAmendment(t);
  const savedReason = state.sqlite.prepare("SELECT body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.type='BlockPropertyEdited' AND json_extract(event.payload,'$.property_path')='output_amendment_reason' ORDER BY event.sequence DESC LIMIT 1").get();
  assert.equal(JSON.parse(savedReason.private_json).new_value, validReason);
  assert.equal(JSON.parse(retainedPlanBody(state, state.plan.revisionId).private_json).scope_amendment.reason, validReason);
  const snapshot = await state.snapshot();
  assert.equal(snapshot.summary.delivery_ready, true);
  assert.equal(snapshot.scopeAmendments[0].reason, validReason);
  const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const packed = await unpack(await state.send(prepared.command.downloadUrl));
  assert.equal(packed.manifest.deliveryStatus, "complete_for_amended_scope");
  assert.equal(packed.manifest.scopeAmendments[0].reason, validReason);
  assert.equal(packed.manifest.scopeAmendments[0].withdrawnTargets.length, 1);
  assert.equal(packed.manifest.files.length, 1);
  assert.equal(state.durableState().document_jobs, 0);
  assert.equal(state.durableState().output_execution_grants, 0);
});

test("invalid Save reasons do not commit edits or alter the saved draft and reason", async (t) => {
  const state = await pendingWithdrawal(t, validReason), before = await state.snapshot(), durable = state.durableState();
  const modified = structuredClone(state.reduced); modified.label = "Uncommitted replacement label";
  const cases = [
    [null, "invalid_output_scope_amendment_reason"], [17, "invalid_output_scope_amendment_reason"],
    ["a".repeat(OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH + 1), "output_scope_amendment_reason_too_long"],
    ["Withheld.\u202E", "output_scope_amendment_reason_control_characters"],
    ["Family 👨‍👩‍👧", "output_scope_amendment_reason_control_characters"],
    ["\uFEFF", "output_scope_amendment_reason_control_characters"],
    ["\u000b", "output_scope_amendment_reason_control_characters"],
    ["No NUL\u0000", "output_scope_amendment_reason_control_characters"],
  ];
  for (const [amendmentReason, code] of cases) {
    const request = { action: "save", blockId: modified.id, spec: modified, amendmentReason }, original = structuredClone(request);
    const denied = await state.command(request, 400);
    assert.equal(denied.errorCode, code);
    assert.deepEqual(request, original, "the author-held draft is not normalized or mutated");
    assert.deepEqual(state.durableState(), durable);
    assert.deepEqual(await state.snapshot(), before);
  }
});

test("invalid Confirm reasons preserve the reduced draft and previous confirmed obligation account", async (t) => {
  const state = await pendingWithdrawal(t), before = await state.snapshot(), durable = state.durableState();
  for (const amendmentReason of ["Rejected\u202E", "Joined 👨‍👩‍👧", "\uFEFF", "\u000c", "a".repeat(2001), null]) {
    const denied = await state.command({ action: "confirm", amendmentReason }, 400);
    assert.match(denied.errorCode, /^(?:invalid_output_scope_amendment_reason|output_scope_amendment_reason_(?:control_characters|too_long))$/u);
    assert.deepEqual(state.durableState(), durable);
    const current = await state.snapshot();
    assert.deepEqual(current.requirements, before.requirements);
    assert.equal(current.confirmedPlan.revisionId, state.initialPlan.revisionId);
    assert.equal(current.confirmedPlan.plan.targets.length, 2);
  }
  for (const amendmentReason of [undefined, "", " \t\r\n "]) {
    const denied = await state.command({ action: "confirm", ...(amendmentReason === undefined ? {} : { amendmentReason }) }, 409);
    assert.equal(denied.errorCode, "output_scope_amendment_reason_required");
    assert.equal(denied.withdrawnTargetIds.length, 1);
    assert.deepEqual(state.durableState(), durable);
  }
});

test("the shared UTF-16 reason limit permits exactly 2000 units without trimming", async (t) => {
  const reason = `🧪${"x".repeat(OUTPUT_SCOPE_AMENDMENT_REASON_MAX_LENGTH - 2)}`;
  assert.equal(reason.length, 2000);
  const state = await acceptedAmendment(t, reason);
  const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const packed = await unpack(await state.send(prepared.command.downloadUrl));
  assert.equal(packed.manifest.scopeAmendments[0].reason, reason);
});

test("omitting a draft reason preserves it and explicit valid whitespace clears only that draft field", async (t) => {
  const state = await pendingWithdrawal(t, validReason);
  const query = () => state.sqlite.prepare("SELECT body.private_json FROM events event JOIN event_private_payloads body ON body.private_event_id=event.event_id WHERE event.type='BlockPropertyEdited' AND json_extract(event.payload,'$.property_path')='output_amendment_reason' ORDER BY event.sequence DESC").all();
  const before = query();
  await state.command({ action: "save", blockId: state.reduced.id, spec: state.reduced });
  assert.deepEqual(query(), before);
  await state.command({ action: "save", blockId: state.reduced.id, spec: state.reduced, amendmentReason: " \t\r\n " });
  assert.equal(JSON.parse(query()[0].private_json).new_value, "");
  assert.equal(JSON.parse(query()[1].private_json).new_value, validReason);
});

for (const [name, reason] of [["bidi format control", "Legacy reason\u202E"], ["joined emoji", "Legacy family 👨‍👩‍👧"]]) test(`legacy ${name} blocks full/partial packages and later reconfirmation cannot hide it`, async (t) => {
  const state = await acceptedAmendment(t), previouslyReady = await state.snapshot(), legacy = seedLegacyReason(state, state.plan.revisionId, reason);
  const before = state.durableState(), snapshot = await state.snapshot();
  assert.equal(snapshot.sourceVerification.status, "verified");
  assert.deepEqual(snapshot.sourceVerification, previouslyReady.sourceVerification);
  assert.deepEqual(snapshot.permissions, previouslyReady.permissions);
  assert.deepEqual(snapshot.targetStates, previouslyReady.targetStates);
  assert.ok(snapshot.capabilities.limitationCodes.includes(historyUnavailable));
  assert.equal(snapshot.summary.delivery_ready, false);
  assert.equal(snapshot.summary.completion, "unknown");
  assert.equal(snapshot.summary.scope_known, true);
  assert.equal(snapshot.summary.fulfilled_targets, 1);
  assert.equal(snapshot.requirementSummaries[state.spec.id].delivery_ready, false);
  assert.equal(snapshot.requirementSummaries[state.spec.id].completion, "unknown");
  assert.equal(snapshot.requirementFileCounts[state.spec.id], 1);
  assert.equal(snapshot.assets[0].available, true);
  assert.equal(snapshot.results[0].review, "approved");
  assert.equal(snapshot.results[0].reviewAllowed, previouslyReady.results[0].reviewAllowed);
  assert.equal(snapshot.capabilities.ownedFileAdoption, true);
  assert.equal(snapshot.scopeAmendments[0].reason, reason);
  for (const allowPartial of [false, true]) {
    const denied = await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial }, 409);
    assert.equal(denied.errorCode, historyUnavailable);
    assert.deepEqual(state.durableState(), before);
  }
  assert.equal((await state.send(snapshot.assets[0].downloadUrl)).status, 200, "owned file inspection remains available under current rights");
  const continued = await state.command({ action: "confirm" }), next = continued.snapshot.confirmedPlan;
  await state.command({ action: "bind", planRevisionId: next.revisionId, targetId: state.target.id, acceptanceId: state.acceptanceId });
  const denied = await state.command({ action: "export", planRevisionId: next.revisionId, allowPartial: true }, 409);
  assert.equal(denied.errorCode, historyUnavailable);
  assert.equal((await state.snapshot()).summary.delivery_ready, false);
  assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(legacy.private_event_id).private_json, legacy.raw);
  assert.equal(state.durableState().output_delivery_manifests, 0);
  assert.equal(state.media.size, 1);
});

test("a retained invalid reason blocks an already prepared part without deleting its exact files", async (t) => {
  const state = await acceptedAmendment(t), prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const legacy = seedLegacyReason(state, state.plan.revisionId, "Old retained reason\u202E"), before = state.durableState();
  const response = await state.send(prepared.command.downloadUrl);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, historyUnavailable);
  assert.deepEqual(state.durableState(), before);
  assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(legacy.private_event_id).private_json, legacy.raw);
  const snapshot = await state.snapshot();
  assert.equal((await state.send(snapshot.assets[0].downloadUrl)).status, 200);
  assert.equal(state.media.size, 1);
});

test("an invalid reason pinned only in a legacy manifest produces a precise download conflict", async (t) => {
  const state = await acceptedAmendment(t), prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const row = state.sqlite.prepare("SELECT body.private_event_id,body.private_json FROM output_delivery_manifests manifest JOIN event_private_payloads body ON body.private_event_id=manifest.event_id WHERE manifest.manifest_id=?").get(prepared.command.manifestId);
  const payload = JSON.parse(row.private_json);
  payload.manifest.scopeAmendments[0].reason = "Legacy package 👨‍👩‍👧";
  const raw = JSON.stringify(payload);
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(raw, row.private_event_id);
  const before = state.durableState(), response = await state.send(prepared.command.downloadUrl);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, historyUnavailable);
  assert.deepEqual(state.durableState(), before);
  assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(row.private_event_id).private_json, raw);
  assert.equal(JSON.parse(retainedPlanBody(state, state.plan.revisionId).private_json).scope_amendment.reason, validReason);
  assert.equal(state.media.size, 1);
});

test("a prepared legacy manifest without history fields cannot bypass an invalid retained ancestor", async (t) => {
  const state = await acceptedAmendment(t), prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  const row = state.sqlite.prepare("SELECT body.private_event_id,body.private_json FROM output_delivery_manifests manifest JOIN event_private_payloads body ON body.private_event_id=manifest.event_id WHERE manifest.manifest_id=?").get(prepared.command.manifestId);
  const payload = JSON.parse(row.private_json);
  delete payload.manifest.scopeHistoryComplete;
  delete payload.manifest.scopeAmendments;
  const raw = JSON.stringify(payload);
  state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(raw, row.private_event_id);
  const legacy = seedLegacyReason(state, state.plan.revisionId, "Unportable old reason\u202E"), before = state.durableState();
  const response = await state.send(prepared.command.downloadUrl);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errorCode, historyUnavailable);
  assert.deepEqual(state.durableState(), before);
  assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(legacy.private_event_id).private_json, legacy.raw);
  assert.equal(state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(row.private_event_id).private_json, raw);
});

test("another Document's or project's history cannot poison this Document's package readiness", async (t) => {
  const state = await acceptedAmendment(t);
  for (const [projectId, documentId] of [[project, "unrelated-document"], ["unrelated-project", doc]]) {
    await appendEvents(state.env, [makeEvent(`creative:${owner}`, 0, `user:${owner}`, "test", "unrelated-retained-history", "OutputPlanConfirmed", { project_id: projectId, document_id: documentId, scope_amendment: { reason: "Unrelated historical reason\u202E" } })]);
  }
  const snapshot = await state.snapshot();
  assert.equal(snapshot.summary.delivery_ready, true);
  assert.equal(snapshot.scopeAmendments.length, 1);
  assert.ok(!snapshot.capabilities.limitationCodes.includes(historyUnavailable));
  const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  assert.equal((await unpack(await state.send(prepared.command.downloadUrl))).manifest.deliveryStatus, "complete_for_amended_scope");
});

test("valid reason checking never bypasses a current source erasure before confirmation commits", async (t) => {
  const state = await pendingWithdrawal(t), before = state.durableState(), originalBatch = state.DB.batch.bind(state.DB);
  let erased = false;
  state.DB.batch = async (statements) => {
    if (!erased && statements.some((statement) => statement.sql.includes("INSERT INTO output_commands") && statement.bindings.includes("confirm"))) {
      erased = true;
      state.sqlite.prepare("UPDATE event_private_payloads SET private_json='',redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')='reason-source')").run(new Date().toISOString());
    }
    return originalBatch(statements);
  };
  const denied = await state.command({ action: "confirm", amendmentReason: validReason }, 409);
  assert.ok(erased);
  assert.notEqual(denied.errorCode, historyUnavailable);
  assert.deepEqual(state.durableState(), before);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM event_private_payloads WHERE redacted_at IS NULL AND private_json LIKE '%Keep the square placement.%'").get().count, 0);
});

test("server preflight uses the shared 256-target bound without erasing the full 257-target plan", async (t) => {
  const state = await fixture(t), spec = imageSpec();
  assert.equal(OUTPUT_PREFLIGHT_TARGET_MAX_COUNT, 256);
  spec.deliverables[0].format_variants.splice(1, 1);
  spec.deliverables[0].format_variants[0].quantity.value = OUTPUT_PREFLIGHT_TARGET_MAX_COUNT + 1;
  await state.command({ action: "save", blockId: spec.id, spec });
  const confirmed = await state.command({ action: "confirm" }), plan = confirmed.snapshot.confirmedPlan;
  assert.equal(plan.plan.targets.length, 257);
  const selected = plan.plan.targets.map((target) => target.id);
  const valid = await state.command({ action: "preflight", planRevisionId: plan.revisionId, targetIds: selected.slice(0, OUTPUT_PREFLIGHT_TARGET_MAX_COUNT) });
  assert.equal(valid.command.preflight.targets.length, OUTPUT_PREFLIGHT_TARGET_MAX_COUNT);
  assert.ok(valid.command.preflight.targets.every((target) => !target.available));
  const before = state.durableState();
  const denied = await state.command({ action: "preflight", planRevisionId: plan.revisionId, targetIds: selected }, 409);
  assert.equal(denied.errorCode, "finite_target_selection_required");
  assert.deepEqual(state.durableState(), before);
  assert.equal((await state.snapshot()).confirmedPlan.plan.targets.length, 257);
});
