import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readVideoReferenceIntent } from "../src/experiences/video-reference.ts";
import { registerOutputSourceImports } from "./output-execution-test-helpers.mjs";

// Resolve the actual repository's extensionless TypeScript imports, as in the
// other output tests; no source or handler is replaced by this resolver.
const sourceImports = registerOutputSourceImports();
test.after(() => sourceImports.deregister());

// Actual new handlers/custody, actual existing media reader + derived guard.
// Authentication/trusted-source/final SQL-proof are explicitly boundary ports.
const symbol = Symbol.for("forma.video-reference-tests");
let state;
const ports = {
  "./intake-authority.ts": ["projectIntakeAuthority", "authority"],
  "./output-disclosure-proof.ts": [["outputActiveSourceDeadlineAssertions", "deadlines"], ["verifyOutputSourceRead", "verify"]],
  "./experience-intake-api.ts": [["authorizeExperienceIntake", "authorize"], ["readExperienceBody", "body"]],
  "./output-requirements-api.ts": ["loadOutputTrustedContext", "trusted"],
  "./output-trusted-context.ts": ["continueOutputTrustedContext", "continued"],
};
const portParents = new Set(["video-reference-custody.ts", "experience-video-reference.ts", "experience-video-reference-source.ts"].map(file =>
  pathToFileURL(realpathSync(new URL("../worker/" + file, import.meta.url))).href));
const apiParent = pathToFileURL(realpathSync(new URL("../worker/experience-intake-api.ts", import.meta.url))).href;
const apiPorts = {
  "./pilot-policy.ts": [["requireUser", "requireUser"], ["storePrivateContent", "store"]],
  "./project-intake.ts": [["commitAtomicIntake", "commit"], ["projectIntakeAuthority", "authority"]],
  "./experience-intake-read.ts": [["continueExperienceAuthorization", "authorize"], ["reply", "reply"], ["denied", "denied"], ["join", "join"], ["retainedGuard", "retainedGuard"], ["readDraft", "readDraft"]],
};
const listParent = pathToFileURL(realpathSync(new URL("../worker/experience-model3d-reference-list.ts", import.meta.url))).href;
const listPorts = {
  "./experience-intake-api.ts": [["authorizeExperienceIntake", "authorize"]],
  "./event-stream-read.ts": [["readEvents", "discoveryEvents"], ["streamHead", "discoveryHead"]],
  "./intake-authority.ts": [["projectIntakeAuthority", "authority"]],
  "./output-disclosure-proof.ts": [["captureOutputPrivateSources", "discoveryCapture"], ["verifyOutputSourceRead", "discoveryVerify"]],
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  const scopedPorts = context.parentURL === apiParent ? apiPorts : context.parentURL === listParent ? listPorts : portParents.has(context.parentURL) ? ports : {};
  if (Object.hasOwn(scopedPorts, specifier)) {
    const value = scopedPorts[specifier], exports = Array.isArray(value[0]) ? value : [value];
    const source = exports.map(([name, port]) => `export const ${name}=(...args)=>globalThis[Symbol.for("forma.video-reference-tests")].${port}(...args);`).join("\n");
    return { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
  }
  return next(specifier, context);
} });
const { inspectVideoReferenceCustody } = await import("../worker/video-reference-custody.ts");
const { handleExperienceVideoReference } = await import("../worker/experience-video-reference.ts");
const { prepareExperienceVideoReference, videoReferenceCommitGuard } = await import("../worker/experience-video-reference-source.ts");
const { handleExperienceIntake } = await import("../worker/experience-intake-api.ts");
const { model3dReferenceDiscoveryPage } = await import("../worker/experience-model3d-reference-list.ts");
hooks.deregister();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // Custody bytes, not decodable-image evidence.
const key = "u-6f776e6572/reference.png", mediaUrl = "/api/media/" + key;
function fixture() {
  const selection = { version: 1, sourceProjectId: "p", sourceDocumentId: "d", sourceBlockId: "b", referenceId: "r",
    sha256: sha(bytes), permissionAttestation: "i-own-or-have-permission" };
  const properties = { reference_id: "r", source_content_hash: selection.sha256, media_url: mediaUrl,
    media_type: "image/png", pixel_reference_mode: "preserve_style", weight: 1 };
  const events = [];
  const event = (type, payload) => events.push({ type, payload, eventId: "event-" + events.length, sequence: events.length + 1,
    streamId: "creative:owner", actor: "user:owner", occurredAt: "2026-09-13T00:00:00Z", correlationId: "fixture" });
  event("ProjectCreated", { project_id: "p", name: "Private source" });
  event("DocumentCreated", { project_id: "p", document_id: "d", title: "Private source" });
  event("BlockCreated", { block_id: "b", project_id: "p", document_id: "d", scope: "document", type: "reference", handle: "reference/still", position: "a", properties });
  event("ReferenceIngested", { reference_id: "r", source_ref: mediaUrl, content_hash: selection.sha256, rights_class: "owned" });
  event("RightsAsserted", { reference_id: "r", rights_class: "owned" });
  const controller = new AbortController(), calls = [];
  const principal = { userId: "owner", streamId: "creative:owner", role: "creator" };
  const auth = { user: principal, principal, impersonation: null };
  const block = { id: "b", type: "reference", scope: "document", removed: false, documentId: "d", projectId: "p", properties: { ...properties } };
  const trusted = { request: new Request("https://forma.invalid/api/experiences/video/reference/inspect", { signal: controller.signal }),
    scope: { kind: "personal", key: "personal:owner:d", ownerUserId: "owner", actorUserId: "owner", projectId: "p", documentId: "d", projectAccessId: null, organizationId: null, contextId: null },
    principal, projectContext: null, projection: { libraryBlocks: [block] },
    context: { snapshot: { facts: [{ block_id: "b", type: "reference", active: true, properties }] } },
    sourceProblems: [], sourcePrivateCaptured: true, sourceDigest: "e".repeat(64), ownerHead: 5,
    sourceAssertions: [{ sql: "current_source=?", bindings: [1] }], events };
  const object = () => ({ size: state.size, customMetadata: structuredClone(state.metadata),
    writeHttpMetadata(headers) { headers.set("content-type", state.mime); } });
  const env = { MEDIA: {
    async head(requested) { assert.equal(requested, key); calls.push("head"); await state.afterHead?.(); return object(); },
    async get(requested) { assert.equal(requested, key); calls.push("get"); await state.afterGet?.(); return { ...object(), body: new Blob([state.bytes]).stream() }; },
  }, DB: { prepare() { assert.fail("No direct write/read SQL outside final proof port"); } } };
  trusted.env = env;
  state = { bytes: new Uint8Array(bytes), size: bytes.length, mime: "image/png", metadata: { ownerId: "owner", sha256: selection.sha256 },
    authority() { calls.push("authority"); return { sql: "current_principal=?", bindings: [1] }; },
    deadlines() { return [{ sql: "current_deadline=?", bindings: [1] }]; },
    async verify(suppliedEnv, scope, head, assertions) {
      assert.equal(suppliedEnv, env); assert.equal(scope, trusted.scope); assert.equal(head, trusted.ownerHead);
      assert.deepEqual(assertions.map(value => value.sql), ["current_principal=?", "current_source=?", "current_deadline=?"]);
      calls.push("proof"); await state.afterProof?.(); if (state.proofError) throw state.proofError;
    },
    async authorize() { calls.push("auth"); return state.authResponse ?? auth; },
    body(request) { calls.push("body"); return request.json(); },
    async continued(request, suppliedEnv, id, permission, suppliedAuth) {
      calls.push("continued");
      assert.ok(request instanceof Request);
      assert.equal(suppliedEnv, env); assert.equal(id, "d"); assert.equal(permission, "read");
      assert.equal(suppliedAuth, auth, "source continuation must reuse the exact authenticated principal");
      state.continuedRequest = request;
      if (state.trustedError) throw state.trustedError;
      return state.trustedResponse ?? trusted;
    },
    async trusted(request, suppliedEnv, id, permission) {
      calls.push("trusted"); assert.equal(suppliedEnv, env); assert.equal(id, "d"); assert.equal(permission, "read");
      if (state.trustedError) throw state.trustedError;
      return state.trustedResponse ?? trusted;
    },
  };
  globalThis[symbol] = state;
  return { selection, properties, block, trusted, auth, env, calls, controller, event };
}
const inspect = f => inspectVideoReferenceCustody(f.trusted, f.auth, f.selection);
const rejects = (f, code) => assert.rejects(inspect(f), error => error.code === code);
const request = value => new Request("https://forma.invalid/api/experiences/video/reference/inspect", {
  method: "POST", headers: { origin: "https://forma.invalid", "content-type": "application/json" }, body: JSON.stringify(value),
});

