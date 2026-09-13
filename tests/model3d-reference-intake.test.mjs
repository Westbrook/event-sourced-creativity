import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const canonical = "/Users/westbrook/Documents/repos/codex/.wrangler/assistant-release-87d3137/";
const root = new URL("../", import.meta.url).href;
const key = Symbol.for("forma.model3d-reference-intake.new-controls");
let ports;
const mocks = {
  "./model3d-reference-custody.ts": ["inspectModel3dReferenceCustody", "inspect"],
  "./output-requirements-api.ts": ["loadOutputTrustedContext", "trusted"],
  "./intake-authority.ts": ["projectIntakeAuthority", "authority"],
  "./output-disclosure-proof.ts": [["outputActiveSourceDeadlineAssertions", "deadlines"], ["captureOutputPrivateSources", "capture"], ["verifyOutputSourceRead", "verify"]],
  "./experience-intake-api.ts": ["authorizeExperienceIntake", "authorize"],
  "./event-stream-read.ts": [["readEvents", "events"], ["streamHead", "head"]],
};
const hook = registerHooks({ resolve(specifier, context, next) {
  if (["../worker/experience-model3d-reference-source.ts", "../worker/experience-model3d-reference-list.ts"].some(path => context.parentURL === new URL(path, import.meta.url).href) && mocks[specifier]) {
    const entries = Array.isArray(mocks[specifier][0]) ? mocks[specifier] : [mocks[specifier]];
    return { url: "data:text/javascript," + encodeURIComponent(entries.map(([name, port]) => `export const ${name}=(...args)=>globalThis[Symbol.for("forma.model3d-reference-intake.new-controls")].${port}(...args)`).join("\n")), shortCircuit: true };
  }
  if (context.parentURL?.startsWith(root) && specifier.startsWith(".")) {
    const proposed = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(proposed))) {
      const relative = fileURLToPath(proposed).slice(fileURLToPath(root).length).replace(/^baseline-src\//u, "");
      return next(new URL(relative, "file://" + canonical).href, context);
    }
  }
  return next(specifier, context);
} });
const { readModel3dReferenceCandidate } = await import("../src/experiences/model3d-reference-candidate.ts");
const { readModel3dReferencePlan, isPrivateReferencePreview } = await import("../src/experiences/model3d-reference-plan.ts");
const { registeredExperience, buildExperiencePlan, validateIntakeRequest, initialValues, experienceDocumentRoute } = await import("../src/experiences/intake.ts");
const { ExperienceIntakeRuntime } = await import("../src/experiences/intake-runtime.ts");
const { readModel3dPreviewBytes } = await import("../src/experiences/model3d-reference-picker.ts");
const { prepareExperienceModel3dReference, model3dReferenceCommitGuard } = await import("../worker/experience-model3d-reference-source.ts");
const { model3dReferenceDiscoveryPage } = await import("../worker/experience-model3d-reference-list.ts");
hook.deregister();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array([137,80,78,71,13,10,26,10]); // Custody only; not a decoded image claim.
const camera = { version: 1, position: [0,0,6.4], target: [0,0,0], fov: 35, background: "#ffffff" };
function fixture(kind = "image") {
  const selection = { version: 1, kind, sourceProjectId: "project-source", sourceDocumentId: "document-source", sourceBlockId: "block-source",
    referenceId: "reference-original", sha256: sha(bytes), permissionAttestation: "i-own-or-have-permission" };
  const properties = { label: "  أداة <img src=x> 日本語  ", reference_id: selection.referenceId, source_content_hash: selection.sha256,
    media_url: "/api/media/u-6f776e6572/reference.png", media_type: "image/png", pixel_reference_mode: "style_reference",
    untouched: { literal: "\tline  one\nline two", rights_class: "owned" },
    ...(kind === "saved-model-view" ? { model_url: "/api/media/u-6f776e6572/original.glb", model_reference_id: "original-glb",
      model_content_hash: "a".repeat(64), model_view: structuredClone(camera) } : {}) };
  return { selection, properties, reference: { version: 1, selection, sourceDigest: "b".repeat(64), properties } };
}
const release = await registeredExperience("model3d");
function request(reference) {
  const values = initialValues(release);
  values.subject = { value: "A single quiet object 日本語", provenance: "authored" };
  return { intentId: "33333333-3333-4333-8333-333333333333", experienceId: "model3d", releaseHash: release.releaseHash, values, ...(reference ? { reference } : {}) };
}
test("text-only model3d plans remain byte-identical; other outputs cannot carry a reference", async () => {
  const input = request();
  // Exact before-donor source22792aa7 and releasef53f5cbc; no legacy helper import.
  assert.equal(sha(JSON.stringify(await buildExperiencePlan("owner", input, release))), "ddc876e8d222848ff0331b67839c83ffd916cb489500a3401e66bf76cff2d0a0");
  assert.ok(await validateIntakeRequest(input));
  assert.equal(await validateIntakeRequest({ ...input, reference: null }), null);
  assert.equal(await validateIntakeRequest({ ...input, experienceId: "audio", reference: fixture().selection }), null);
  await assert.rejects(buildExperiencePlan("owner", input, release, fixture().reference), /reference_invalid/u);
});

