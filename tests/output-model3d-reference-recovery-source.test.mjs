import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";

registerOutputSourceImports();
const { ensureSchema, appendAuditEvent } = await import("../worker/runtime.ts");
const { POLICY_VERSION } = await import("../worker/policy-version.ts");
const { requireUser } = await import("../worker/pilot-policy.ts");
const { handleExperienceIntake } = await import("../worker/experience-intake-api.ts");
const { handleExperienceOutput } = await import("../worker/experience-output-api.ts");
const { outputDocumentExecutionBridge } = await import("../worker/output-document-execution.ts");
const { resolveOutputModel3dRecoveryAuthority } = await import("../worker/output-requirements-api.ts");
const { outputSlotFromRow } = await import("../worker/output-requirements-ledger.ts");
const { continueOutputTrustedContext } = await import("../worker/output-trusted-context.ts");
const { resolveOutputModel3dRecoverySource } = await import("../worker/output-model3d-source.ts");
const { MODEL3D_REFERENCE_HEAD_SQL } = await import("../worker/output-model3d-publication-head.ts");
const { RODIN_IMAGE_MODEL } = await import("../src/model/model3d.ts");
const { registeredExperience, initialValues } = await import("../src/experiences/intake.ts");

const owner = "dev-local-creative", stream = `creative:${owner}`;
const sourceProject = "original-project", sourceDocument = "original-document", sourceBlock = "original-reference-block";
const referenceId = "original-image-reference";
const image = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfQAAAABJRU5ErkJggg==", "base64"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const mediaKey = `u-${Buffer.from(owner).toString("hex")}/synthetic-source.png`;
const post = (path, body) => new Request("http://localhost" + path, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

// Actual handlers, principal, original retained intake, source projection,
// custody/rights/media reader and recovery authority run against current SQLite
// schema and in-memory private bytes. No function in that chain is mocked.
// All inputs and local admission rows are synthetic; no provider is contacted.
async function fixture(t, withReference = true) {
  const f = outputTestDatabase(); t.after(() => f.sqlite.close());
  t.mock.method(globalThis, "fetch", () => { throw Error("Network forbidden in recovery source tests"); });
  await ensureSchema(f.env);
  const now = new Date().toISOString();
  f.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator',?,?,?,?)")
    .run(owner, "creative@local.forma", "Local creative", POLICY_VERSION, now, now, now);
  f.env.FAL_KEY = "synthetic-configuration-only";
  const properties = { label: "Synthetic owned image", reference_id: referenceId, source_content_hash: hash(image),
    media_url: "/api/media/" + mediaKey, media_type: "image/png", pixel_reference_mode: "preserve_style" };
  await f.env.MEDIA.put(mediaKey, image, { customMetadata: { ownerId: owner, sha256: hash(image) }, httpMetadata: { contentType: "image/png" } });
  for (const [type, payload] of [
    ["ProjectCreated", { project_id: sourceProject, name: "Synthetic source" }],
    ["DocumentCreated", { project_id: sourceProject, document_id: sourceDocument, title: "Synthetic source" }],
    ["ReferenceIngested", { reference_id: referenceId, source_ref: properties.media_url, content_hash: hash(image), rights_class: "owned" }],
    ["RightsAsserted", { reference_id: referenceId, rights_class: "owned" }],
    ["BlockCreated", { block_id: sourceBlock, type: "reference", scope: "document", project_id: sourceProject,
      document_id: sourceDocument, handle: "reference/source", position: "z0001", properties }],
  ]) await appendAuditEvent(f.env, stream, "user", type, payload);
  const selection = { version: 1, kind: "image", sourceProjectId: sourceProject, sourceDocumentId: sourceDocument,
    sourceBlockId: sourceBlock, referenceId, sha256: hash(image), permissionAttestation: "i-own-or-have-permission" };
  const sourceRequest = new Request("http://localhost/api/source");
  const sourceAuth = await requireUser(sourceRequest, f.env, "creator");
  const source = await continueOutputTrustedContext(sourceRequest, f.env, sourceDocument, "read", sourceAuth);
  assert(!(source instanceof Response), source instanceof Response ? await source.text() : "");
  assert.deepEqual(source.sourceProblems, []);
  assert.ok(source.context, JSON.stringify(source));
  assert.equal(source.context.snapshot.facts.filter(fact => fact.block_id === sourceBlock).length, 1, JSON.stringify(source.context));
  assert.ok(source.sourceAssertions.length, JSON.stringify(source));
  const release = await registeredExperience("model3d");
  const intent = { intentId: "00000000-0000-4000-8000-000000000095", experienceId: "model3d", releaseHash: release.releaseHash,
    values: { ...initialValues(release), subject: { value: "One synthetic ceramic lamp", provenance: "authored" } },
    ...(withReference ? { reference: selection } : {}) };
  const saved = await handleExperienceIntake(post("/api/experiences/drafts", intent), f.env);
  assert.equal(saved.status, 200, await saved.clone().text()); const { plan } = await saved.json();
  const committed = await handleExperienceIntake(post(`/api/experiences/drafts/${plan.draftId}/commit`, { draftHash: plan.draftHash }), f.env);
  assert.equal(committed.status, 200, await committed.clone().text());
  const path = `/api/experiences/drafts/${plan.draftId}/output`;
  const executionContext = { waitUntil() { throw Error("Background execution forbidden"); } };
  const send = async (action, body) => {
    const response = await handleExperienceOutput(post(path + "/" + action, body), f.env, executionContext, outputDocumentExecutionBridge);
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const prepared = await send("prepare", { draftHash: plan.draftHash, explicitRequirementsConfirmation: true });
  assert.equal(prepared.permitted.authorize, true, JSON.stringify(prepared));
  const admitted = await send("authorize", { draftHash: plan.draftHash, termsDigest: prepared.preflight.termsDigest,
    maximumMicrousd: prepared.preflight.maximumMicrousd, explicitAuthorization: true,
    model3dCostConsent: { ...prepared.model3dCostPreview, confirmed: true, providerTransferConfirmed: true } });
  assert.equal(admitted.permitted.run, true, JSON.stringify(admitted));
  const request = new Request("http://localhost/api/output-model3d/recover");
  const auth = await requireUser(request, f.env, "creator"); assert.ok(auth.user);
  const scope = { kind: "personal", key: `personal:${owner}:${plan.projectId}`, actorUserId: owner, ownerUserId: owner,
    documentId: plan.documentId, projectId: plan.projectId, organizationId: null, projectAccessId: null, contextId: null };
  const slot = outputSlotFromRow(scope.key, f.sqlite.prepare("SELECT * FROM output_operation_slots WHERE slot_id=?").get(admitted.original.slotId));
  return { ...f, plan, selection, properties, prepared, admitted, scope, slot, auth, request,
    recover: (caller = { request, user: auth.user }) => resolveOutputModel3dRecoveryAuthority(f.env, scope, slot, caller),
    append: (type, payload) => appendAuditEvent(f.env, stream, "user", type, payload) };
}

function snapshot(f) {
  const schema = f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  const tables = Object.fromEntries(schema.filter(row => row.type === "table").map(({ name }) =>
    [name, f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]));
  return structuredClone({ schema, tables, media: [...f.media] });
}
function input(f, proof) {
  return { request: f.request, env: f.env, scope: f.scope, principal: f.auth.user, target: proof.target,
    confirmedPlan: proof.confirmedPlan, context: proof.context, sourceEvents: proof.events, sourceAssertions: proof.assertions,
    sourceDigest: proof.sourceDigest, requirementsDigest: proof.requirementsDigest };
}
function assertionsCurrent(f, assertions) {
  return assertions.map(assertion => {
    assert((assertion.bindings?.length ?? 0) <= 100, "every final assertion fits one D1 statement");
    return f.sqlite.prepare(`SELECT CASE WHEN (${assertion.sql}) THEN 1 ELSE 0 END AS current`).get(...assertion.bindings ?? []).current;
  });
}

test("initial single-reference recovery reuses actual retained intake and current owned source", async t => {
  const f = await fixture(t);
  const before = snapshot(f), reads = [];
  const read = f.env.MEDIA.get.bind(f.env.MEDIA);
  f.env.MEDIA.get = key => { reads.push(key); return read(key); };
  const proof = await f.recover();
  assert.equal(proof.target.media_kind, "model3d");
  assert.equal(proof.target.model3d_contract.reference.selection.kind, "image");
  assert.deepEqual(proof.target.model3d_contract.reference.selection, f.selection);
  assert.notEqual(proof.target.model3d_contract.reference.copiedBlockId, sourceBlock);
  assert.equal(proof.targetPreflight.model, RODIN_IMAGE_MODEL);
  assert.equal(proof.sourceEpoch.head, f.sqlite.prepare("SELECT MAX(sequence) head FROM events WHERE stream_id=?").get(stream).head);
  assert.deepEqual(new Set(reads), new Set([mediaKey]), "the original owned image reader runs again");
  assert(reads.length >= 2, "metadata and actual bytes are both reread");
  const referenceHead = proof.assertions.filter(assertion => assertion.sql === MODEL3D_REFERENCE_HEAD_SQL);
  assert.deepEqual(referenceHead.map(assertion => assertion.bindings), [[stream, proof.head]]);
  assert(proof.assertions.some(assertion => assertion.sql.includes("principal.updated_at") && assertion.bindings.includes(sourceProject)), "actual source authorization guard retained");
  assert(proof.assertions.some(assertion => assertion.sql.includes("event_private_payloads") && assertion.bindings.some(value => typeof value === "string" && value.includes(mediaKey))), "original private source body retained");
  assert(proof.assertions.some(assertion => assertion.sql.includes("draft.kind='experience-draft'") && assertion.bindings.includes(f.plan.draftId)), "retained intake and deadline guard retained");
  assert(proof.assertions.some(assertion => assertion.sql.includes("event_client_receipts counted")), "exact original intake receipts retained");
  assert(assertionsCurrent(f, proof.assertions).every(value => value === 1));
  const resolved = await resolveOutputModel3dRecoverySource(input(f, proof), f.slot);
  assert.equal(resolved.replacement, null); assert.equal(resolved.requestId, f.slot.jobId);
  assert.equal(resolved.expiresAt, f.prepared.model3dCostPreview.expiresAt);
  assert.deepEqual(resolved.plan.reference, f.plan.reference);
  assert.deepEqual(snapshot(f), before, "recovery source reads do not write jobs, grants, holds, events or private media");
});

test("initial reference recovery requires the actual owner caller; text-only remains callable without one", async t => {
  const f = await fixture(t), before = snapshot(f);
  for (const caller of [undefined, { request: f.request, user: { ...f.auth.user, userId: "foreign" } }]) {
    await assert.rejects(resolveOutputModel3dRecoveryAuthority(f.env, f.scope, f.slot, caller),
      error => error.code === "output_model3d_recovery_scope_unsupported" && error.status === 403);
  }
  for (const patch of [{ fictional: true }, { projectExecution: {} }, { streamId: "creative:foreign" },
    { consentVersion: "withdrawn" }, { access: { ...f.auth.user.access, capabilities: [] } }]) {
    await assert.rejects(f.recover({ request: f.request, user: { ...f.auth.user, ...patch } }),
      error => error.code === "output_model3d_personal_source_required");
  }
  assert.deepEqual(snapshot(f), before);
  const text = await fixture(t, false), textBefore = snapshot(text);
  const proof = await resolveOutputModel3dRecoveryAuthority(text.env, text.scope, text.slot);
  assert.equal(proof.target.model3d_contract.reference, null);
  assert.equal(proof.assertions.some(assertion => assertion.sql === MODEL3D_REFERENCE_HEAD_SQL), false);
  assert.deepEqual(snapshot(text), textBefore);
});

test("initial source branch does not turn a replacement into an initial retrieval", async t => {
  const f = await fixture(t), proof = await f.recover(), before = snapshot(f);
  for (const slot of [{ ...f.slot, attemptOrdinal: 1, previousSlotId: "missing-parent" },
    { ...f.slot, attemptOrdinal: 0, previousSlotId: "unexpected-parent" }, { ...f.slot, attemptOrdinal: 2 }]) {
    await assert.rejects(resolveOutputModel3dRecoverySource(input(f, proof), slot),
      error => error.code === "output_model3d_recovery_lineage_unavailable");
  }
  assert.deepEqual(snapshot(f), before);
});

for (const [name, mutate, code] of [
  ["withdrawn original rights", f => f.append("RightsAsserted", { reference_id: referenceId, rights_class: "unknown" }), "model3d_reference_source_unavailable"],
  ["original pixel permission", f => f.append("BlockPropertyEdited", { block_id: sourceBlock, property_path: "pixel_reference_mode", old_value: "preserve_style", new_value: "context_only" }), "model3d_reference_not_authorized"],
  ["original source label", f => f.append("BlockPropertyEdited", { block_id: sourceBlock, property_path: "label", old_value: f.properties.label, new_value: "Changed original" }), "output_model3d_original_changed"],
  ["original bytes with unchanged metadata hash", f => { f.media.get(mediaKey).bytes[0] ^= 1; }, "model3d_reference_integrity_mismatch"],
  ["foreign media custody", f => { f.media.get(mediaKey).metadata.ownerId = "foreign"; }, "model3d_reference_media_unavailable"],
  ["missing retained image", f => { f.media.delete(mediaKey); }, "model3d_reference_media_unavailable"],
  ["redacted original source body", f => { f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')=?)").run(new Date().toISOString(), sourceBlock); }, "model3d_reference_source_unavailable"],
  ["expired retained intake", f => { f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.plan.draftId); }, "output_model3d_original_unavailable"],
  ["revoked current principal", f => { f.sqlite.prepare("UPDATE users SET consent_version='withdrawn' WHERE user_id=?").run(owner); }, "output_model3d_original_unavailable"],
]) test(`source recovery refuses ${name} through the actual original reader`, async t => {
  const f = await fixture(t), proof = await f.recover();
  await mutate(f); const before = snapshot(f);
  await assert.rejects(resolveOutputModel3dRecoverySource(input(f, proof), f.slot),
    error => (error.code ?? error.detail?.code) === code, name);
  await assert.rejects(f.recover(), error => /^(?:output_|model3d_|context_)/u.test(error.code ?? error.detail?.code ?? ""), "full authority entry also refuses");
  assert.deepEqual(snapshot(f), before, "a refused read has no write side effects");
});

test("changed Document copy is refused while original source remains intact", async t => {
  const f = await fixture(t), proof = await f.recover();
  const copy = proof.target.model3d_contract.reference.copiedBlockId;
  await f.append("BlockPropertyEdited", { block_id: copy, property_path: "source_content_hash", old_value: hash(image), new_value: "0".repeat(64) });
  const before = snapshot(f);
  await assert.rejects(f.recover(), error => error.code === "output_execution_contract_changed");
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.media.get(mediaKey).metadata.sha256, hash(image));
  assert.deepEqual(f.media.get(mediaKey).bytes, image);
});

test("captured source assertions fail after retention, private-body, principal or head changes", async t => {
  const f = await fixture(t), proof = await f.recover();
  for (const mutate of [
    () => f.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00.000Z' WHERE content_id=?").run(f.plan.draftId),
    () => f.sqlite.prepare("UPDATE event_private_payloads SET redacted_at='2020-01-01T00:00:00.000Z' WHERE private_event_id=(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')=?)").run(sourceBlock),
    () => f.sqlite.prepare("UPDATE users SET updated_at='2020-01-01T00:00:00.000Z' WHERE user_id=?").run(owner),
  ]) {
    f.sqlite.exec("SAVEPOINT changed"); mutate();
    assert(assertionsCurrent(f, proof.assertions).some(value => value === 0));
    f.sqlite.exec("ROLLBACK TO changed; RELEASE changed");
  }
  await f.append("RightsAsserted", { reference_id: referenceId, rights_class: "unknown" });
  const referenceHead = proof.assertions.find(assertion => assertion.sql === MODEL3D_REFERENCE_HEAD_SQL);
  assert.deepEqual(assertionsCurrent(f, [referenceHead]), [0], "source head remains strict after a new rights event");
});