test("Video selection excludes provider settings, URLs, mesh views and claimed authority", () => {
  const f = fixture(), good = readVideoReferenceIntent(f.selection);
  assert.deepEqual(good, f.selection); assert.ok(Object.isFrozen(good));
  for (const value of [null, [], [good], { ...good, url: mediaUrl }, { ...good, ownerId: "owner" }, { ...good, seconds: 15 },
    { ...good, kind: "saved-model-view" }, { ...good, permissionAttestation: true }, { ...good, permissionAttestation: "verified" },
    { ...good, sha256: "A".repeat(64) }, { ...good, sourceBlockId: "../b" }]) assert.equal(readVideoReferenceIntent(value), null);
  let reads = 0; const accessor = { ...good };
  Object.defineProperty(accessor, "sha256", { enumerable: true, get() { reads++; return good.sha256; } });
  assert.equal(readVideoReferenceIntent(accessor), null); assert.equal(reads, 0);
});

test("actual private-image reader and derived guard join property, latest ingestion, actual hash and final proof", async () => {
  const f = fixture(), result = await inspect(f);
  assert.deepEqual(result.content, { sha256: f.selection.sha256, byteLength: bytes.length, mimeType: "image/png" });
  assert.deepEqual(result.intent, { version: 1, seconds: 4, resolution: "480p", audioMode: "silent", referenceCount: 1 });
  assert.equal(result.sourceDigest, "e".repeat(64)); assert.ok(Object.isFrozen(result.content));
  assert.equal(f.calls.filter(call => call === "get").length, 1); assert.equal(f.calls.at(-1), "proof");
  assert.doesNotMatch(JSON.stringify(result), /api\/media|provider|"bytes"|"grant"/);
});

