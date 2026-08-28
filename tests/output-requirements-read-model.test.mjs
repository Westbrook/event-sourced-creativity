import assert from "node:assert/strict";
import test from "node:test";
import { registerScalingSourceImports, measureOutputBindings } from "./output-read-model-test-helpers.mjs";
const imports = registerScalingSourceImports();
const { outputTestDatabase } = await import("./output-server-test-helpers.mjs");
const { ensureSchema, makeEvent, appendEvents, readEvents } = await import("../worker/runtime.ts");
const { handleOutputRequirements, loadOutputTrustedContext, rememberOutputPrivateBody, outputReviewEligibility } = await import("../worker/output-requirements-api.ts");
const { readOutputReadModel, readOutputCustodyInventory, outputBulkDeliveryAssertion, MAX_OUTPUT_LEGACY_CUSTODY_READS } = await import("../worker/output-requirements-read-model.ts");
const { outputAssertionStatements } = await import("../worker/output-requirements-ledger.ts");
const { outputAssetDocumentPrefix, outputAssetObjectKeys, outputAssetStorageCustodyMatches } = await import("../worker/output-asset-storage-identity.ts");
const { parseOutputRequirement } = await import("../src/model/output-requirements.ts");
const { inspectOutputAsset } = await import("../src/model/output-asset-inspection.ts");
const { png, readStoredZip } = await import("./output-asset-fixtures.mjs");
imports.deregister();