test("reference plan is exact immutable authored material; saved view retains original model/camera", async () => {
  for (const kind of ["image", "saved-model-view"]) {
    const f = fixture(kind), input = request(f.selection), plan = await buildExperiencePlan("owner", input, release, f.reference);
    assert.ok(await validateIntakeRequest(input)); assert.deepEqual(plan.reference, f.reference);
    const copied = plan.events.find(event => event.payload.handle === "reference/experience-model3d");
    assert.ok(copied); assert.equal(copied.payload.project_id, plan.projectId); assert.equal(copied.payload.document_id, plan.documentId);
    assert.notEqual(copied.payload.block_id, f.selection.sourceBlockId);
    assert.equal(Object.hasOwn(copied.payload, "reference_id"), false);
    assert.equal(plan.events.some(event => ["RightsAsserted", "ReferenceIngested"].includes(event.type)), false);
    const { experience_reference_source, ...rest } = copied.payload.properties;
    assert.deepEqual(rest, f.properties); assert.equal(experience_reference_source.block_id, f.selection.sourceBlockId);
    assert.equal(experience_reference_source.source_digest, f.reference.sourceDigest);
    f.properties.untouched.literal = "later mutation"; assert.notEqual(plan.reference.properties.untouched.literal, "later mutation");
    assert.ok(Object.isFrozen(plan.reference.properties.untouched));
  }
});

test("discovery is closed, private and not permission evidence; malformed source plans refuse", () => {
  const f = fixture(), { permissionAttestation, ...source } = f.selection;
  const candidate = { source, label: f.properties.label, preview: f.properties.media_url };
  assert.deepEqual(readModel3dReferenceCandidate(candidate), candidate);
  assert.equal(Object.hasOwn(readModel3dReferenceCandidate(candidate).source, "permissionAttestation"), false);
  for (const preview of ["https://example.test/private.png", "//evil.test/x", "/api/media/../x", "/api/media/%2e%2e/x", "/api/media/x?token=x"]) {
    assert.equal(isPrivateReferencePreview(preview), false);
    assert.equal(readModel3dReferenceCandidate({ ...candidate, preview }), null);
  }
  for (const invalid of [{ ...candidate, owner: "owner" }, { ...candidate, source: { ...source, permissionAttestation } }]) assert.equal(readModel3dReferenceCandidate(invalid), null);
  for (const invalid of [
    { ...f.reference, sourceDigest: "" }, { ...f.reference, selection: { ...f.selection, sha256: "a".repeat(64) } },
    { ...f.reference, properties: { ...f.properties, model_url: "/api/media/mesh.glb" } },
    { ...f.reference, properties: { ...f.properties, source_content_hash: undefined } },
  ]) assert.equal(readModel3dReferencePlan(invalid, f.selection), null);
});

test("pending or failed selection cannot silently prepare text-only; authored text retains selection", async () => {
  let calls = 0;
  const runtime = new ExperienceIntakeRuntime(release, async () => { calls++; throw Error("unexpected transport"); });
  runtime.change("subject", "Literal subject"); assert.equal(runtime.changeReference(null, false), true);
  await runtime.prepare(); assert.equal(calls, 0); assert.equal(runtime.state.phase, "setup");
  assert.deepEqual(runtime.state.issues, [{ code: "model3d_reference_not_ready", path: "$reference" }]);
  const f = fixture(); runtime.changeReference(f.selection, true); runtime.change("subject", "Changed subject");
  assert.deepEqual(runtime.state.draft.reference, f.selection); assert.equal(runtime.referenceReady, true);
  assert.equal(runtime.changeReference({ ...f.selection, permissionAttestation: true }, true), false);
  runtime.changeReference(null, true); assert.equal(Object.hasOwn(runtime.state.draft, "reference"), false);
  runtime.dispose();
});