test("complete custody rechecks48MiB of distinct private history with an8MiB image retained", async () => {
  const f = fixture();
  state.bytes = new Uint8Array(8 * 1024 * 1024); state.bytes.set(bytes); state.size = state.bytes.length;
  const digest = sha(state.bytes);
  f.selection.sha256 = digest; f.properties.source_content_hash = digest;
  f.block.properties.source_content_hash = digest; state.metadata.sha256 = digest;
  f.trusted.events.find(event => event.type === "ReferenceIngested").payload.content_hash = digest;
  for (let i = 0; i < 768; i++) {
    const text = Buffer.alloc(65_536, 120); text.write(String(i));
    f.event("UnrelatedHistoryObservation", { text: text.toString("utf8") });
  }
  f.trusted.ownerHead = f.trusted.events.length;
  const result = await inspect(f);
  assert.equal(result.content.byteLength, 8 * 1024 * 1024);
  assert.equal(f.calls.filter(call => call === "get").length, 1);
  assert.equal(f.calls.at(-1), "proof");
});

test("scope, identity and canonical snapshot mismatches stop before private bytes", async () => {
  for (const mutate of [f => { f.trusted.scope.ownerUserId = "other"; }, f => { f.trusted.scope.projectAccessId = "shared"; },
    f => { f.selection.sourceProjectId = "other"; }, f => { f.auth.impersonation = {}; },
    f => { f.trusted.principal = { userId: "other" }; }, f => { f.trusted.principal.streamId = "another"; }]) {
    const f = fixture(); mutate(f); await rejects(f, "video_reference_scope_unavailable"); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.block.properties.media_url = "/api/media/other";
  await rejects(f, "video_reference_source_changed"); assert.equal(f.calls.includes("get"), false);
});

test("latest rights, expiry, active pixel opt-in and explicit likeness permission remain required", async () => {
  for (const payload of [{ rights_class: "withdrawn" }, { rights_class: "unknown" }, { rights_class: "owned", rights_expires_at: "2020-01-01T00:00:00Z" },
    { rights_class: "owned", rights_expires_at: "not-a-date" }]) {
    const f = fixture(); f.event("RightsAsserted", { reference_id: "r", ...payload });
    await rejects(f, "video_reference_rights_required"); assert.equal(f.calls.includes("get"), false);
  }
  for (const patch of [{ pixel_reference_mode: "context_only" }, { weight: 0 }]) {
    const f = fixture(); Object.assign(f.properties, patch); Object.assign(f.block.properties, patch);
    await rejects(f, "video_reference_pixel_permission_required");
  }
  const f = fixture(); const patch = { context_reference_kind: "character_identity", pixel_reference_mode: "preserve_subject" };
  Object.assign(f.properties, patch); Object.assign(f.block.properties, patch);
  await rejects(f, "video_reference_likeness_permission_required");
});

test("all three hashes are mandatory and latest ingestion cannot fall back to an older matching receipt", async () => {
  for (const mutate of [f => { delete f.properties.source_content_hash; delete f.block.properties.source_content_hash; },
    f => { f.selection.sha256 = "f".repeat(64); }]) {
    const f = fixture(); mutate(f); await rejects(f, "owned_image_reference_hash_required");
  }
  for (const patch of [{ content_hash: undefined }, { content_hash: "c".repeat(64) }, { source_ref: "/api/media/replaced" }]) {
    const f = fixture(); f.event("ReferenceIngested", { reference_id: "r", source_ref: mediaUrl, content_hash: f.selection.sha256, rights_class: "owned", ...patch });
    await rejects(f, "owned_image_reference_retained_hash_required");
  }
  const f = fixture(); state.bytes[0] = 0; await rejects(f, "owned_image_reference_source_changed");
});

test("unowned URLs, namespaces, object metadata and changed MIME/size are refused", async () => {
  for (const url of ["https://other.invalid/a.png", "/api/media/u-6f74686572/a.png", "/api/media/u-6f776e6572/../a.png", mediaUrl + "?x=1"]) {
    const f = fixture(); f.properties.media_url = url; f.block.properties.media_url = url;
    await rejects(f, "owned_image_reference_private_media_required"); assert.equal(f.calls.includes("get"), false);
  }
  for (const mutate of [() => { state.metadata.ownerId = "other"; }, () => { state.size = undefined; }, () => { state.size = 30 * 1024 * 1024 + 1; },
    () => { state.metadata.sha256 = "b".repeat(64); }]) {
    const f = fixture(); mutate(); await rejects(f, "owned_image_reference_media_unavailable");
  }
  const f = fixture(); state.mime = "image/svg+xml"; await rejects(f, "owned_image_reference_image_required");
  const replaced = fixture(); state.afterGet = () => { state.metadata.ownerId = "other"; };
  await rejects(replaced, "owned_image_reference_read_mismatch");
});

test("ordinary still path never interprets saved models, compositions or stripped stored markers", async () => {
  for (const patch of [{ model_url: "/api/media/model.glb" }, { reference_composition: {} }]) {
    const f = fixture(); Object.assign(f.properties, patch); Object.assign(f.block.properties, patch);
    await rejects(f, "owned_image_reference_ordinary_image_required");
  }
  const f = fixture(); state.metadata.modelView = "saved-camera";
  await rejects(f, "owned_image_reference_ordinary_image_required"); assert.equal(f.calls.includes("get"), false);
});

test("source/rights changes, cancelled reads and stale final proofs never produce inspected results", async () => {
  for (const mutate of [f => { f.trusted.ownerHead++; }, f => { f.event("RightsAsserted", { reference_id: "r", rights_class: "withdrawn" }); },
    f => { f.properties.source_content_hash = "d".repeat(64); }]) {
    const f = fixture(); state.afterGet = () => mutate(f); await rejects(f, "video_reference_source_changed");
  }
  const final = fixture(); state.afterProof = () => { final.trusted.sourceDigest = "changed"; }; await rejects(final, "video_reference_source_changed");
  const cancelled = fixture(); state.afterGet = () => cancelled.controller.abort();
  await assert.rejects(inspect(cancelled), error => error.name === "AbortError");
  const stale = fixture(); const sentinel = Error("final proof rejected"); state.proofError = sentinel;
  await assert.rejects(inspect(stale), error => error === sentinel); assert.equal(stale.calls.filter(call => call === "proof").length, 1);
});

test("actual endpoint remains authenticated, same-origin, private and explicitly non-generating", async () => {
  const f = fixture(), response = await handleExperienceVideoReference(request(f.selection), f.env), body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.status, "inspected"); assert.equal(body.generation, "unavailable"); assert.equal(body.persisted, false); assert.equal(body.transferAuthorized, false);
  assert.equal(f.calls.filter(call => call === "auth").length, 1); assert.equal(f.calls.filter(call => call === "trusted").length, 1);
  const cross = fixture(), denied = await handleExperienceVideoReference(new Request("https://forma.invalid/api/experiences/video/reference/inspect", {
    method: "POST", headers: { origin: "https://other.invalid" }, body: "{}",
  }), cross.env);
  assert.equal(denied.status, 403); assert.equal(cross.calls.length, 0);
});

