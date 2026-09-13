import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { readModel3dReferenceIntent } from "../src/experiences/model3d-reference.ts";

// Only the newly owned adapter/handler run. Existing Worker I/O/auth entry points
// are explicit synthetic ports, not copied source, a live DB, or provider evidence.
const stateKey = Symbol.for("forma.model3d-reference-custody.new-controls");
let state;
const dependencies = {
  "./model3d-request.ts": ["prepareModel3dRequest", "prepare"],
  "./intake-authority.ts": ["projectIntakeAuthority", "authority"],
  "./output-disclosure-proof.ts": [["outputActiveSourceDeadlineAssertions", "deadlines"], ["verifyOutputSourceRead", "verify"]],
  "./experience-intake-api.ts": [["authorizeExperienceIntake", "authorize"], ["readExperienceBody", "body"]],
  "./output-requirements-api.ts": ["loadOutputTrustedContext", "trusted"],
};
const prefix = new URL("../worker/", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(prefix) && Object.hasOwn(dependencies, specifier)) {
      const value = dependencies[specifier], exports = Array.isArray(value[0]) ? value : [value];
      const source = exports.map(([name, port]) => `export const ${name}=(...args)=>globalThis[Symbol.for("forma.model3d-reference-custody.new-controls")].${port}(...args);`).join("\n");
      return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { inspectModel3dReferenceCustody, MAX_MODEL3D_INTAKE_REFERENCE_BYTES } = await import("../worker/model3d-reference-custody.ts");
const { handleExperienceModel3dReference } = await import("../worker/experience-model3d-reference.ts");
hooks.deregister();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // Custody bytes only, no pixel-decoding claim.
const mediaUrl = "/api/media/u-6f776e6572/reference.png", modelUrl = "/api/media/u-6f776e6572/model.glb";
const modelHash = "a".repeat(64);
const camera = { version: 1, position: [0, 0, 6.4], target: [0, 0, 0], fov: 35, background: "#ffffff" };

function setup(kind = "image") {
  const selection = { version: 1, kind, sourceProjectId: "project-1", sourceDocumentId: "document-1", sourceBlockId: "block-1",
    referenceId: "reference-1", sha256: sha(bytes), permissionAttestation: "i-own-or-have-permission" };
  const properties = { reference_id: selection.referenceId, source_content_hash: selection.sha256, media_url: mediaUrl, media_type: "image/png",
    pixel_reference_mode: "style_reference", ...(kind === "saved-model-view" ? { model_url: modelUrl, model_reference_id: "model-reference-1",
      model_content_hash: modelHash, model_mime_type: "model/gltf-binary", model_view: structuredClone(camera) } : {}) };
  const type = kind === "saved-model-view" ? "model3d" : "reference";
  const block = { id: "block-1", type, scope: "document", removed: false, documentId: "document-1", projectId: "project-1", properties };
  const controller = new AbortController();
  const trusted = {
    scope: { kind: "personal", key: "personal:owner:document-1", ownerUserId: "owner", actorUserId: "owner", projectId: "project-1",
      documentId: "document-1", projectAccessId: null, organizationId: null, contextId: null },
    request: new Request("https://forma.invalid/api/experiences/model3d/reference/inspect", { signal: controller.signal }),
    projection: { libraryBlocks: [block] },
    context: { snapshot: { facts: [{ block_id: "block-1", type, properties }] } },
    sourceProblems: [], sourcePrivateCaptured: true, sourceDigest: "source-digest-1", ownerHead: 4,
    sourceAssertions: [{ sql: "source_is_current=?", bindings: [1] }],
    events: [
      { eventId: "ingest-1", sequence: 1, type: "ReferenceIngested", payload: { reference_id: "reference-1", source_ref: mediaUrl, content_hash: selection.sha256, rights_class: "owned" } },
      { eventId: "rights-1", sequence: 2, type: "RightsAsserted", payload: { reference_id: "reference-1", rights_class: "owned" } },
      ...(kind === "saved-model-view" ? [
        { eventId: "ingest-model", sequence: 3, type: "ReferenceIngested", payload: { reference_id: "model-reference-1", source_ref: modelUrl, content_hash: modelHash, rights_class: "owned" } },
        { eventId: "rights-model", sequence: 4, type: "RightsAsserted", payload: { reference_id: "model-reference-1", rights_class: "owned" } },
      ] : []),
    ],
  };
  const auth = { user: { userId: "owner", streamId: "creative:owner", role: "creator" }, principal: { userId: "owner" }, impersonation: null };
  const calls = [];
  const env = {
    MEDIA: { async head(key) { calls.push({ kind: "head", key }); return state.head; } },
    DB: { prepare() { throw Error("No direct DB command belongs in this adapter; final reads use the existing proof helper."); } },
  };
  trusted.env = env;
  state = {
    calls, selection, auth, env, controller, proofCurrent: true,
    head: { size: bytes.length, customMetadata: { ownerId: "owner", sha256: selection.sha256 },
      writeHttpMetadata(headers) { headers.set("content-type", "image/png"); } },
    async prepare(input) {
      calls.push({ kind: "prepare", input });
      assert.equal(input.env, env); assert.equal(input.sourceEvents, trusted.events);
      assert.equal(input.snapshot, trusted.context.snapshot);
      assert.deepEqual(input.referenceBlockIds, ["block-1"]);
      assert.equal(Object.hasOwn(input, "projectScope"), false);
      await state.afterPrepare?.();
      if (state.preparationError) throw state.preparationError;
      return state.prepared ?? { references: [{ bytes: new Uint8Array(bytes), mimeType: "image/png", blockId: "block-1", referenceId: "reference-1", label: "Test image" }],
        referenceBlockIds: ["block-1"] };
    },
    authority(...args) { calls.push({ kind: "authority", args }); return { sql: "principal_is_current=?", bindings: [1] }; },
    deadlines(context) { calls.push({ kind: "deadlines", context }); return [{ sql: "source_deadline_is_current=?", bindings: [1] }]; },
    async verify(suppliedEnv, scope, expectedHead, assertions) {
      assert.equal(suppliedEnv, env); assert.equal(scope, trusted.scope);
      calls.push({ kind: "proof", expectedHead, assertions });
      await state.afterProof?.();
      if (!state.proofCurrent) throw Object.assign(Error("synthetic current-source refusal"), { code: "output_source_changed_during_read" });
    },
    async authorize() { calls.push({ kind: "authorize" }); return state.authorizationResponse ?? auth; },
    async body(request) { calls.push({ kind: "body" }); return request.json(); },
    async trusted(request, suppliedEnv, documentId, permission) {
      calls.push({ kind: "trusted", request, env: suppliedEnv, documentId, permission });
      return state.trustedResponse ?? trusted;
    },
  };
  // Distinguish the actual trusted object from the transport port with the same short name.
  state.input = trusted;
  globalThis[stateKey] = state;
  return { selection, trusted, auth, env, controller, calls, properties, block };
}
const inspect = f => inspectModel3dReferenceCustody(f.trusted, f.auth, f.selection);
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
const request = value => new Request("https://forma.invalid/api/experiences/model3d/reference/inspect", {
  method: "POST", headers: { origin: "https://forma.invalid", "content-type": "application/json" }, body: JSON.stringify(value),
});

test("selection is a closed authored permission statement, not owner/media authority", () => {
  const f = setup();
  const value = readModel3dReferenceIntent(f.selection);
  assert.deepEqual(value, f.selection); assert.ok(Object.isFrozen(value));
  f.selection.sha256 = "f".repeat(64); assert.notEqual(value.sha256, f.selection.sha256);
  for (const candidate of [null, [], [value, value], { ...value, ownerId: "owner" }, { ...value, mediaUrl },
    { ...value, permissionAttestation: true }, { ...value, permissionAttestation: "server-verified" },
    { ...value, sha256: "" }, { ...value, sha256: "A".repeat(64) }, { ...value, kind: "uploaded-mesh" },
    { ...value, sourceDocumentId: "../another" }]) assert.equal(readModel3dReferenceIntent(candidate), null);
  let reads = 0;
  const getter = { ...value }; Object.defineProperty(getter, "sha256", { enumerable: true, get() { reads++; return value.sha256; } });
  assert.equal(readModel3dReferenceIntent(getter), null); assert.equal(reads, 0);
});

test("image inspection joins retained hash, owner-private bytes and final source/authority proofs", async () => {
  const f = setup(), result = await inspect(f);
  assert.equal(result.qualification, "read-only-reference-inspection"); assert.equal(result.sourceDigest, "source-digest-1");
  assert.deepEqual(result.content, { sha256: f.selection.sha256, byteLength: bytes.length, mimeType: "image/png" });
  assert.equal(result.savedModel, null); assert.ok(Object.isFrozen(result) && Object.isFrozen(result.content));
  const proof = f.calls.find(call => call.kind === "proof");
  for (const text of ["principal_is_current", "source_is_current", "source_deadline_is_current"]) assert.ok(proof.assertions.some(assertion => assertion.sql.includes(text)));
  assert.deepEqual(proof.assertions.map(assertion => assertion.bindings), [[1], [1], [1]]);
  assert.equal(proof.expectedHead, 4);
  assert.equal(f.calls.filter(call => call.kind === "prepare").length, 1);
  assert.equal(JSON.stringify(result).includes("/api/media"), false);
  for (const key of ["bytes", "owned", "approved", "grant", "events", "provider"]) assert.equal(Object.hasOwn(result, key), false);
});

test("saved view retains original model hash/camera evidence and rejects missing/replaced evidence", async () => {
  const f = setup("saved-model-view"), result = await inspect(f);
  assert.deepEqual(result.savedModel, { referenceId: "model-reference-1", sha256: modelHash, view: camera });
  assert.ok(Object.isFrozen(result.savedModel.view.position));
  for (const mutate of [
    f => { delete f.properties.model_content_hash; },
    f => { f.properties.model_view.fov = 90; },
    f => { f.trusted.events.find(e => e.eventId === "ingest-model").payload.content_hash = "b".repeat(64); },
    f => { f.trusted.events.push({ type: "ReferenceIngested", payload: { reference_id: "model-reference-1", source_ref: "/api/media/replaced", content_hash: modelHash } }); },
  ]) { const f = setup("saved-model-view"); mutate(f); await rejects(inspect(f), "model3d_reference_saved_view_unavailable"); }
  const changed = setup("saved-model-view"); changed.selection.kind = "image";
  await rejects(inspect(changed), "model3d_reference_kind_changed");
});

test("cross-owner/project-scoped or nonmatching source intent cannot be inspected or copied", async () => {
  for (const mutate of [
    f => { f.trusted.scope.ownerUserId = "different"; },
    f => { f.trusted.scope.kind = "project"; },
    f => { f.trusted.scope.projectAccessId = "project-access"; },
    f => { f.selection.sourceProjectId = "another-project"; },
    f => { f.auth.principal.userId = "different"; },
    f => { f.auth.impersonation = { id: "impersonation" }; },
    f => { f.auth.user.fictional = true; },
  ]) {
    const f = setup(); mutate(f); await rejects(inspect(f), "model3d_reference_scope_unavailable");
    assert.equal(f.calls.some(call => call.kind === "head" || call.kind === "prepare" || call.kind === "proof"), false);
  }
  const f = setup(); f.block.scope = "project";
  await rejects(inspect(f), "model3d_reference_source_unavailable");
});

test("missing legacy hashes, changed ingestion and outside-owner URLs never fall back to permission claims", async () => {
  const missing = setup(); delete missing.properties.source_content_hash;
  await rejects(inspect(missing), "model3d_reference_hash_required");
  for (const mutate of [
    f => { delete f.trusted.events[0].payload.content_hash; },
    f => { f.trusted.events[0].payload.content_hash = "c".repeat(64); },
    f => { f.trusted.events.push({ type: "ReferenceIngested", payload: { reference_id: "reference-1", source_ref: "/api/media/replaced", content_hash: f.selection.sha256 } }); },
  ]) { const f = setup(); mutate(f); await rejects(inspect(f), "model3d_reference_retained_hash_required"); }
  for (const url of ["https://unowned.invalid/image.png", "/api/media/u-6f74686572/image.png", "/api/media/u-6f776e6572/../image.png", mediaUrl + "?source=other"]) {
    const f = setup(); f.properties.media_url = url;
    await rejects(inspect(f), "model3d_reference_private_media_required");
  }
});

test("existing preparation refusal is preserved for rights, pixel, saved model or provenance rejection", async () => {
  for (const reason of ["rights withdrawn", "pixel opt-in absent", "saved model/camera mismatch", "derived provenance missing"]) {
    const f = setup(); const sentinel = new Error(reason); state.preparationError = sentinel;
    await assert.rejects(inspect(f), error => error === sentinel);
    assert.equal(f.calls.some(call => call.kind === "proof"), false);
  }
});

test("metadata bounds and exact returned bytes/order/MIME are mandatory", async () => {
  for (const mutate of [
    () => { state.head.size = MAX_MODEL3D_INTAKE_REFERENCE_BYTES + 1; },
    () => { state.head.customMetadata.ownerId = "other"; },
    () => { state.head.customMetadata.sha256 = "d".repeat(64); },
  ]) { const f = setup(); mutate(); await rejects(inspect(f), "model3d_reference_media_unavailable"); }
  const f = setup(); state.prepared = { references: [], referenceBlockIds: [] };
  await rejects(inspect(f), "model3d_reference_read_mismatch");
  const hashMismatch = setup(); const changed = new Uint8Array(bytes); changed[0] = 0;
  state.prepared = { references: [{ bytes: changed, blockId: "block-1", referenceId: "reference-1", mimeType: "image/png" }], referenceBlockIds: ["block-1"] };
  await rejects(inspect(hashMismatch), "model3d_reference_source_changed");
});

test("stale source, final proof refusal, cancellation and SQL errors fail without retry or write", async () => {
  const f = setup(); state.afterPrepare = () => { f.properties.source_content_hash = "e".repeat(64); };
  await rejects(inspect(f), "model3d_reference_source_changed");
  const rights = setup(); state.afterPrepare = () => { rights.trusted.events[1].payload.rights_class = "withdrawn"; };
  await rejects(inspect(rights), "model3d_reference_source_changed");
  const proof = setup(); state.proofCurrent = false; await rejects(inspect(proof), "output_source_changed_during_read");
  const after = setup(); state.afterProof = () => { after.trusted.ownerHead++; }; await rejects(inspect(after), "model3d_reference_source_changed");
  const cancelled = setup(); state.afterPrepare = () => cancelled.controller.abort();
  await assert.rejects(inspect(cancelled), error => error.name === "AbortError");
  const sql = setup(); const sentinel = Error("synthetic SQL failure"); state.afterProof = () => { throw sentinel; };
  await assert.rejects(inspect(sql), error => error === sentinel);
  assert.equal(sql.calls.filter(call => call.kind === "proof").length, 1);
});

test("existing-handler adapter is read-only, same-origin and principal/source authorized", async () => {
  const f = setup(), response = await handleExperienceModel3dReference(request(f.selection), f.env);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json(); assert.equal(body.status, "inspected"); assert.equal(body.generation, "unavailable");
  assert.match(body.notice, /not a saved reference, transfer, approval/);
  const read = f.calls.find(call => call.kind === "trusted");
  assert.equal(read.documentId, f.selection.sourceDocumentId); assert.equal(read.permission, "read");
  assert.equal(f.calls.filter(call => call.kind === "authorize").length, 1);
  const cross = setup();
  const denied = await handleExperienceModel3dReference(new Request("https://forma.invalid/api/experiences/model3d/reference/inspect", { method: "POST", headers: { origin: "https://other.invalid" }, body: "{}" }), cross.env);
  assert.equal(denied.status, 403); assert.equal(cross.calls.length, 0);
});

test("handler preserves authorization refusal and never discloses delegated private errors", async () => {
  const f = setup(); state.authorizationResponse = new Response("consent required", { status: 403 });
  const denied = await handleExperienceModel3dReference(request(f.selection), f.env);
  assert.equal(denied, state.authorizationResponse); assert.equal(f.calls.some(call => call.kind === "trusted"), false);
  const failed = setup(); state.preparationError = Error("private provider receipt or source text");
  const response = await handleExperienceModel3dReference(request(failed.selection), failed.env);
  assert.equal(response.status, 409); const text = await response.text();
  assert.equal(text.includes("private provider"), false); assert.equal(text.includes("inspected"), false);
});
