import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { outputTestDatabase, registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { modelBytes } from "./model3d-native/assets.mjs";

// Declared document-grounded synthetic origin and distinct synthetic people.
// Actual local handlers save, share, review and release; no provider is run,
// no browser is represented and no review event or shared ACL is fixture-written.
const imports = registerOutputSourceImports();
let runtime, handleArtifactEdit, handleWorkspaces, handleSession, handleEvents, mediaApi, model, foldEvents, artifactApprovalMatches, artifactDeliveryState, scaleModel3dGeometry;
try {
  [runtime, { handleArtifactEdit }, { handleWorkspaces }, { handleSession }, { handleEvents }, mediaApi, model,
    { foldEvents }, { artifactApprovalMatches, artifactDeliveryState }, { scaleModel3dGeometry }] = await Promise.all([
    import("../worker/runtime.ts"), import("../worker/artifact-api.ts"), import("../worker/workspaces-api.ts"),
    import("../worker/pilot-policy.ts"), import("../worker/events-api.ts"), import("../worker/media-api.ts"),
    import("../src/model/document-artifacts.ts"), import("../src/model/events.ts"),
    import("../src/model/artifact-delivery.ts"), import("../src/model/model3d-geometry-edit.ts"),
  ]);
} finally { imports.deregister(); }

const hash = value => createHash("sha256").update(value).digest("hex");
const OWNER = "dev-local-creative", REVIEWER = "generated-model-independent-reviewer";
const PROJECT = "generated-model-review-project", DOCUMENT = "generated-model-review-document";
const ARTIFACT = "generated-model-review-artifact", CONTENT = "generated-model-review-content", BLOCK = "generated-model-review-direction";
const MIME = "model/gltf-binary", EXPIRY = "2099-01-01T00:00:00.000Z";
const json = value => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const encoded = value => new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
async function preserve(name, bytes) {
  const directory = process.env.GENERATED_MODEL3D_REVIEW_ACTUAL_DIR;
  if (!directory) return;
  assert.ok(isAbsolute(directory)); assert.match(name, /^[a-z0-9][a-z0-9.-]*$/u);
  const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
}

// Finite real API sequence from artifact-review-host's sharing setup. It is
// deliberately performed AFTER the personal Save, not faked with scoped rows.
async function shareWithIndependentReviewer(f) {
  const organization = await f.request("/api/workspaces", json({ name: "Generated model exact review fixture" }));
  assert.equal(organization.status, 201, await organization.clone().text());
  const organizationId = (await organization.json()).organizationId;
  const project = await f.request(`/api/workspaces/${organizationId}/projects`, json({ projectId: PROJECT }));
  assert.equal(project.status, 201, await project.clone().text());
  const projectAccessId = (await project.json()).projectAccessId;
  const base = `/api/workspaces/${organizationId}/projects/${projectAccessId}`;
  const context = await f.request(base + "/context", { method: "POST" });
  assert.equal(context.status, 200, await context.clone().text());
  const ownerHeaders = { cookie: context.headers.get("set-cookie").split(";")[0] };
  const reviewerAuth = { "oai-authenticated-user-id": REVIEWER, "oai-authenticated-user-email": REVIEWER + "@example.test" };
  f.setHeaders(reviewerAuth);
  assert.equal((await f.request("/api/session")).status, 200);
  assert.equal((await f.request("/api/session", json({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }))).status, 200);
  f.setHeaders(ownerHeaders);
  const invite = await f.request(`/api/workspaces/${organizationId}/members`, json({ email: REVIEWER + "@example.test", role: "member" }));
  assert.equal(invite.status, 201, await invite.clone().text());
  const invitation = await invite.json();
  f.setHeaders(reviewerAuth);
  const accepted = await f.request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,
    json({ token: new URL(invitation.invitationUrl).searchParams.get("token") }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  f.setHeaders(ownerHeaders);
  const member = await f.request(base + "/members", json({ userId: REVIEWER, role: "viewer" }));
  assert.equal(member.status, 201, await member.clone().text());
  const listed = await f.request(base + "/members"); assert.equal(listed.status, 200);
  const row = (await listed.json()).members.find(value => value.user_id === REVIEWER); assert.ok(row);
  const setReviewAccess = async value => {
    f.setHeaders(ownerHeaders);
    const response = await f.request(base + "/members/" + row.membership_id, { ...json({ reviewAccess: value }), method: "PATCH" });
    assert.equal(response.status, 200, await response.clone().text());
  };
  await setReviewAccess(true);
  f.setHeaders(reviewerAuth);
  const reviewerContext = await f.request(base + "/context", { method: "POST" });
  assert.equal(reviewerContext.status, 200, await reviewerContext.clone().text());
  const reviewerHeaders = { ...reviewerAuth, cookie: reviewerContext.headers.get("set-cookie").split(";")[0] };
  f.setHeaders(ownerHeaders);
  return { organizationId, projectAccessId, base, ownerHeaders, reviewerHeaders, reviewerAuth, setReviewAccess };
}

async function fixture(t, name, { sourceVersions = [{ block_id: BLOCK, version: 1 }] } = {}) {
  const state = outputTestDatabase(), requests = [], pending = [], backgroundFailures = [], mediaCalls = [];
  let scopedHeaders = {}, fetchAttempts = 0, assetsAttempts = 0, closed = false, accounting = () => null;
  const beforeFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchAttempts++; throw new Error("generated_model_review_network_forbidden"); };
  state.env.ASSETS = { fetch() { assetsAttempts++; throw new Error("generated_model_review_assets_forbidden"); } };
  const execution = { waitUntil(promise) { pending.push(Promise.resolve(promise).catch(error => { backgroundFailures.push(String(error)); })); } };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); assert.deepEqual(backgroundFailures, []); };
  for (const method of ["put", "get", "head", "delete", "list"]) {
    const original = state.env.MEDIA[method].bind(state.env.MEDIA);
    state.env.MEDIA[method] = async (...args) => {
      mediaCalls.push({ method, key: typeof args[0] === "string" ? args[0] : null });
      assert.ok(mediaCalls.length <= 180, "finite owned MEDIA operations");
      return original(...args);
    };
  }
  t.after(async () => {
    try { await drain(); assert.equal(fetchAttempts, 0); assert.equal(assetsAttempts, 0); } finally {
      let finalAccounting = null;
      try { finalAccounting = accounting(); } finally {
        globalThis.fetch = beforeFetch;
        try { state.sqlite.close(); closed = true; } finally { state.media.clear(); }
      }
      await preserve(name + "-closure.json", encoded({ databaseClosed: closed, mediaObjectsAfterDisposal: state.media.size,
        pending: pending.length, backgroundFailures, fetchAttempts, assetsAttempts, finalAccounting, requests, mediaCalls }));
    }
  });
  await runtime.ensureSchema(state.env);
  const now = new Date().toISOString(), stream = `creative:${OWNER}`;
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(OWNER, "creative@local.forma", "Synthetic model author", now, now, now);
  const authored = (type, payload) => runtime.appendAuditEvent(state.env, stream, `user:${OWNER}`, type, { project_id: PROJECT, document_id: DOCUMENT, ...payload });
  await authored("ProjectCreated", { name: "Generated model independent review" });
  await authored("DocumentCreated", { title: "Declared synthetic cube source", handle: "model-review" });
  await authored("BlockCreated", { block_id: BLOCK, type: "direction", scope: "document", position: "a0", handle: "direction/cube",
    properties: { text: "Make one static cube; preserve its topology and material when scaling.", weight: 1 } });
  const originalBytes = modelBytes();
  const originalMedia = await mediaApi.storeGeneratedMedia(state.env, OWNER, ARTIFACT + "-original", originalBytes,
    "authored-local-cube", MIME, { source: "synthetic-retained-fixture", rights: "asserted" });
  const selectedFile = { url: originalMedia.url, mimeType: MIME, fileName: "original-cube.glb", fileSize: originalBytes.length,
    format: "glb", role: "mesh", sha256: hash(originalBytes), previewSupported: true };
  const content = model.parseDocumentArtifactContent(JSON.stringify({ title: "Synthetic grounded cube", summary: "Owned local fixture, no provider output claim.",
    content_markdown: "Scale the cube without changing topology or material. Café 雨 🌱.", presentation: null, items: [] }));
  assert.ok(content); content.producer_note = { literal: "Keep the original source and modeling note.", source: "synthetic" };
  const raw = JSON.stringify(content);
  state.sqlite.prepare("INSERT INTO private_content(content_id,owner_id,kind,content,created_at,expires_at,redacted_at) VALUES(?,?,?,?,?,?,NULL)")
    .run(CONTENT, OWNER, "document-artifact", raw, now, EXPIRY);
  const completion = await runtime.appendAuditEvent(state.env, stream, "worker:renderer", "DocumentRenderCompleted", {
    project_id: PROJECT, document_id: DOCUMENT, artifact_id: ARTIFACT, artifact_kind: "model3d", requested_by_user_id: OWNER,
    title: content.title, content_ref: CONTENT, content_expires_at: EXPIRY, item_count: 0, items: [], presentation: null,
    source_block_versions: sourceVersions, media_url: originalMedia.url, media_type: MIME,
    settings: { item_count: 1, model3d_files: [selectedFile], source_media_sha256: selectedFile.sha256 },
  });
  const originalCompletion = state.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(completion.eventId);
  const rawNow = () => state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(CONTENT).content;
  const rows = () => state.sqlite.prepare("SELECT * FROM artifact_revisions WHERE owner_id=? AND artifact_id=? ORDER BY revision").all(OWNER, ARTIFACT);
  const objects = () => [...state.media].map(([key, value]) => [key, { bytes: new Uint8Array(value.bytes), metadata: structuredClone(value.metadata), contentType: value.contentType }]);
  const count = table => state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  // Session initialization may create empty counters. Actual usage/reservations,
  // rather than counter-row existence, determine whether this flow spent work.
  accounting = () => ({ document_jobs: count("document_jobs"), budget_reservations: count("budget_reservations"), cost_budget_reservations: count("cost_budget_reservations"),
    tokens: { ...state.sqlite.prepare("SELECT COALESCE(SUM(ABS(used_tokens)),0) AS used,COALESCE(SUM(ABS(reserved_tokens)),0) AS reserved FROM budget_counters").get() },
    money: { ...state.sqlite.prepare("SELECT COALESCE(SUM(ABS(used_microusd)),0) AS used,COALESCE(SUM(ABS(reserved_microusd)),0) AS reserved FROM cost_budget_counters").get() } });
  const initialAccounting = accounting();
  const request = async (route, init = {}) => {
    assert.ok(route.startsWith("/api/")); assert.ok(requests.length < 120, "finite direct handler requests");
    const value = new Request("http://localhost" + route, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...scopedHeaders } });
    const path = new URL(value.url).pathname;
    const entry = { route, method: value.method, actor: scopedHeaders["oai-authenticated-user-id"] ?? OWNER }; requests.push(entry);
    let response;
    if (path === "/api/session") response = await handleSession(value, state.env, execution);
    else if (path.startsWith("/api/workspaces")) response = await handleWorkspaces(value, state.env, path.slice("/api/workspaces".length).split("/").filter(Boolean).map(decodeURIComponent));
    else if (path === "/api/events") {
      if (value.method !== "GET") {
        const body = JSON.parse(init.body); assert.equal(body.action, "append");
        assert.ok(["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported", "BlockPropertyEdited"].includes(body.event?.type));
      }
      response = await handleEvents(value, state.env);
    } else if (path.startsWith("/api/artifacts/")) {
      const [artifactId, ...segments] = path.slice("/api/artifacts/".length).split("/").map(decodeURIComponent);
      assert.equal(artifactId, ARTIFACT); assert.ok(value.method === "PATCH" || value.method === "GET"
        || value.method === "POST" && segments.length === 3 && segments[0] === "revisions" && segments[1] === "1" && segments[2] === "restore");
      response = await handleArtifactEdit(value, state.env, artifactId, segments);
    } else {
      assert.ok(path.startsWith("/api/media/")); assert.equal(value.method, "GET");
      response = await mediaApi.getMedia(value, decodeURIComponent(path.slice("/api/media/".length)), state.env);
    }
    entry.status = response.status; return response;
  };
  const eventPage = async () => {
    const response = await request("/api/events?after=0&limit=2000&content=1");
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json(); assert.equal(body.hasMore, false); return body;
  };
  const append = async (type, payload, expectedStatus = 200, expectedError) => {
    const before = await eventPage();
    const response = await request("/api/events", json({ action: "append", clientId: "generated-model-review-test", expectedSequence: before.head,
      event: { type, payload: { project_id: PROJECT, document_id: DOCUMENT, artifact_id: ARTIFACT, ...payload } } }));
    assert.equal(response.status, expectedStatus, await response.clone().text());
    const body = await response.json(); if (expectedError) assert.equal(body.error, expectedError);
    if (expectedStatus !== 200) assert.deepEqual(await eventPage(), before, "a refused command leaves actual project events/content unchanged");
    return body;
  };
  return { ...state, originalBytes, originalMedia, raw, rawNow, completion, originalCompletion, rows, objects,
    sourceVersions, accounting, initialAccounting, request, eventPage, append, setHeaders(value) { scopedHeaders = { ...value }; }, drain, requests, mediaCalls };
}