test("handler preserves denied auth/read responses and hides arbitrary private errors", async () => {
  const f = fixture(); state.authResponse = new Response("consent required", { status: 403 });
  assert.equal(await handleExperienceVideoReference(request(f.selection), f.env), state.authResponse); assert.equal(f.calls.includes("trusted"), false);
  const source = fixture(); state.trustedResponse = new Response("read denied", { status: 403 });
  assert.equal(await handleExperienceVideoReference(request(source.selection), source.env), state.trustedResponse); assert.equal(source.calls.includes("get"), false);
  const unavailable = fixture(); state.trustedError = Error("private source identity");
  const loading = await handleExperienceVideoReference(request(unavailable.selection), unavailable.env);
  assert.equal(loading.status, 409); assert.doesNotMatch(await loading.text(), /private source identity|inspected/);
  const failed = fixture(); state.proofError = Error("private account details");
  const response = await handleExperienceVideoReference(request(failed.selection), failed.env);
  assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /private account details|inspected/);
});

test("Worker routes inspection before generic intake without adding a Video execution branch", () => {
  const source = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const inspection = source.indexOf('if(url.pathname==="/api/experiences/video/reference/inspect")return handleExperienceVideoReference(request,env);');
  assert.ok(inspection > 0 && inspection < source.indexOf('if(url.pathname==="/api/experiences"'));
  assert.match(source, /import \{ handleExperienceVideoReference \} from "\.\/experience-video-reference\.ts"/);
});


test("fresh Video source preparation retains original reference material and final proof inputs", async () => {
  const f = fixture();
  const source = await prepareExperienceVideoReference(f.trusted.request, f.env, f.auth, f.selection);
  assert.equal(source.head, f.trusted.ownerHead);
  assert.equal(source.reference.selection.referenceId, f.selection.referenceId);
  assert.deepEqual(source.reference.properties, f.block.properties);
  assert.equal(source.reference.sourceDigest, f.trusted.sourceDigest);
  assert.ok(Object.isFrozen(source.reference.properties));
  assert.match(source.guard.sql, /current_principal/); assert.match(source.guard.sql, /current_source/); assert.match(source.guard.sql, /current_deadline/);
  assert.equal(f.calls.filter(value => value === "continued").length, 1);
  assert.equal(state.continuedRequest, f.trusted.request);
  assert.equal(f.calls.includes("trusted"), false, "source preparation must not reauthenticate through HTTP");
  assert.equal(f.calls.filter(value => value === "get").length, 1);
  assert.equal(f.trusted.events.filter(event => event.type === "RightsAsserted").length, 1);
});