const originalFetch = globalThis.fetch;
let providerCalls = 0;
test.before(() => { globalThis.fetch = async () => { providerCalls++; throw new Error("provider_calls_disabled"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(providerCalls, 0); });

const owner = "dev-local-creative", project = "scaling-project", doc = "scaling-document", base = "/api/output-requirements";
const scope = { kind: "personal", key: `personal:${owner}:${project}`, ownerUserId: owner, actorUserId: owner, projectId: project, documentId: doc, organizationId: null, projectAccessId: null, contextId: null };

function readOptions(trusted) {
  return {
    rememberPrivateBody: (id, raw) => rememberOutputPrivateBody(trusted.scope, id, raw),
    reviewEligibility: (resultAuthor, assetAuthor, origin) => outputReviewEligibility(trusted.scope, trusted.principal, resultAuthor, assetAuthor, origin),
    storagePrefixes: () => [outputAssetDocumentPrefix(trusted.scope)],
    legacyStorageKeys: (rows) => rows.filter((row) => row.storage_key === outputAssetObjectKeys(trusted.scope, row.asset_id, row.content_sha256, row.storage_key.split(".").at(-1)).legacyKey).map((row) => row.storage_key),
    storageIdentityMatches: (row, _inspection, object) => outputAssetStorageCustodyMatches({ ownerUserId: owner, projectId: project, documentId: doc, assetId: row.asset_id, scopeKey: scope.key, sha256: row.content_sha256, storageKey: row.storage_key }, object.customMetadata),
  };
}

async function fixture(count, { grants = true } = {}) {
  const state = outputTestDatabase();
  await ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${owner}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)").run(owner, "creative@local.forma", "Local creative", now, now, now);
  await appendEvents(state.env, [
    makeEvent(stream, 0, `user:${owner}`, "scaling", "seed", "ProjectCreated", { project_id: project, name: "Output bulk-read tests" }),
    makeEvent(stream, 0, `user:${owner}`, "scaling", "seed", "DocumentCreated", { project_id: project, document_id: doc, title: "One full output assignment", handle: "scaling-document" }),
    makeEvent(stream, 0, `user:${owner}`, "scaling", "seed", "BlockCreated", { project_id: project, document_id: doc, block_id: "source", scope: "document", type: "direction", position: "a0", handle: "direction/source", properties: { text: "One authored, retained source.", authority: "authored", weight: 1 } }),
  ]);
  const counters = measureOutputBindings(state, { pageSize: 250 });
  const execution = { waitUntil() { throw new Error("unexpected_background_dispatch"); } };
  const send = (path = `${base}?documentId=${doc}`, init = {}) => handleOutputRequirements(new Request(`http://localhost${path}`, init), state.env, path.split("?")[0], execution);
  let mutation = 0;
  const snapshot = async () => { const response = await send(); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const command = async (body) => {
    const expectedRevision = `output:${state.sqlite.prepare("SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?").get(stream).head}`;
    return send(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: doc, clientMutationId: `scaling-${++mutation}`, expectedRevision, ...body }) });
  };
  const spec = parseOutputRequirement({ id: "images-output", type: "output", subtype: "Social media image", content: 'Output images at aspect ratio "1:1".' }).spec;
  spec.deliverables[0].format_variants = [spec.deliverables[0].format_variants[0]];
  spec.deliverables[0].format_variants[0].quantity = { kind: "exact", unit: "image", value: count };
  const saved = await command({ action: "save", blockId: spec.id, spec }); assert.equal(saved.status, 200, await saved.clone().text());
  const confirmed = await command({ action: "confirm" }); assert.equal(confirmed.status, 200, await confirmed.clone().text());
  const plan = (await confirmed.json()).snapshot.confirmedPlan;
  assert.equal(plan.plan.targets.length, count);
  const entries = [], events = [], assets = [];
  const event = (type, payload) => { const value = makeEvent(stream, 0, `user:${owner}`, "scaling", "bulk-seed", type, { project_id: project, document_id: doc, actor_user_id: owner, ...payload }); events.push(value); return value; };
  for (const [index, target] of plan.plan.targets.entries()) {
    const bytes = png({ width: index + 2, height: index + 2 }), name = `accepted-${index}.png`, inspection = await inspectOutputAsset(bytes, name);
    assert.equal(inspection.status, "inspected");
    const id = `asset-${index}`, resultId = `result-${index}`, acceptanceId = `acceptance-${index}`;
    const keys = outputAssetObjectKeys(scope, id, inspection.sha256, inspection.extension);
    await state.env.MEDIA.put(keys.key, bytes, { httpMetadata: { contentType: inspection.mimeType }, customMetadata: { ownerId: owner, projectId: project, documentId: doc, scopeKey: scope.key, assetId: id, sha256: inspection.sha256, mimeType: inspection.mimeType, outputRequirementAsset: "1" } });
    const created = event("OutputAssetAdopted", { asset_id: id, asset: { id, name, inspection, origin: { kind: "owned_upload", rightsAttestedBy: owner, rightsAttestedAt: now }, sourceDigest: plan.sourceDigest } });
    const result = { id: resultId, targetId: target.id, planRevisionId: plan.revisionId, assetId: id, resultRevision: inspection.sha256, targetContractDigest: plan.targetContractDigests[target.id], sourceDigest: plan.sourceDigest, sha256: inspection.sha256, checksStatus: "passed", checks: ["actual_png", "exact_authored_aspect_ratio"], problems: [], createdByUserId: owner, createdAt: now };
    const bound = event("OutputResultBound", { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, asset_id: id, result });
    const accepted = event("OutputTargetAccepted", { result_id: resultId, target_id: target.id, plan_revision_id: plan.revisionId, acceptance_id: acceptanceId, content_sha256: inspection.sha256, result_revision: inspection.sha256, target_contract_digest: plan.targetContractDigests[target.id], source_digest: plan.sourceDigest, validation_policy: "output-owned-file-v1", reviewed_coverage: true, reviewed_rights: true, reviewer_user_id: owner, note: "Actual fixture file reviewed for this contract." });
    assets.push({ id, resultId, acceptanceId, target, inspection, created, bound, accepted, key: keys.key });
    entries.push({ targetId: target.id, assetId: id, acceptanceId, resultId, resultRevision: inspection.sha256, sha256: inspection.sha256, targetContractDigest: plan.targetContractDigests[target.id] });
  }
  let preflightEvent, authorizationEvent;
  if (grants) {
    const preflight = { id: "grant-preflight", planRevisionId: plan.revisionId, termsDigest: "retained-terms", sourceDigest: plan.sourceDigest, requirementsDigest: plan.requirementsDigest, targets: [], maximumMicrousd: count * 1000, maximumCalls: count, expiresAt: "2099-01-01T00:00:00.000Z", createdAt: now, operationAttempts: {} };
    preflightEvent = event("OutputPlanPreflighted", { preflight_id: preflight.id, plan_revision_id: plan.revisionId, preflight });
    authorizationEvent = event("OutputExecutionAuthorized", { preflight_id: preflight.id, plan_revision_id: plan.revisionId, grant_id: "history-grant" });
  }
  await appendEvents(state.env, events);
  state.sqlite.exec("BEGIN");
  try {
    for (const value of assets) {
      const { id, resultId, acceptanceId, target, inspection, created, bound, accepted, key } = value;
      state.sqlite.prepare("INSERT INTO output_assets(scope_key,asset_id,document_id,owner_user_id,created_by_user_id,source_digest,storage_key,content_sha256,byte_length,mime_type,media_kind,created_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, id, doc, owner, owner, plan.sourceDigest, key, inspection.sha256, inspection.byteLength, inspection.mimeType, "image", created.eventId, now);
      state.sqlite.prepare("INSERT INTO output_results(scope_key,result_id,document_id,plan_revision_id,target_id,target_contract_digest,source_digest,asset_id,result_revision,content_sha256,validation_policy,checks_status,created_by_user_id,bound_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, resultId, doc, plan.revisionId, target.id, plan.targetContractDigests[target.id], plan.sourceDigest, id, inspection.sha256, inspection.sha256, "output-owned-file-v1", "passed", owner, bound.eventId, now);
      state.sqlite.prepare("INSERT INTO output_target_acceptances(scope_key,acceptance_id,target_id,target_contract_digest,result_id,result_revision,content_sha256,source_digest,validation_policy,reviewer_user_id,approval_event_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, acceptanceId, target.id, plan.targetContractDigests[target.id], resultId, inspection.sha256, inspection.sha256, plan.sourceDigest, "output-owned-file-v1", owner, accepted.eventId, now);
      state.sqlite.prepare("INSERT INTO output_plan_fulfillments(scope_key,plan_revision_id,target_id,acceptance_id,eligibility_event_id,checked_at) VALUES(?,?,?,?,?,?)").run(scope.key, plan.revisionId, target.id, acceptanceId, accepted.eventId, now);
    }
    if (grants) {
      state.sqlite.prepare("INSERT INTO output_preflights(scope_key,preflight_id,plan_revision_id,actor_user_id,terms_digest,event_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)").run(scope.key, "grant-preflight", plan.revisionId, owner, "retained-terms", preflightEvent.eventId, "2099-01-01T00:00:00.000Z", now);
      state.sqlite.prepare("INSERT INTO output_execution_grants(scope_key,grant_id,plan_revision_id,actor_user_id,payer_user_id,preflight_id,authorization_event_id,maximum_microusd,maximum_calls,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, "history-grant", plan.revisionId, owner, owner, "grant-preflight", authorizationEvent.eventId, count * 1000, count, "active", "2099-01-01T00:00:00.000Z", now);
      for (const [index, target] of plan.plan.targets.entries()) {
        const slot = `slot-${index}`;
        state.sqlite.prepare("INSERT INTO output_operation_slots(scope_key,slot_id,grant_id,plan_revision_id,target_id,target_contract_digest,source_digest,provider,model,route_digest,job_id,cost_reservation_id,token_reservation_id,maximum_microusd,maximum_calls,maximum_tokens,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, slot, "history-grant", plan.revisionId, target.id, plan.targetContractDigests[target.id], plan.sourceDigest, "test-provider-not-called", "fixture", "fixture-route", `job-${index}`, `cost-${index}`, `tokens-${index}`, 1000, 1, 100, index % 2 ? "uncertain" : "succeeded", now, now);
        state.sqlite.prepare("INSERT INTO output_operation_routes(scope_key,slot_id,stage_key,provider,model,maximum_calls) VALUES(?,?,?,?,?,?)").run(scope.key, slot, "initial", "test-provider-not-called", "fixture", 1);
        state.sqlite.prepare("INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,used_microusd,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(scope.key, slot, `call-${index}`, `request-${index}`, `digest-${index}`, "initial", "test-provider-not-called", "fixture", 1000, index % 2 ? null : 400, index % 2 ? "uncertain" : "settled", now);
      }
    }
    state.sqlite.exec("COMMIT");
  } catch (error) { state.sqlite.exec("ROLLBACK"); throw error; }
  counters.reset();
  return { ...state, send, snapshot, command, counters, plan, assets, entries };
}

for (const count of [65, 1000]) test(`${count} accepted metadata rows and grants use bounded reads in the real HTTP handler`, async () => {
  const state = await fixture(count);
  const snapshot = await state.snapshot();
  assert.equal(snapshot.confirmedPlan.plan.targets.length, count);
  assert.equal(snapshot.summary.required_targets, count);
  assert.equal(snapshot.summary.fulfilled_targets, count);
  assert.equal(snapshot.summary.completion, "complete");
  assert.equal(snapshot.assets.length, count);
  assert.equal(snapshot.results.length, count);
  assert.equal(snapshot.grants[0].operations.length, count);
  assert.equal(snapshot.grants[0].usedCalls, count);
  assert.equal(snapshot.grants[0].pendingCalls, Math.floor(count / 2));
  assert.equal(snapshot.grants[0].usedMicrousd, Math.ceil(count / 2) * 400);
  assert.equal(snapshot.grants[0].exposedMicrousd, Math.floor(count / 2) * 1000);
  assert.equal(state.counters.r2Head, 0);
  assert.equal(state.counters.r2Get, 0);
  assert.equal(state.counters.r2List, Math.ceil(count / 250));
  assert.ok(state.counters.total <= 40, `GET used ${state.counters.total} binding calls`);
  const getCounts = { ...state.counters };
  state.counters.reset();
  const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  assert.equal(prepared.status, 200, await prepared.clone().text());
  const exported = await prepared.json();
  assert.equal(exported.command.partCount, Math.ceil(count / 16));
  assert.equal(state.counters.r2Head, 0);
  assert.equal(state.counters.r2Get, 0, "preparation retains the full manifest without downloading every file");
  assert.ok(state.counters.total <= 40, `export preparation used ${state.counters.total} binding calls`);
  const preparationCounts = { ...state.counters };
  state.counters.reset();
  const downloaded = await state.send(exported.command.downloadUrls[0]);
  assert.equal(downloaded.status, 200, await downloaded.clone().text());
  assert.equal(state.counters.r2Get, 16);
  assert.equal(state.counters.r2Head, 0);
  assert.ok(state.counters.total <= 40, `part download used ${state.counters.total} binding calls`);
  const files = readStoredZip(new Uint8Array(await downloaded.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
  assert.equal(manifest.scope.targets.length, count);
  assert.equal(manifest.scope.obligations.length, 1);
  assert.equal(manifest.packagePart.count, Math.ceil(count / 16));
  assert.equal(manifest.targets.length, count);
  console.log(JSON.stringify({ count, get: getCounts, prepare: preparationCounts, part: { ...state.counters } }));
});

test("R2 short metadata pages are followed; incomplete cursors preserve the full denominator and block actions", async () => {
  const state = await fixture(65, { grants: false });
  state.env.MEDIA.list = async () => ({ objects: [], truncated: true });
  const snapshot = await state.snapshot();
  assert.equal(snapshot.summary.required_targets, 65);
  assert.equal(snapshot.confirmedPlan.plan.targets.length, 65);
  assert.equal(snapshot.summary.scope_known, false);
  assert.equal(snapshot.summary.completion, "unknown");
  assert.equal(snapshot.permissions.canAuthor, false);
  assert.equal(snapshot.permissions.canRequest, false);
  assert.equal(snapshot.permissions.canReview, false);
  assert.equal(snapshot.permissions.canDownload, false);
  assert.ok(snapshot.targetStates.every((state) => state.availability === "unknown" && !state.export_available));
  assert.equal((await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true })).status, 503);
});

test("scoped SQL and exact Document prefix do not expose or scan another Document's files", async () => {
  const state = await fixture(2, { grants: false });
  const privateValue = "foreign-document-filename-and-source";
  for (let index = 0; index < 2000; index++) state.media.set(`output-requirements/${owner}/foreign-project/foreign-document/foreign-${index}/x.png`, { bytes: new Uint8Array(1), metadata: { privateValue }, contentType: "image/png" });
  const snapshot = await state.snapshot();
  assert.equal(snapshot.assets.length, 2);
  assert.equal(snapshot.summary.completion, "complete");
  assert.equal(state.counters.r2List, 1);
  assert.equal(JSON.stringify(snapshot).includes(privateValue), false);
  const excluded = state.assets[0];
  state.sqlite.prepare("UPDATE event_private_payloads SET document_id='foreign-document' WHERE private_event_id=?").run(excluded.created.eventId);
  const isolated = await state.snapshot();
  assert.equal(isolated.assets.some((asset) => asset.id === excluded.id), false);
  assert.equal(isolated.summary.required_targets, 2);
  assert.notEqual(isolated.summary.completion, "complete");
});

test("missing objects and identity or measured-size mismatches do not remain available", async () => {
  for (const mutation of ["missing", "owner", "project", "document", "scope", "asset", "sha", "size", "mime"]) {
    const state = await fixture(2, { grants: false }), value = state.assets[0], stored = state.media.get(value.key);
    if (mutation === "missing") state.media.delete(value.key);
    else if (mutation === "owner") stored.metadata.ownerId = "other-owner";
    else if (mutation === "project") stored.metadata.projectId = "other-project";
    else if (mutation === "document") stored.metadata.documentId = "other-document";
    else if (mutation === "scope") stored.metadata.scopeKey = "other-scope";
    else if (mutation === "asset") stored.metadata.assetId = "other-asset";
    else if (mutation === "sha") stored.metadata.sha256 = "0".repeat(64);
    else if (mutation === "size") stored.bytes = stored.bytes.slice(1);
    else stored.contentType = "text/plain";
    const snapshot = await state.snapshot();
    assert.equal(snapshot.summary.required_targets, 2, mutation);
    assert.notEqual(snapshot.summary.completion, "complete", mutation);
    assert.equal(snapshot.assets.find((asset) => asset.id === value.id).available, false, mutation);
    assert.equal((await state.command({ action: "export", planRevisionId: state.plan.revisionId, allowPartial: true })).status, 409, mutation);
  }
});

test("changed exact bytes are rejected on the requested part, without fetching other parts", async () => {
  const state = await fixture(65, { grants: false });
  const response = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
  assert.equal(response.status, 200, await response.clone().text());
  const exported = await response.json();
  const value = state.assets.find((asset) => asset.id === "asset-0");
  const stored = state.media.get(value.key); stored.bytes[stored.bytes.length - 1] ^= 1;
  state.counters.reset();
  assert.equal((await state.send(exported.command.downloadUrls[0])).status, 409);
  assert.ok(state.counters.r2Get <= 16);
  assert.ok(state.counters.total <= 40);
});

test("private erasure or rights changes in another part block whole-manifest release before bytes", async () => {
  for (const mode of ["asset-private", "result-private", "review-private", "rights"]) {
    const state = await fixture(65, { grants: false });
    const response = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
    assert.equal(response.status, 200, await response.clone().text());
    const exported = await response.json(), value = state.assets.at(-1);
    if (mode === "rights") {
      const row = state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(value.created.eventId);
      const body = JSON.parse(row.private_json); body.asset.origin.rightsAttestedBy = "someone-else";
      state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(body), value.created.eventId);
    } else {
      const id = mode === "asset-private" ? value.created.eventId : mode === "result-private" ? value.bound.eventId : value.accepted.eventId;
      state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), id);
    }
    state.counters.reset();
    const failed = await state.send(exported.command.downloadUrls[0]);
    assert.ok([404, 409, 410].includes(failed.status), `${mode}:${await failed.clone().text()}`);
    assert.equal(state.counters.r2Get, 0, mode);
  }
});

test("whole-manifest SQL proof rolls back when a selected acceptance or private body disappears", async () => {
  const state = await fixture(65, { grants: false });
  const proof = outputBulkDeliveryAssertion(scope, state.plan.revisionId, state.plan.sourceDigest, "output-owned-file-v1", state.entries);
  assert.equal((await state.env.DB.prepare(`SELECT (${proof.sql}) AS allowed`).bind(...proof.bindings).first()).allowed, 1);
  const last = state.assets.at(-1);
  state.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?").run(new Date().toISOString(), last.bound.eventId);
  assert.equal((await state.env.DB.prepare(`SELECT (${proof.sql}) AS allowed`).bind(...proof.bindings).first()).allowed, 0);
  state.sqlite.exec("CREATE TABLE output_scaling_atomic_marker(id TEXT PRIMARY KEY)");
  await assert.rejects(state.env.DB.batch([state.env.DB.prepare("INSERT INTO output_scaling_atomic_marker(id) VALUES('must-rollback')"), ...outputAssertionStatements(state.env, proof)]), /CHECK constraint failed/u);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_scaling_atomic_marker").get().count, 0);
});

test("late private-body changes, membership changes, and access revocation reject the entire part", async () => {
  for (const mode of ["private-body", "membership", "access"]) {
    const state = await fixture(65, { grants: false });
    const prepared = await state.command({ action: "export", planRevisionId: state.plan.revisionId });
    assert.equal(prepared.status, 200, await prepared.clone().text());
    const exported = await prepared.json(), last = state.assets.at(-1), originalGet = state.env.MEDIA.get;
    let changed = false;
    state.env.MEDIA.get = async (...args) => {
      const object = await originalGet(...args);
      if (!changed) {
        changed = true;
        if (mode === "private-body") {
          const row = state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(last.created.eventId);
          const body = JSON.parse(row.private_json); body.asset.name = "Changed after validation";
          state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(body), last.created.eventId);
        } else if (mode === "membership") state.sqlite.prepare("DELETE FROM output_plan_fulfillments WHERE scope_key=? AND target_id=?").run(scope.key, last.target.id);
        else state.sqlite.prepare("UPDATE users SET consent_version='revoked' WHERE user_id=?").run(owner);
      }
      return object;
    };
    state.counters.reset();
    const response = await state.send(exported.command.downloadUrls[0]);
    assert.equal(response.status, mode === "access" ? 403 : 410, mode);
    assert.equal((await response.json()).errorCode, mode === "access" ? "output_execution_authority_revoked" : "output_private_evidence_unavailable", mode);
    assert.notEqual(response.headers.get("content-type"), "application/zip", mode);
    assert.ok(state.counters.r2Get <= 16, mode);
    assert.ok(state.counters.total <= 40, mode);
  }
});

test("legacy custody is bounded and never scans an owner's bucket prefix", async () => {
  for (const count of [MAX_OUTPUT_LEGACY_CUSTODY_READS, MAX_OUTPUT_LEGACY_CUSTODY_READS + 1]) {
    const state = await fixture(count, { grants: false });
    for (const value of state.assets) {
      const old = outputAssetObjectKeys(scope, value.id, value.inspection.sha256, value.inspection.extension).legacyKey;
      const file = state.media.get(value.key); delete file.metadata.projectId;
      state.media.set(old, file); state.media.delete(value.key);
      state.sqlite.prepare("UPDATE output_assets SET storage_key=? WHERE asset_id=?").run(old, value.id);
    }
    state.counters.reset();
    const snapshot = await state.snapshot();
    assert.equal(snapshot.summary.required_targets, count);
    assert.equal(state.counters.r2List, 0);
    assert.equal(state.counters.r2Head, count <= MAX_OUTPUT_LEGACY_CUSTODY_READS ? count : 0);
    if (count > MAX_OUTPUT_LEGACY_CUSTODY_READS) {
      assert.equal(snapshot.summary.completion, "unknown");
      assert.ok(snapshot.capabilities.limitationCodes.includes("output_legacy_custody_recheck_required"));
      assert.equal(snapshot.permissions.canDownload, false);
    } else assert.equal(snapshot.summary.completion, "complete");
    assert.ok(state.counters.total <= 40);
  }
});

test("legacy HEADs share the eight-call custody budget with Document listing pages", async () => {
  const state = await fixture(65, { grants: false });
  for (const value of state.assets.slice(0, 8)) {
    const old = outputAssetObjectKeys(scope, value.id, value.inspection.sha256, value.inspection.extension).legacyKey;
    const file = state.media.get(value.key); delete file.metadata.projectId;
    state.media.set(old, file); state.media.delete(value.key);
    state.sqlite.prepare("UPDATE output_assets SET storage_key=? WHERE asset_id=?").run(old, value.id);
  }
  state.counters.reset();
  const snapshot = await state.snapshot();
  assert.equal(snapshot.summary.required_targets, 65);
  assert.equal(snapshot.summary.completion, "unknown");
  assert.equal(state.counters.r2List, 1);
  assert.equal(state.counters.r2Head, 0, "eight legacy reads no longer fit after one list page");
  assert.ok(snapshot.capabilities.limitationCodes.includes("output_legacy_custody_recheck_required"));
});

test("an explicitly bounded SQL inventory remains unknown rather than shrinking the assignment", async () => {
  const state = await fixture(65);
  const trusted = await loadOutputTrustedContext(new Request(`http://localhost${base}?documentId=${doc}`), state.env, doc);
  assert.ok(!(trusted instanceof Response));
  const model = await readOutputReadModel(state.env, trusted.scope, await readEvents(state.env, `creative:${owner}`), { ...readOptions(trusted), maxRows: 32 });
  assert.equal(model.complete, false);
  assert.equal(model.confirmedPlan.plan.targets.length, 65);
  assert.ok(model.reasonCodes.includes("output_read_model_rows_incomplete"));
  assert.equal(model.grants[0].operations.length, 32);
  assert.equal(model.grants[0].usedCalls, 65, "bounded history never understates total spending or calls");
  assert.ok(model.results.every((result) => !result.reviewAllowed));
});

test("large private history is bounded in SQL before D1 returns it, without changing the owed scope", async () => {
  const state = await fixture(65, { grants: false });
  for (const value of state.assets) {
    const row = state.sqlite.prepare("SELECT private_json FROM event_private_payloads WHERE private_event_id=?").get(value.created.eventId);
    const body = JSON.parse(row.private_json); body.retained_history_fixture = "x".repeat(100_000);
    state.sqlite.prepare("UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?").run(JSON.stringify(body), value.created.eventId);
  }
  const trusted = await loadOutputTrustedContext(new Request(`http://localhost${base}?documentId=${doc}`), state.env, doc);
  assert.ok(!(trusted instanceof Response));
  const model = await readOutputReadModel(state.env, trusted.scope, trusted.events, readOptions(trusted));
  assert.equal(model.complete, false);
  assert.equal(model.confirmedPlan.plan.targets.length, 65);
  assert.ok(model.assetEvidence.size < 65);
  assert.ok(model.reasonCodes.includes("output_read_model_private_evidence_incomplete"));
});

test("R2 exhausted and repeated cursors stop within the page budget", async () => {
  const state = await fixture(1, { grants: false });
  let calls = 0;
  state.env.MEDIA.list = async () => ({ objects: [], truncated: true, cursor: String(++calls) });
  const incomplete = await readOutputCustodyInventory(state.env, scope, [state.assets[0].key], [outputAssetDocumentPrefix(scope)]);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.listPages, 8);
  assert.equal(calls, 8);
  calls = 0;
  state.env.MEDIA.list = async () => { calls++; return { objects: [], truncated: true, cursor: "repeat" }; };
  const repeated = await readOutputCustodyInventory(state.env, scope, [state.assets[0].key], [outputAssetDocumentPrefix(scope)]);
  assert.equal(repeated.complete, false);
  assert.equal(calls, 2);
});