// Small independent reader for the actual returned GLB. It checks POSITION
// values, topology and material rather than asking the production writer to
// validate its own result. No decoder, renderer or native modeling app is used.
function geometry(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67); assert.equal(view.getUint32(4, true), 2);
  assert.equal(view.getUint32(8, true), bytes.length); assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const jsonLength = view.getUint32(12, true), binLength = view.getUint32(20 + jsonLength, true);
  assert.equal(view.getUint32(24 + jsonLength, true), 0x004e4942); assert.equal(bytes.length, 28 + jsonLength + binLength);
  const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)));
  const primitive = document.meshes[0].primitives[0], accessor = document.accessors[primitive.attributes.POSITION];
  const buffer = document.bufferViews[accessor.bufferView], binary = bytes.subarray(28 + jsonLength);
  assert.equal(accessor.componentType, 5126); assert.equal(accessor.type, "VEC3"); assert.equal(accessor.count, 8);
  const bin = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const positions = Array.from({ length: accessor.count }, (_, vertex) => [0, 1, 2].map(axis => bin.getFloat32(
    (buffer.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + vertex * (buffer.byteStride ?? 12) + axis * 4, true)));
  const index = document.accessors[primitive.indices], indexView = document.bufferViews[index.bufferView];
  assert.equal(index.componentType, 5123); assert.equal(index.count, 36);
  const indices = Array.from({ length: index.count }, (_, i) => bin.getUint16((indexView.byteOffset ?? 0) + (index.byteOffset ?? 0) + i * 2, true));
  return { positions, indices, materials: document.materials, scenes: document.scenes, nodes: document.nodes };
}