test("literal reference request accepts only exact rebuilt plan and original commit receipt", async () => {
  const f = fixture(); let plan; const calls = [];
  const runtime = new ExperienceIntakeRuntime(release, async (path, init) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body });
    if (path === "/api/experiences/drafts") {
      plan = await buildExperiencePlan("owner", JSON.parse(init.body), release, f.reference);
      return Response.json({ status: "prepared", plan });
    }
    assert.equal(path, `/api/experiences/drafts/${plan.draftId}/commit`);
    assert.deepEqual(JSON.parse(init.body), { draftHash: plan.draftHash });
    return Response.json({ status: "complete", generation: "unavailable", draftId: plan.draftId, draftHash: plan.draftHash,
      projectId: plan.projectId, documentId: plan.documentId, documentRoute: experienceDocumentRoute(plan), rejected: [], head: plan.events.length,
      appended: plan.events.map((event, index) => ({ ...event, eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12,"0")}`,
        actor: "user", streamId: plan.streamId, clientId: "web:experience-intake", correlationId: `experience-intake:${plan.projectId}`,
        schemaVersion: 1, compensatesEventId: null, sequence: index + 1 })) });
  });
  runtime.change("subject", "Literal subject"); runtime.changeReference(f.selection, true);
  await runtime.prepare(); assert.equal(runtime.state.phase, "review");
  assert.deepEqual(JSON.parse(calls[0].body).reference, f.selection);
  await runtime.submit(); assert.equal(runtime.state.phase, "complete"); assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.method === "POST")); runtime.dispose();
});

test("retired runtime ignores late prepare without creating or rebasing a request", async () => {
  let resolve; const pending = new Promise(done => { resolve = done; }); let saved;
  const runtime = new ExperienceIntakeRuntime(release, async (path, init) => { saved = JSON.parse(init.body); return pending; });
  runtime.change("subject", "Late subject"); const active = runtime.prepare(); runtime.dispose();
  resolve(Response.json({ plan: await buildExperiencePlan("owner", saved, release) })); await active;
  assert.notEqual(runtime.state.phase, "review"); assert.equal(runtime.receipt, undefined);
});

function sourcePorts(f = fixture()) {
  const calls = [], controller = new AbortController();
  const trusted = { ownerHead: 11, context: { snapshot: {} }, projection: { libraryBlocks: [{ id: f.selection.sourceBlockId, properties: f.properties }] },
    sourceAssertions: [{ sql: "private_source_exact=?", bindings: ["source-private-body"] }] };
  ports = {
    trusted: async () => trusted,
    inspect: async (given, auth, selection) => { calls.push("inspect"); assert.equal(given, trusted); assert.deepEqual(selection, f.selection); return { sourceDigest: f.reference.sourceDigest }; },
    authority: () => ({ sql: "real_authority_port=?", bindings: ["synthetic-authority"] }),
    deadlines: () => [{ sql: "real_deadline_port>?", bindings: [123] }],
  };
  globalThis[key] = ports;
  return { f, calls, trusted, controller, env: {}, auth: {}, request: new Request("https://forma.invalid/api/experiences/drafts", { signal: controller.signal }) };
}
test("fresh server-source read keeps all private/authority/deadline proofs and exact owner head", async () => {
  const p = sourcePorts(); const source = await prepareExperienceModel3dReference(p.request, p.env, p.auth, p.f.selection);
  assert.deepEqual(p.calls, ["inspect"]); assert.equal(source.head, 11); assert.deepEqual(source.reference, p.f.reference);
  const plan = await buildExperiencePlan("owner", request(p.f.selection), release, p.f.reference);
  const combined = model3dReferenceCommitGuard(p.env, p.auth, plan, source, { sql: "retained_draft=?", bindings: ["exact-draft"] });
  assert.equal(combined.expectedHead, 11); assert.deepEqual(combined.guard.bindings, ["exact-draft", "synthetic-authority", "source-private-body", 123]);
  for (const name of ["retained_draft", "real_authority_port", "private_source_exact", "real_deadline_port"]) assert.ok(combined.guard.sql.includes(name));
  assert.throws(() => model3dReferenceCommitGuard(p.env, p.auth, plan, { ...source, reference: { ...source.reference, sourceDigest: "c".repeat(64) } }, { sql: "1", bindings: [] }), /source_changed/u);
  assert.throws(() => model3dReferenceCommitGuard(p.env, p.auth, plan, { ...source, guard: { sql: "1", bindings: Array(82).fill(1) } }, { sql: "1", bindings: [] }), /proof_too_large/u);
});

test("source failure, authorization response and abort refuse rather than copying caller facts", async () => {
  const p = sourcePorts();
  ports.trusted = async () => new Response(null, { status: 403 });
  await assert.rejects(prepareExperienceModel3dReference(p.request, p.env, p.auth, p.f.selection), /source_unavailable/u);
  assert.equal(p.calls.length, 0);
  ports.trusted = async () => p.trusted; ports.inspect = async () => { throw Error("private source refused"); };
  await assert.rejects(prepareExperienceModel3dReference(p.request, p.env, p.auth, p.f.selection), /private source refused/u);
  ports.inspect = async () => ({ sourceDigest: p.f.reference.sourceDigest }); p.controller.abort();
  await assert.rejects(prepareExperienceModel3dReference(p.request, p.env, p.auth, p.f.selection), /abort/u);
});

test("preview reads exact bounded private bytes; MIME, hash, empty, overflow and abort refuse", async () => {
  const signal = new AbortController().signal;
  const result = await readModel3dPreviewBytes(new Response(bytes, { headers: { "content-type": "image/png" } }), sha(bytes), signal);
  assert.deepEqual(result.bytes, bytes); assert.equal(result.mime, "image/png");
  for (const response of [
    new Response(bytes, { headers: { "content-type": "text/html" } }),
    new Response(bytes, { status: 403, headers: { "content-type": "image/png" } }),
    new Response(new Uint8Array(), { headers: { "content-type": "image/png" } }),
  ]) await assert.rejects(readModel3dPreviewBytes(response, sha(bytes), signal));
  await assert.rejects(readModel3dPreviewBytes(new Response(bytes, { headers: { "content-type": "image/png" } }), "f".repeat(64), signal));
  await assert.rejects(readModel3dPreviewBytes(new Response(new Uint8Array(24 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }), "f".repeat(64), signal));
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(readModel3dPreviewBytes(new Response(bytes, { headers: { "content-type": "image/png" } }), sha(bytes), stopped.signal));
});

test("explicit-project discovery pages all personal sources instead of only the last project", () => {
  const events = []; let sequence = 0;
  const push = (type, payload) => events.push({ eventId: "page-" + ++sequence, sequence, type, payload });
  for (let project = 0; project < 8; project++) {
    const projectId = "project-" + project, documentId = "doc-" + project;
    push("ProjectCreated", { project_id: projectId, name: projectId });
    push("DocumentCreated", { project_id: projectId, document_id: documentId, title: documentId });
    for (let index = 0; index < (project === 0 ? 26 : 1); index++) {
      const blockId = projectId + "-block-" + String(index).padStart(2, "0");
      push("BlockCreated", { project_id: projectId, document_id: documentId, block_id: blockId, type: "reference",
        scope: "document", handle: blockId, properties: fixture().properties });
    }
  }
  const seen = []; let after = null, pages = 0;
  do {
    const page = model3dReferenceDiscoveryPage(events, "owner", new Set(["project-6"]), after);
    assert(page.selected.length <= 20);
    assert(new Set(page.selected.map(item => item.block.projectId)).size <= 5);
    if (pages === 0) { assert.equal(page.selected.length, 20); assert.equal(page.next, "project-0/project-0-block-19"); }
    assert(!page.selected.some(item => item.block.projectId === "project-6"));
    seen.push(...page.selected.map(item => item.block.id));
    assert.notEqual(page.next, after === null ? "never" : after); after = page.next; assert(++pages <= 4);
  } while (after !== null);
  assert.equal(seen.length, 32); assert.equal(new Set(seen).size, seen.length);
  assert(seen.includes("project-0-block-00")); assert(seen.includes("project-7-block-00"));
});