test("Video source continuation preserves denial and refuses impersonated or substituted principals before media", async () => {
  for (const mutate of [f => { f.auth.impersonation = {}; }, f => { f.auth.user = { ...f.auth.principal }; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(prepareExperienceVideoReference(f.trusted.request, f.env, f.auth, f.selection),
      error => error.code === "video_reference_scope_unavailable" && error.status === 403);
    assert.deepEqual(f.calls, []);
  }
  const denied = fixture(); state.trustedResponse = new Response("private denial", { status: 403 });
  await assert.rejects(prepareExperienceVideoReference(denied.trusted.request, denied.env, denied.auth, denied.selection),
    error => error.code === "video_reference_source_unavailable" && error.status === 403);
  assert.deepEqual(denied.calls, ["continued"]);
  const failed = fixture(), sentinel = Error("continuation failed"); state.trustedError = sentinel;
  await assert.rejects(prepareExperienceVideoReference(failed.trusted.request, failed.env, failed.auth, failed.selection),
    error => error === sentinel);
  assert.deepEqual(failed.calls, ["continued"]);
});

test("latest rights-event expiry reaches the eventual atomic save guard even without a block deadline", async () => {
  const f = fixture(), expires = "2099-01-01T00:00:00.000Z";
  f.event("RightsAsserted", { reference_id: "r", rights_class: "licensed", rights_expires_at: expires });f.trusted.ownerHead++;
  const source = await prepareExperienceVideoReference(f.trusted.request, f.env, f.auth, f.selection);
  assert.equal(f.block.properties.rights_expires_at, undefined);
  assert.ok(source.guard.bindings.includes(expires));assert.match(source.guard.sql, /strftime/);
});

test("Video source commit options retain exact source plan/head and refuse proof truncation", async () => {
  const f = fixture(), source = await prepareExperienceVideoReference(f.trusted.request, f.env, f.auth, f.selection);
  const plan = { projectId: "destination-project", documentId: "destination-document", reference: source.reference };
  const retained = { sql: "retained_original=?", bindings: ["original-private-plan"] };
  const options = videoReferenceCommitGuard(f.env, f.auth, plan, source, retained);
  assert.equal(options.expectedHead, source.head);assert.deepEqual(options.guard.bindings, [...retained.bindings, ...source.guard.bindings]);
  assert.match(options.guard.sql, /retained_original/);assert.match(options.guard.sql, /current_source/);
  const changed = structuredClone(plan);changed.reference.selection.sha256="0".repeat(64);
  assert.throws(()=>videoReferenceCommitGuard(f.env,f.auth,changed,source,retained),error=>error.code==="video_reference_source_changed");
  assert.throws(()=>videoReferenceCommitGuard(f.env,f.auth,plan,{...source,head:-1},retained),error=>error.code==="video_reference_source_changed");
  assert.throws(()=>videoReferenceCommitGuard(f.env,f.auth,plan,source,{sql:"large",bindings:Array(100).fill(1)}),error=>error.code==="video_reference_commit_proof_too_large"&&error.status===413);
  assert.equal(f.calls.filter(value=>value==="get").length,1,"guard construction does not substitute a second source");
});

test("Video source-plan mapping preserves original rights identity and the explicit authored selection",async()=>{
  const {readVideoReferencePlan,videoReferenceContextProperties}=await import("../src/experiences/video-reference-plan.ts");
  const f=fixture(),raw={version:1,selection:f.selection,sourceDigest:f.trusted.sourceDigest,properties:f.block.properties};
  const plan=readVideoReferencePlan(raw,f.selection);assert.ok(plan);const properties=videoReferenceContextProperties(plan);
  assert.equal(properties.reference_id,f.selection.referenceId);assert.equal(properties.source_content_hash,f.selection.sha256);
  assert.deepEqual(properties.experience_value,f.selection);assert.equal(properties.experience_origin,"authored");
  assert.deepEqual(properties.experience_reference_source,{project_id:"p",document_id:"d",block_id:"b",source_digest:f.trusted.sourceDigest});
  assert.equal(Object.hasOwn(properties,"rights_class"),false,"authored selection does not mint a rights class");
  for(const patch of [{model_url:"/api/media/model.glb"},{reference_composition:{}},{source_content_hash:"0".repeat(64)},{media_url:"https://other.invalid/a.png"}]){
    assert.equal(readVideoReferencePlan({...raw,properties:{...raw.properties,...patch}},f.selection),null);
  }
  assert.equal(readVideoReferencePlan({...raw,selection:{...f.selection,referenceId:"different"}},f.selection),null);
  const changed={...f.selection,permissionAttestation:"inferred"};assert.equal(readVideoReferencePlan(raw,changed),null);
});


const { registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, experienceDocumentRoute, parseExperienceEntryRoute } = await import("../src/experiences/intake.ts");
const { ExperienceIntakeRuntime } = await import("../src/experiences/intake-runtime.ts");
const { compileExperience } = await import("../src/experiences/compiler.ts");
const { contextCatalog } = await import("../src/experiences/catalog.ts");
const { EXPERIENCE_VIDEO_INTENT } = await import("../src/experiences/video-reference.ts");
const videoRelease = await registeredExperience("video");
function videoRequest(f, frame="landscape") {
  const values=initialValues(videoRelease);
  values.motion={value:"  Pan slowly toward the handle. 日本語  ",provenance:"authored"};
  values.frame={value:frame,provenance:"authored"};
  return {intentId:"33333333-3333-4333-8333-333333333333",experienceId:"video",releaseHash:videoRelease.releaseHash,values,reference:f.selection};
}
function videoPlan(f, input=videoRequest(f)) {
  return buildExperiencePlan("owner",input,videoRelease,{version:1,selection:f.selection,sourceDigest:f.trusted.sourceDigest,properties:f.block.properties});
}
function receipt(plan) {
  return {status:"complete",generation:"unavailable",draftId:plan.draftId,draftHash:plan.draftHash,
    projectId:plan.projectId,documentId:plan.documentId,documentRoute:experienceDocumentRoute(plan),rejected:[],head:plan.events.length,
    appended:plan.events.map((event,index)=>({...event,eventId:`00000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,
      actor:"user",streamId:plan.streamId,clientId:"web:experience-intake",correlationId:`experience-intake:${plan.projectId}`,
      schemaVersion:1,compensatesEventId:null,sequence:index+1}))};
}
test("Video registration keeps fixed intent, functional labels and closed frame choices",async()=>{
  assert.ok(videoRelease);assert.deepEqual(videoRelease.output.videoIntent,EXPERIENCE_VIDEO_INTENT);
  assert.deepEqual(Object.values(videoRelease.copy),["Motion","Frame"]);
  assert.deepEqual(videoRelease.interactions.frame.options.map(x=>x.value),["landscape","portrait"]);
  assert.deepEqual(parseExperienceEntryRoute(new URL("https://forma.invalid/experiences/video")),{output:"video"});
  for(const intent of [undefined,{...EXPERIENCE_VIDEO_INTENT,seconds:5},{...EXPERIENCE_VIDEO_INTENT,audioMode:"audio"},{...EXPERIENCE_VIDEO_INTENT,resolution:"720p"}]){
    const catalog=structuredClone(contextCatalog); if(intent)catalog.outputs[videoRelease.output.id].videoIntent=intent;else delete catalog.outputs[videoRelease.output.id].videoIntent;
    const result=await compileExperience(videoRelease.definition,catalog);assert.equal(result.ok,false);assert.ok(result.issues.some(x=>x.code==="video_intent_unavailable"));
  }
});
test("Video requires one explicit ordinary still; other outputs and source-plan substitution refuse",async()=>{
  const f=fixture(),input=videoRequest(f);assert.ok(await validateIntakeRequest(input));
  for(const reference of [undefined,null,{...f.selection,kind:"image"},{...f.selection,permissionAttestation:"inferred"}]){
    const invalid={...input};if(reference===undefined)delete invalid.reference;else invalid.reference=reference;
    assert.equal(await validateIntakeRequest(invalid),null);await assert.rejects(buildExperiencePlan("owner",invalid,videoRelease),/reference_invalid/);
  }
  assert.equal(await validateIntakeRequest({...input,values:{...input.values,frame:{value:"square",provenance:"authored"}}}),null);
  await assert.rejects(buildExperiencePlan("owner",input,videoRelease),/reference_invalid/);
  const plan=await videoPlan(f);await assert.rejects(buildExperiencePlan("owner",input,videoRelease,{...plan.reference,selection:{...f.selection,referenceId:"substitute"}}),/reference_invalid/);
  assert.equal(await validateIntakeRequest({...input,experienceId:"audio"}),null);
});
test("Video saved plan preserves authored motion/frame and original rights identity without generation records",async()=>{
  for(const [frame,size] of [["landscape","1280x720"],["portrait","720x1280"]]){
    const f=fixture(),input=videoRequest(f,frame),plan=await videoPlan(f,input);
    assert.deepEqual(plan,await buildExperiencePlan("owner",plan.request,plan.release,plan.reference));
    const blocks=plan.events.filter(e=>e.type==="BlockCreated");assert.equal(blocks.length,4);
    assert.equal(blocks[0].payload.properties.experience_value,input.values.motion.value);
    assert.equal(blocks[1].payload.properties.video_frame_size,size);
    assert.deepEqual(blocks[2].payload.properties.experience_video_intent,EXPERIENCE_VIDEO_INTENT);
    assert.equal(blocks[3].payload.handle,"reference/experience-video");assert.equal(blocks[3].payload.type,"reference");
    assert.equal(blocks[3].payload.properties.reference_id,f.selection.referenceId);
    assert.deepEqual(blocks[3].payload.properties.experience_value,f.selection);
    assert.equal(plan.events.some(e=>/RightsAsserted|ReferenceIngested|Generation|Job/.test(e.type)),false);
    assert.ok(Object.isFrozen(plan.reference.properties));
  }
  // Existing no-reference3D serialization remains exact across the union extension.
  const release=await registeredExperience("model3d"),values=initialValues(release);values.subject={value:"A single quiet object 日本語",provenance:"authored"};
  assert.equal(sha(JSON.stringify(await buildExperiencePlan("owner",{intentId:"33333333-3333-4333-8333-333333333333",experienceId:"model3d",releaseHash:release.releaseHash,values},release))),"ddc876e8d222848ff0331b67839c83ffd916cb489500a3401e66bf76cff2d0a0");
});
test("Video runtime cannot bypass required still readiness; edits and original receipt recovery preserve selection",async()=>{
  const f=fixture(),calls=[];let plan,original;
  const fetcher=async(path,init)=>{
    calls.push([path,init.method??"GET"]);
    if(path==="/api/experiences/drafts"){plan=await videoPlan(f,JSON.parse(init.body));original=receipt(plan);return Response.json({plan});}
    if(path.endsWith("/commit")){assert.deepEqual(JSON.parse(init.body),{draftHash:plan.draftHash});return Response.json(original);}
    return Response.json(path.endsWith("/receipt")?original:{plan});
  };
  const runtime=new ExperienceIntakeRuntime(videoRelease,fetcher);runtime.change("motion","Pan slowly");
  await runtime.prepare();assert.equal(calls.length,0);assert.equal(runtime.referenceReady,false);
  runtime.changeReference(null,true);await runtime.prepare();assert.equal(calls.length,0);
  runtime.changeReference(f.selection,false);await runtime.prepare();assert.equal(calls.length,0);
  assert.equal(runtime.changeReference({...f.selection,kind:"image"},true),false);
  runtime.changeReference(f.selection,true);runtime.change("frame","portrait");await runtime.prepare();assert.equal(runtime.state.phase,"review");
  assert.deepEqual(plan.request.reference,f.selection);await runtime.submit();assert.equal(runtime.state.phase,"complete");
  const resumed=new ExperienceIntakeRuntime(videoRelease,fetcher);await resumed.resume(plan.draftId);
  assert.equal(resumed.state.phase,"complete");assert.equal(resumed.documentRoute,runtime.documentRoute);assert.deepEqual(resumed.state.draft.reference,f.selection);
  assert.deepEqual(calls.map(x=>x[1]),["POST","POST","GET","GET"]);runtime.dispose();resumed.dispose();
});
function intakePorts(f){
  const saves=[],commits=[];let retained=null;
  state.reply=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
  state.denied=(error,status=409)=>state.reply({error},status);
  state.join=(a,b)=>({sql:`(${a.sql}) AND (${b.sql})`,bindings:[...a.bindings,...b.bindings]});
  state.requireUser=async(_request,env,role,options)=>{assert.equal(env,f.env);assert.equal(role,"creator");assert.equal(options.account,"principal");return {user:f.auth.user};};
  state.retainedGuard=()=>({sql:"retained_original=?",bindings:[retained.content]});
  state.readDraft=async(_env,_auth,id)=>retained?.plan.draftId===id?retained:null;
  state.store=async(_env,owner,kind,content,_scope,guard,_publish,identity)=>{
    assert.equal(owner,"owner");assert.equal(kind,"experience-draft");saves.push(guard);
    retained={plan:JSON.parse(content),content,expiresAt:"2099-01-01T00:00:00Z"};assert.equal(identity.contentId,retained.plan.draftId);
  };
  state.commit=async(_env,_auth,intake,action,options)=>{
    commits.push({action,options,intake});
    // Persistence and receipt transport are test ports, not actual SQL acceptance.
    return state.reply(action==="check"&&!state.completed?{status:"missing"}:receipt(retained.plan));
  };
  const call=async(path,input)=>handleExperienceIntake(new Request("https://forma.invalid/api/experiences/"+path,{
    method:input===undefined?"GET":"POST",headers:{"content-type":"application/json",origin:"https://forma.invalid"},
    ...(input===undefined?{}:{body:JSON.stringify(input)})}),f.env);
  return {saves,commits,call,get retained(){return retained;}};
}
test("actual Video intake handler rereads custody at save and commit and forwards combined proof/head to atomic intake",async()=>{
  const f=fixture(),p=intakePorts(f);const response=await p.call("drafts",videoRequest(f));assert.equal(response.status,200);
  assert.equal(p.saves.length,1);assert.match(p.saves[0].sql,/current_source/);assert.match(p.saves[0].sql,/MAX\(sequence\)/);assert.equal(p.saves[0].bindings.at(-1),5);
  const plan=p.retained.plan;const result=await p.call(`drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash});assert.equal(result.status,200);
  assert.deepEqual(p.commits.map(x=>x.action),["check","commit"]);assert.equal(p.commits[1].options.expectedHead,5);
  for(const name of ["retained_original","current_source","current_principal","current_deadline"])assert.ok(p.commits[1].options.guard.sql.includes(name));
  assert.equal(f.calls.filter(x=>x==="get").length,2);assert.deepEqual(p.commits[1].intake.events,plan.events);
  assert.equal((await result.json()).generation,"unavailable");
});
test("Video changed source refuses commit; an existing original receipt recovers without a replacement source",async()=>{
  const f=fixture(),p=intakePorts(f);await p.call("drafts",videoRequest(f));const plan=p.retained.plan;
  f.event("RightsAsserted",{reference_id:"r",rights_class:"withdrawn"});f.trusted.ownerHead++;
  let result=await p.call(`drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash});assert.equal(result.status,409);
  assert.equal((await result.json()).error,"video_reference_source_changed");assert.deepEqual(p.commits.map(x=>x.action),["check"]);
  state.completed=true;const reads=f.calls.filter(x=>x==="continued").length;
  result=await p.call(`drafts/${plan.draftId}/commit`,{draftHash:plan.draftHash});assert.equal((await result.json()).status,"complete");
  assert.equal(f.calls.filter(x=>x==="continued").length,reads);assert.equal(p.saves.length,1);assert.equal(p.commits.some(x=>x.action==="commit"),false);
});
test("Video malformed, stale review and private proof failures do not reach save or atomic mutation",async()=>{
  let f=fixture(),p=intakePorts(f);const invalid=videoRequest(f);delete invalid.reference;
  assert.equal((await p.call("drafts",invalid)).status,400);assert.equal(p.saves.length,0);assert.equal(f.calls.includes("get"),false);
  state.proofError=Error("private proof details");let failed=await p.call("drafts",videoRequest(f));assert.equal(failed.status,409);assert.doesNotMatch(await failed.text(),/private proof details/);assert.equal(p.saves.length,0);
  f=fixture();p=intakePorts(f);await p.call("drafts",videoRequest(f));failed=await p.call(`drafts/${p.retained.plan.draftId}/commit`,{draftHash:"changed"});assert.equal(failed.status,409);assert.equal(p.commits.length,0);
});


const { readVideoReferenceCandidate } = await import("../src/experiences/video-reference-candidate.ts");
const { isStandaloneExperienceRoute, parseExperienceHostRoute } = await import("../src/experiences/host-route.ts");
test("Video discovery emits no3D kind or permission; metadata and native route boundaries stay closed",()=>{
  const f=fixture(),{permissionAttestation,...source}=f.selection;
  const candidate={source,label:"Image 日本語",preview:mediaUrl};assert.deepEqual(readVideoReferenceCandidate(candidate),candidate);
  for(const bad of [{...candidate,source:{...source,permissionAttestation}},{...candidate,source:{...source,kind:"image"}},{...candidate,preview:"https://other.invalid/image.png"}])assert.equal(readVideoReferenceCandidate(bad),null);
  assert.equal(isStandaloneExperienceRoute("/experiences/video?progress-report"),true);
  const draftId = "experience-draft-" + "a".repeat(64);
  const route = "/document/document/video?experience=video&experience-draft=" + draftId;
  assert.deepEqual(parseExperienceHostRoute(route), {
    output: "video", draftId, documentId: "document", documentRoute: "/document/document/video",
  }, "registered Video host selects retained intake; the route is not generation authority");
  assert.equal(parseExperienceHostRoute(route + "&provider=claimed"), null);
  assert.equal(parseExperienceHostRoute(route + "&experience=video"), null);
});
test("shared discovery pages bounded personal projects and omits meshes/compositions from Video without changing3D defaults",()=>{
  const f=fixture(),events=[];let sequence=0;
  const push=(type,payload)=>events.push({type,payload,sequence:++sequence,eventId:"discovery-"+sequence});
  for(let p=0;p<8;p++){
    const project="p"+p,document="d"+p;push("ProjectCreated",{project_id:project,name:project});push("DocumentCreated",{project_id:project,document_id:document,title:document});
    for(let n=0;n<(p===0?26:1);n++)push("BlockCreated",{project_id:project,document_id:document,block_id:project+"-b"+String(n).padStart(2,"0"),type:"reference",scope:"document",handle:"reference/image",properties:f.properties});
    for(const [name,type,extra] of [["mesh","model3d",{}],["composed","reference",{reference_composition:{}}],["model","reference",{model_url:"/api/media/model.glb"}]])push("BlockCreated",{project_id:project,document_id:document,block_id:project+"-"+name,type,scope:"document",handle:"reference/"+name,properties:{...f.properties,...extra}});
  }
  const excluded=new Set(["p6"]),seen=[];let after=null,pages=0;
  do{const page=model3dReferenceDiscoveryPage(events,"owner",excluded,after,"video");assert(page.selected.length<=20);assert(new Set(page.selected.map(x=>x.block.projectId)).size<=5);
    seen.push(...page.selected.map(x=>x.block.id));after=page.next;assert(++pages<=4);
  }while(after!==null);
  assert.equal(seen.length,32);assert.equal(new Set(seen).size,32);assert(!seen.some(x=>/mesh|composed|model|p6/.test(x)));
  assert.deepEqual(model3dReferenceDiscoveryPage(events,"owner",excluded,null),model3dReferenceDiscoveryPage(events,"owner",excluded,null,"model3d"));
});
test("actual Video list endpoint uses shared authenticated head-pinned disclosure without reading media or asserting permission",async()=>{
  const f=fixture(),p=intakePorts(f);let verified=0,captured=0;
  state.discoveryHead=async()=>f.trusted.ownerHead;state.discoveryEvents=async()=>f.trusted.events;
  f.env.DB.prepare=sql=>{assert.match(sql,/SELECT project_id FROM organization_projects/);return {bind(owner){assert.equal(owner,"owner");return {all:async()=>({success:true,results:[]})};}};};
  state.discoveryCapture=async(_env,scope,events,projection,head)=>{captured++;assert.equal(scope.ownerUserId,"owner");assert.equal(events,f.trusted.events);assert.equal(head,5);assert.equal(projection.blocks.length,1);return [{sql:"exact_private_body=?",bindings:[1]}];};
  state.discoveryVerify=async(_env,scope,head,proofs)=>{verified++;assert.equal(scope.key,"personal:owner:reference-discovery");assert.equal(head,5);assert.equal(proofs.length,3);};
  const response=await p.call("video/references");assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
  const body=await response.json();assert.equal(body.candidates.length,1);assert.equal(body.qualification,"discovery-only");assert.equal(body.next,null);
  assert.ok(readVideoReferenceCandidate(body.candidates[0]));assert.equal(Object.hasOwn(body.candidates[0].source,"kind"),false);assert.equal(Object.hasOwn(body.candidates[0].source,"permissionAttestation"),false);
  assert.equal(captured,1);assert.equal(verified,1);assert.equal(f.calls.includes("get"),false);assert.equal(p.saves.length,0);assert.equal(p.commits.length,0);
  const stale=await p.call("video/references?after=p%2Fb&head=4");assert.equal(stale.status,409);assert.equal((await stale.json()).error,"video_reference_list_changed");assert.equal(verified,1);
});