test("personally saved generated Model3D revision 1 is shared, independently approved and released as the exact edited GLB", { timeout: 30000 }, async t => {
  const f = await fixture(t, "joined"), request = { expectedRevision: 0, expectedContentSha256: hash(f.raw),
    model3dScale: { sourceMediaSha256: hash(f.originalBytes), factor: 2, resultMediaSha256: hash(scaleModel3dGeometry(f.originalBytes, 2).bytes) } };
  const response = await f.request(`/api/artifacts/${ARTIFACT}`, { ...json(request), method: "PATCH" });
  assert.equal(response.status, 200, await response.clone().text());
  const ack = await response.json(), raw = f.rawNow(), content = JSON.parse(raw), record = content.model3d_revision;
  assert.equal(ack.revision, 1); assert.equal(ack.appended.length, 1); assert.equal(ack.appended[0].type, "DocumentArtifactEdited");
  assert.equal(ack.content[CONTENT], raw); assert.equal(ack.appended[0].payload.content_sha256, hash(raw));
  assert.deepEqual(ack.appended[0].payload.model3d_revision, record); assert.deepEqual(ack.appended[0].payload.changed_fields, ["model3d_revision"]);
  const unchanged = { ...content }; delete unchanged.model3d_revision; assert.deepEqual(unchanged, JSON.parse(f.raw));
  assert.equal(record.source.revision, 0); assert.equal(record.source.contentSha256, hash(f.raw));
  assert.equal(record.source.sha256, hash(f.originalBytes)); assert.equal(record.source.url, f.originalMedia.url);
  const personalRows = f.rows(), savedObjects = f.objects();
  assert.deepEqual(personalRows.map(row => row.revision), [0, 1]);
  for (const [index, row] of personalRows.entries()) {
    assert.equal(row.organization_id, null); assert.equal(row.project_access_id, null);
    assert.equal(row.content_json, index === 0 ? f.raw : raw); assert.equal(row.content_sha256, hash(row.content_json));
  }
  const sharing = await shareWithIndependentReviewer(f);
  assert.deepEqual(f.rows(), personalRows, "sharing retains original private revision rows without broadening their scope");
  assert.deepEqual(f.objects(), savedObjects, "sharing neither rewrites nor loses original/current media bytes or metadata");
  assert.deepEqual(f.sqlite.prepare("SELECT * FROM event_private_payloads WHERE private_event_id=?").get(f.completion.eventId), f.originalCompletion);
  f.setHeaders(sharing.reviewerHeaders);
  const page = await f.eventPage(); assert.equal(page.content[CONTENT], raw);
  const projection = foldEvents(page.events, Infinity, DOCUMENT, PROJECT), artifact = projection.artifacts.find(value => value.id === ARTIFACT);
  assert.ok(artifact); assert.equal(model.documentArtifactRevision(page.events, ARTIFACT), 1);
  const sharedEdit = page.events.find(event => event.eventId === ack.appended[0].eventId); assert.ok(sharedEdit);
  const sharedCompletion = page.events.find(event => event.eventId === f.completion.eventId); assert.ok(sharedCompletion);
  const currentMarker = { schemaVersion: 1, revision: 1, contentSha256: hash(raw), media: record.media };
  assert.deepEqual(sharedEdit.payload.model3d_current_projection, currentMarker);
  assert.equal(Object.hasOwn(sharedEdit.payload.model3d_revision.source, "url"), false);
  assert.equal(Object.hasOwn(sharedCompletion.payload, "media_url"), false);
  assert.equal(sharedCompletion.payload.settings.model3d_files.some(value => Object.hasOwn(value, "url")), false);
  assert.equal(JSON.stringify(sharedEdit.payload.model3d_current_projection).includes(f.originalMedia.url), false);
  const scopes = f.sqlite.prepare("SELECT resource_kind,resource_id FROM project_resource_scopes WHERE project_access_id=? AND organization_id=? AND owner_user_id=?")
    .all(sharing.projectAccessId, sharing.organizationId, OWNER);
  assert.equal(scopes.some(row => row.resource_kind === "media" && row.resource_id === decodeURIComponent(f.originalMedia.url.slice("/api/media/".length))), false);
  assert.equal((await f.request(f.originalMedia.url)).status, 403, "sharing the derivative does not grant its reviewer the historical original media");
  const metadataResponse = await f.request("/api/events?after=0&limit=2000&content=0"); assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json(); assert.equal(Object.hasOwn(metadata, "content"), false);
  assert.deepEqual(metadata.events.find(event => event.eventId === sharedEdit.eventId).payload.model3d_current_projection, currentMarker);
  assert.equal(foldEvents(metadata.events, Infinity, DOCUMENT, PROJECT).artifacts.find(value => value.id === ARTIFACT).mediaUrl, record.media.url);
  // These are corrupt copies of the real authorized event page, never forged
  // database rows or approvals. Presentation validation cannot grant file access.
  const corruptions = [
    ["missing marker", event => { delete event.payload.model3d_current_projection; }],
    ["null marker", event => { event.payload.model3d_current_projection = null; }],
    ["extra field", event => { event.payload.model3d_current_projection.extra = true; }],
    ["wrong revision", event => { event.payload.model3d_current_projection.revision = 2; }],
    ["wrong current hash", event => { event.payload.model3d_current_projection.contentSha256 = hash(f.raw); }],
    ["invalid current URL", event => { event.payload.model3d_current_projection.media.url = "https://example.test/foreign.glb"; }],
    ["invalid current size", event => { event.payload.model3d_current_projection.media.byteLength = 0; }],
    ["wrong media kind", event => { event.payload.model3d_current_projection.media.mediaType = "video/mp4"; }],
    ["non-shared stream", event => { event.streamId = `creative:${OWNER}`; }],
    ["wrong document", event => { event.payload.document_id = "another-document"; }],
    ["wrong project", event => { event.payload.project_id = "another-project"; }],
    ["wrong content", event => { event.payload.content_ref = "another-content"; }],
  ];
  for (const [name, corrupt] of corruptions) {
    const events = structuredClone(page.events), event = events.find(value => value.eventId === sharedEdit.eventId); corrupt(event);
    const invalid = foldEvents(events, Infinity, DOCUMENT, PROJECT).artifacts.find(value => value.id === ARTIFACT);
    assert.equal(invalid.mediaUrl, null, name); assert.deepEqual(invalid.settings.model3d_files, [], name);
  }
  assert.equal(artifact.mediaUrl, record.media.url); assert.deepEqual(artifact.items, []);
  const file = model.model3dArtifactMediaFile(artifact); assert.ok(file);
  assert.equal(file.url, record.media.url); assert.equal(file.sha256, record.media.sha256); assert.equal(file.fileSize, record.media.byteLength);
  const historyResponse = await f.request(`/api/artifacts/${ARTIFACT}/revisions`); assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json(); assert.equal(history.currentRevision, 1); assert.equal(history.earlierHistoryUnavailable, true);
  assert.deepEqual(history.revisions.map(value => ({ revision: value.revision, sha256: value.sha256, available: value.available })), [{ revision: 1, sha256: hash(raw), available: true }]);
  const old = await f.request(`/api/artifacts/${ARTIFACT}/revisions/0`); assert.equal(old.status, 404); assert.equal((await old.json()).error, "artifact_revision_unavailable");
  const current = await f.request(`/api/artifacts/${ARTIFACT}/revisions/1`); assert.equal(current.status, 200); assert.equal((await current.json()).sha256, hash(raw));
  const exact = { artifact_revision: 1, content_sha256: hash(raw), source_block_versions: f.sourceVersions };
  const exportFields = { ...exact, artifact_kind: "model3d", format: MIME, destination_kind: "mesh", media_url: file.url,
    media_sha256: file.sha256, source_surface: "document-model3d-viewer" };
  await f.append("DocumentArtifactExported", exportFields, 409, "artifact_approval_required");
  f.setHeaders(sharing.ownerHeaders);
  await f.append("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: OWNER }, 403, "independent_assigned_reviewer_required");
  await sharing.setReviewAccess(false);
  await f.append("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: REVIEWER }, 403, "eligible_assigned_reviewer_required");
  await sharing.setReviewAccess(true);
  for (const altered of [{ artifact_revision: 0 }, { content_sha256: hash(f.raw) }])
    await f.append("ArtifactReviewRequested", { ...exact, ...altered, assigned_reviewer_user_id: REVIEWER }, 409, "stale_review_context");
  // A harmless extra caller field travels through the legitimate assignment
  // endpoint; it must never become a server-owned current-media witness.
  const assignment = await f.append("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: REVIEWER,
    model3d_current_projection: { ...currentMarker, revision: 77 } });
  assert.equal(assignment.appended.length, 1); assert.equal(assignment.appended[0].actor, `user:${OWNER}`);
  assert.deepEqual(assignment.appended[0].payload.model3d_current_projection, { ...currentMarker, revision: 77 },
    "the actual assignment receipt retains the authored unknown field; it does not certify it as current media");
  const assignedPage = await f.eventPage();
  assert.equal(Object.hasOwn(assignedPage.events.find(event => event.eventId === assignment.appended[0].eventId).payload, "model3d_current_projection"), false);
  await f.append("ArtifactApproved", exact, 403, "assigned_artifact_reviewer_required");
  f.setHeaders(sharing.reviewerHeaders);
  const retiredContext = await f.request("/api/events?after=0&limit=2000&content=0");
  assert.equal(retiredContext.status, 403); assert.equal((await retiredContext.json()).error, "project_access_revoked");
  // Regranting review access does not revive a session explicitly revoked by
  // the earlier negative control. The same reviewer selects a fresh real context.
  f.setHeaders(sharing.reviewerAuth);
  const freshContext = await f.request(sharing.base + "/context", { method: "POST" }); assert.equal(freshContext.status, 200);
  sharing.reviewerHeaders = { ...sharing.reviewerAuth, cookie: freshContext.headers.get("set-cookie").split(";")[0] };
  f.setHeaders(sharing.reviewerHeaders);
  for (const altered of [{ artifact_revision: 0 }, { content_sha256: hash(f.raw) }])
    await f.append("ArtifactApproved", { ...exact, ...altered }, 409, "stale_review_context");
  const approval = await f.append("ArtifactApproved", exact);
  assert.equal(approval.appended.length, 1); assert.equal(approval.appended[0].actor, `user:${REVIEWER}`);
  assert.equal(approval.appended[0].payload.artifact_revision, 1); assert.equal(approval.appended[0].payload.content_sha256, hash(raw));
  const approvedPage = await f.eventPage(), approvedProjection = foldEvents(approvedPage.events, Infinity, DOCUMENT, PROJECT);
  const approvedArtifact = approvedProjection.artifacts.find(value => value.id === ARTIFACT);
  assert.equal(artifactApprovalMatches(approvedArtifact, approvedPage.events, 1, hash(raw)), true);
  const reviewerSessionResponse = await f.request("/api/session"); assert.equal(reviewerSessionResponse.status, 200);
  const reviewerSession = await reviewerSessionResponse.json(), context = reviewerSession.projectContext;
  assert.equal(reviewerSession.user.userId, REVIEWER); assert.equal(context.projectAccessId, sharing.projectAccessId);
  assert.equal(context.ownerUserId, OWNER); assert.equal(context.organizationId, sharing.organizationId);
  assert.ok(context.permissions.includes("project.read")); assert.ok(context.permissions.includes("project.review.approve"));
  assert.equal(context.permissions.includes("project.author"), false);
  const access = { actorUserId: reviewerSession.user.userId, canRead: context.permissions.includes("project.read"),
    canAuthor: context.permissions.includes("project.author"), canReview: context.permissions.includes("project.review.approve"), shared: true };
  assert.equal(artifactDeliveryState(approvedArtifact, approvedProjection.blocks, approvedPage.events, access, hash(raw)).releaseAllowed, true);
  const exportAck = await f.append("DocumentArtifactExported", exportFields);
  assert.equal(exportAck.appended.length, 1); assert.equal(exportAck.appended[0].payload.export_class, "independently-approved");
  assert.equal(exportAck.appended[0].payload.media_sha256, record.media.sha256);
  const downloaded = await f.request(file.url); assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), MIME); assert.match(downloaded.headers.get("content-disposition"), /^attachment;/u);
  const bytes = new Uint8Array(await downloaded.arrayBuffer()); assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.fileSize);
  const beforeGeometry = geometry(f.originalBytes), afterGeometry = geometry(bytes);
  assert.deepEqual(afterGeometry.positions, beforeGeometry.positions.map(point => point.map(value => value * 2)));
  assert.deepEqual(afterGeometry.indices, beforeGeometry.indices); assert.deepEqual(afterGeometry.materials, beforeGeometry.materials);
  assert.deepEqual(afterGeometry.nodes, beforeGeometry.nodes); assert.deepEqual(afterGeometry.scenes, beforeGeometry.scenes);
  assert.notEqual(hash(raw), hash(bytes), "artifact JSON and delivered mesh are different exact byte identities");
  await preserve("original-cube.glb", f.originalBytes); await preserve("approved-scaled-cube.glb", bytes);
  await preserve("joined-result.json", encoded({ scope: "local synthetic document-grounded origin; actual personal Save then real shared independent review",
    saveAck: ack, assignment, approval, exportAck, file, glbSha256: hash(bytes), contentSha256: hash(raw), sourceSha256: hash(f.raw),
    history, originalGeometry: beforeGeometry, savedGeometry: afterGeometry, recipientDelivery: "unconfirmed", browserOrNativeApp: false }));
  f.setHeaders({ "oai-authenticated-user-id": "foreign-model-reader", "oai-authenticated-user-email": "foreign-model-reader@example.test" });
  assert.equal((await f.request("/api/session")).status, 200);
  const foreignFile = await f.request(file.url); assert.equal(foreignFile.status, 403, "a principal without project access cannot read the approved private media");
  f.setHeaders(sharing.ownerHeaders);
  const replacementText = "Changed source after exact approval.";
  await f.append("BlockPropertyEdited", { block_id: BLOCK, property_path: "text", new_value: replacementText });
  const changedPage = await f.eventPage();
  assert.equal(foldEvents(changedPage.events, Infinity, DOCUMENT, PROJECT).blocks.find(value => value.id === BLOCK).properties.text, replacementText);
  await f.append("ArtifactReviewRequested", { ...exact, assigned_reviewer_user_id: REVIEWER }, 409, "artifact_source_stale");
  f.setHeaders(sharing.reviewerHeaders);
  await f.append("ArtifactApproved", exact, 403, "assigned_artifact_reviewer_required");
  await f.append("DocumentArtifactExported", exportFields, 409, "artifact_approval_required");
  const stale = await f.eventPage(), staleProjection = foldEvents(stale.events, Infinity, DOCUMENT, PROJECT);
  assert.equal(artifactDeliveryState(staleProjection.artifacts.find(value => value.id === ARTIFACT), staleProjection.blocks, stale.events, access, hash(raw)).releaseAllowed, false);
  assert.deepEqual(f.rows(), personalRows); assert.deepEqual(f.objects(), savedObjects); assert.equal(f.rawNow(), raw);
  assert.deepEqual(f.accounting(), f.initialAccounting); await f.drain();
});

test("real shared review refuses a prompt-only generated fixture without verifiable source versions", { timeout: 30000 }, async t => {
  const f = await fixture(t, "prompt-only", { sourceVersions: [] }), sharing = await shareWithIndependentReviewer(f);
  f.setHeaders(sharing.ownerHeaders);
  await f.append("ArtifactReviewRequested", { artifact_revision: 0, content_sha256: hash(f.raw), source_block_versions: [], assigned_reviewer_user_id: REVIEWER },
    409, "artifact_source_revision_unavailable");
  assert.equal(f.rows().length, 0); assert.equal(f.rawNow(), f.raw); assert.deepEqual(f.accounting(), f.initialAccounting);
  await preserve("prompt-only-result.json", encoded({ status: "EXPECTED_REFUSAL", error: "artifact_source_revision_unavailable", sourceVersions: [],
    reviewEvents: (await f.eventPage()).events.filter(value => ["ArtifactReviewRequested", "ArtifactApproved"].includes(value.type)),
    distinction: "No provenance or independent approval is fabricated for the separate prompt-only browser artifact." }));
});


test("shared metadata marks the latest restoration, not an older edit with the same current file and raw digest", { timeout: 30000 }, async t => {
  const f = await fixture(t, "restoration");
  const save = async (expectedRevision, sourceBytes, factor) => {
    const sourceRaw = f.rawNow(), result = scaleModel3dGeometry(sourceBytes, factor);
    const response = await f.request(`/api/artifacts/${ARTIFACT}`, { ...json({ expectedRevision, expectedContentSha256: hash(sourceRaw),
      model3dScale: { sourceMediaSha256: hash(sourceBytes), factor, resultMediaSha256: hash(result.bytes) } }), method: "PATCH" });
    assert.equal(response.status, 200, await response.clone().text());
    const ack = await response.json(), raw = f.rawNow(), record = JSON.parse(raw).model3d_revision;
    assert.equal(ack.revision, expectedRevision + 1); assert.equal(ack.appended.length, 1); assert.equal(ack.content[CONTENT], raw);
    assert.deepEqual(ack.appended[0].payload.model3d_revision, record);
    const media = await f.request(record.media.url); assert.equal(media.status, 200);
    const bytes = new Uint8Array(await media.arrayBuffer()); assert.equal(hash(bytes), record.media.sha256);
    assert.deepEqual(bytes, result.bytes); return { ack, raw, record, bytes };
  };
  const first = await save(0, f.originalBytes, 2), second = await save(1, first.bytes, 2);
  assert.notEqual(first.record.media.url, second.record.media.url); assert.notEqual(first.record.media.sha256, second.record.media.sha256);
  const restoredResponse = await f.request(`/api/artifacts/${ARTIFACT}/revisions/1/restore`, json({ expectedRevision: 2 }));
  assert.equal(restoredResponse.status, 200, await restoredResponse.clone().text());
  const restored = await restoredResponse.json(); assert.equal(restored.revision, 3); assert.equal(restored.appended.length, 1);
  assert.equal(restored.appended[0].payload.revision_action, "restore"); assert.equal(restored.appended[0].payload.restored_from_revision, 1);
  assert.equal(restored.content[CONTENT], first.raw); assert.equal(f.rawNow(), first.raw);
  assert.deepEqual(restored.appended[0].payload.model3d_revision, first.record);
  assert.equal(restored.appended[0].payload.content_sha256, first.ack.appended[0].payload.content_sha256,
    "restoration makes the old edit's exact bytes/hash current again, but does not make that old event the latest revision");
  const rows = f.rows(), objects = f.objects(); assert.deepEqual(rows.map(row => row.revision), [0, 1, 2, 3]);
  const shared = await shareWithIndependentReviewer(f); f.setHeaders(shared.reviewerHeaders);
  assert.deepEqual(f.rows(), rows); assert.deepEqual(f.objects(), objects);
  for (const row of f.rows()) { assert.equal(row.organization_id, null); assert.equal(row.project_access_id, null); }
  const fullResponse = await f.request("/api/events?after=0&limit=2000&content=0"); assert.equal(fullResponse.status, 200);
  const metadata = await fullResponse.json(); assert.equal(Object.hasOwn(metadata, "content"), false); assert.equal(metadata.hasMore, false);
  const oldEdit = metadata.events.find(event => event.eventId === first.ack.appended[0].eventId);
  const latest = metadata.events.find(event => event.eventId === restored.appended[0].eventId); assert.ok(oldEdit); assert.ok(latest);
  assert.equal(Object.hasOwn(oldEdit.payload, "model3d_current_projection"), false);
  assert.deepEqual(latest.payload.model3d_current_projection, { schemaVersion: 1, revision: 3, contentSha256: hash(first.raw), media: first.record.media });
  assert.equal(metadata.events.filter(event => Object.hasOwn(event.payload, "model3d_current_projection")).length, 1);
  const earlyResponse = await f.request(`/api/events?after=0&limit=${oldEdit.sequence}&content=0`); assert.equal(earlyResponse.status, 200);
  const early = await earlyResponse.json(); assert.equal(early.hasMore, true); assert.equal(Object.hasOwn(early, "content"), false);
  assert.ok(early.events.some(event => event.eventId === oldEdit.eventId)); assert.equal(early.events.some(event => event.eventId === latest.eventId), false);
  assert.equal(early.events.some(event => Object.hasOwn(event.payload, "model3d_current_projection")), false);
  const page = await f.eventPage(); assert.equal(page.content[CONTENT], first.raw);
  assert.equal(Object.hasOwn(page.events.find(event => event.eventId === oldEdit.eventId).payload, "model3d_current_projection"), false);
  const artifact = foldEvents(metadata.events, Infinity, DOCUMENT, PROJECT).artifacts.find(value => value.id === ARTIFACT);
  assert.equal(model.documentArtifactRevision(metadata.events, ARTIFACT), 3); assert.equal(artifact.mediaUrl, first.record.media.url);
  for (const retired of [f.originalMedia.url, second.record.media.url]) assert.equal((await f.request(retired)).status, 403);
  const current = await f.request(first.record.media.url); assert.equal(current.status, 200);
  assert.deepEqual(new Uint8Array(await current.arrayBuffer()), first.bytes);
  assert.deepEqual(f.rows(), rows); assert.deepEqual(f.objects(), objects); assert.deepEqual(f.accounting(), f.initialAccounting);
  await preserve("restoration-result.json", encoded({ scope: "actual personal Save1/Save2/restore1 then actual sharing; no review credit in this case",
    firstAck: first.ack, secondAck: second.ack, restoreAck: restored, earlyMetadata: early, currentMetadata: metadata,
    currentRevision: 3, currentSha256: first.record.media.sha256, oldSameHashEventNotCurrent: true, historicalMediaRefused: true }));
});
