import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
import { readStoredZip } from "./output-asset-fixtures.mjs";
import { ownedSocialVideo } from "./output-social-asset-fixtures.mjs";

// NEW local composition integration, reusing only the finite RAM handler setup
// from film-script-recipe-review-file. That suite and its Scene host are not imported.
const hooks = registerOutputSourceImports();
const [{ ensureSchema, makeEvent, appendEvents, readWorkspaceEvents },
  { handleOutputRequirements }, { handleWorkspaces }, { handleSession }, { handleEvents },
  { buildOutcomeRecipeDraft }, { confirmOutputRequirementInterpretation },
  { authoritativeCreativeContext }, { composeFilmClips }, { inspectVideoPrefix }] = await Promise.all([
  import("../worker/runtime.ts"), import("../worker/output-requirements-api.ts"),
  import("../worker/workspaces-api.ts"), import("../worker/pilot-policy.ts"), import("../worker/events-api.ts"),
  import("../src/model/outcome-recipes.ts"), import("../src/model/output-requirements.ts"),
  import("../worker/context-authority.ts"), import("../src/model/film-composition.ts"),
  import("../src/model/video-container.ts"),
]).finally(() => hooks.deregister());
const digest = value => createHash("sha256").update(value).digest("hex");
const facts = [
  { block_id: "local-composition-subject", type: "direction", properties: { text: "An authored abstract repeated-color software specimen: fifteen ordered two-second local AVC clips, with no audio, make one thirty-second film." } },
  { block_id: "local-composition-order", type: "direction", properties: { text: "Keep the declared slots local-clip-01 through local-clip-15 in order. Every slot deliberately reuses the same owned two-second color fixture; no scene diversity is claimed." } },
  { block_id: "local-composition-limit", type: "exclusion", properties: { text: "This is a synthetic software composition. It does not depict the Harbor story, satisfy the retained original film obligation, establish useful narrative content, or prove browser decoding." } },
];
const OWNER = "dev-local-creative", DOC = "film-composition-recipe-document", PROJECT = "film-composition-recipe-project";
const API = "/api/output-requirements", STREAM = `creative:${OWNER}`;
const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const text = value => new TextDecoder().decode(value);
// Same actual Workspace/session membership sequence as artifact-review-host76–113.
// Copy this finite API setup instead of importing its unrelated renderer/Scene host.
async function shareWithIndependentReviewer(worker) {
  const reviewer = "film-composition-independent-reviewer";
  const organization = await worker.request("/api/workspaces", json({ name: "Film composition exact review fixture" }));
  assert.equal(organization.status, 201, await organization.clone().text());
  const organizationId = (await organization.json()).organizationId;
  const project = await worker.request(`/api/workspaces/${organizationId}/projects`, json({ projectId: PROJECT }));
  assert.equal(project.status, 201, await project.clone().text());
  const projectAccessId = (await project.json()).projectAccessId;
  const base = `/api/workspaces/${organizationId}/projects/${projectAccessId}`;
  const context = await worker.request(base + "/context", { method: "POST" });
  assert.equal(context.status, 200, await context.clone().text());
  const ownerHeaders = { cookie: context.headers.get("set-cookie").split(";")[0] };
  const reviewerAuth = { "oai-authenticated-user-id": reviewer, "oai-authenticated-user-email": reviewer + "@example.test" };
  worker.setHeaders(reviewerAuth);
  assert.equal((await worker.request("/api/session")).status, 200);
  assert.equal((await worker.request("/api/session", json({ action: "accept_terms", ownershipConfirmed: true, providerProcessingConfirmed: true }))).status, 200);
  worker.setHeaders(ownerHeaders);
  const invite = await worker.request(`/api/workspaces/${organizationId}/members`, json({ email: reviewer + "@example.test", role: "member" }));
  assert.equal(invite.status, 201, await invite.clone().text());
  const invitation = await invite.json();
  worker.setHeaders(reviewerAuth);
  const accepted = await worker.request(`/api/workspaces/${organizationId}/invitations/${invitation.invitationId}/accept`,
    json({ token: new URL(invitation.invitationUrl).searchParams.get("token") }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  worker.setHeaders(ownerHeaders);
  const member = await worker.request(base + "/members", json({ userId: reviewer, role: "viewer" }));
  assert.equal(member.status, 201, await member.clone().text());
  const listed = await worker.request(base + "/members"); assert.equal(listed.status, 200);
  const row = (await listed.json()).members.find(item => item.user_id === reviewer); assert.ok(row);
  const granted = await worker.request(base + "/members/" + row.membership_id, { ...json({ reviewAccess: true }), method: "PATCH" });
  assert.equal(granted.status, 200, await granted.clone().text());
  worker.setHeaders(reviewerAuth);
  const reviewerContext = await worker.request(base + "/context", { method: "POST" });
  assert.equal(reviewerContext.status, 200, await reviewerContext.clone().text());
  const reviewerHeaders = { ...reviewerAuth, cookie: reviewerContext.headers.get("set-cookie").split(";")[0] };
  worker.setHeaders(ownerHeaders);
  return { ownerHeaders, reviewerHeaders, organizationId, projectAccessId, reviewer };
}

async function fixture(t, caseName) {
  const state = outputTestDatabase(), background = [], pendingFailures = [], requests = [];
  let scopedHeaders = {}, serial = 0, disposed = false;
  const ports = { assetFetchAttempts: 0, mediaAttempts: 0, mediaOverflow: false, media: [] };
  state.env.ASSETS = { fetch() { ports.assetFetchAttempts++; throw new Error("film_composition_assets_network_forbidden"); } };
  for (const method of ["put", "get", "head", "delete", "list"]) {
    const original = state.env.MEDIA[method].bind(state.env.MEDIA);
    state.env.MEDIA[method] = async (...args) => {
      if (++ports.mediaAttempts > 300) ports.mediaOverflow = true;
      assert.equal(ports.mediaOverflow, false, "Finite MEDIA observation bound");
      ports.media.push({ method, key: typeof args[0] === "string" ? args[0] : null });
      return original(...args);
    };
  }
  const execution = { waitUntil(promise) { background.push(Promise.resolve(promise).catch(error => { pendingFailures.push(error); })); } };
  const drain = async () => { while (background.length) await Promise.all(background.splice(0)); assert.deepEqual(pendingFailures, []); };
  t.after(async () => {
    try { await drain(); assert.equal(ports.assetFetchAttempts, 0); assert.equal(ports.mediaOverflow, false); } finally {
      state.sqlite.close(); disposed = true; state.media.clear();
      await preserve(`${caseName}-closure.json`, new TextEncoder().encode(JSON.stringify({ databaseClosed: disposed, backgroundPending: background.length, backgroundFailures: pendingFailures.length, mediaObjectsAfterDisposal: state.media.size, assetFetchAttempts: ports.assetFetchAttempts }) + "\n"));
    }
  });
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(OWNER, "creative@local.forma", "Local abstract composition author", now, now, now);
  const authored = (type, payload) => makeEvent(STREAM, 0, `user:${OWNER}`, "film-composition-recipe-test", "authored-source", type, { project_id: PROJECT, document_id: DOC, ...payload });
  await appendEvents(state.env, [
    authored("ProjectCreated", { project_id: PROJECT, name: "Film composition recipe" }),
    authored("DocumentCreated", { title: "Declared synthetic repeated-color composition brief", handle: "film-composition-recipe" }),
    ...facts.map((fact, index) => authored("BlockCreated", { ...fact, scope: "document", position: `a${index}`, handle: `${fact.type}/${fact.block_id}` })),
  ]);
  const worker = {
    setHeaders(headers) { scopedHeaders = { ...headers }; },
    async request(route, init = {}) {
      const request = new Request("http://localhost" + route, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...scopedHeaders } });
      requests.push({ path: route, method: request.method, actor: scopedHeaders["oai-authenticated-user-id"] ?? OWNER });
      // Exact selected production-handler branches used by worker/index.ts. No
      // generated-job bridge or arbitrary route may enter this finite local test.
      assert.ok(requests.length <= 180, "Finite direct-handler request bound");
      const observed = requests.at(-1); let response;
      if (route.split("?")[0] === "/api/session") response = await handleSession(request, state.env, execution);
      else if (route.startsWith("/api/workspaces")) response = await handleWorkspaces(request, state.env, new URL(request.url).pathname.slice("/api/workspaces".length).split("/").filter(Boolean).map(decodeURIComponent));
      else if (route.startsWith("/api/events?")) { assert.equal(request.method, "GET"); response = await handleEvents(request, state.env); }
      else { assert.ok(route.startsWith(API)); response = await handleOutputRequirements(request, state.env, new URL(request.url).pathname, execution); }
      observed.status = response.status; return response;
    },
  };
  const sharing = await shareWithIndependentReviewer(worker); await drain();
  // Ordinary shared refresh establishes the current project source projection;
  // Output reads correctly refuse to repair stale projection themselves.
  const refreshed = await worker.request("/api/events?after=0&limit=2000&content=0");
  assert.equal(refreshed.status, 200, await refreshed.clone().text());
  async function snapshot() {
    const response = await worker.request(`${API}?documentId=${DOC}`);
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  }
  async function command(body, status = 200, expectedError) {
    const current = await snapshot();
    const response = await worker.request(API, json({ documentId: DOC, clientMutationId: `film-composition-${++serial}`, expectedRevision: current.revision, ...body }));
    assert.equal(response.status, status, await response.clone().text());
    const result = await response.json(); if (expectedError) assert.equal(result.error, expectedError); return result;
  }
  async function upload(bytes, name, mimeType = "video/mp4") {
    const current = await snapshot();
    const response = await worker.request(`${API}/assets?documentId=${DOC}`, { method: "POST", headers: {
      "content-type": mimeType, "x-output-filename": encodeURIComponent(name), "x-output-rights-confirmed": "true",
      "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `film-composition-upload-${++serial}`,
    }, body: bytes });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  }
  const count = table => state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const eventCount = type => state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type=?").get(type).count;
  return { ...state, worker, sharing, snapshot, command, upload, authored, count, eventCount, drain, requests, ports, disposed: () => disposed };
}

// A finite independent reader for this serializer's always-quoted CSV fields.
function readCsv(value) {
  const rows = [], row = []; let field = "", quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (quoted && value[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(field.replace(/\r$/u, "")); field = "";
      if (char === "\n") { rows.push([...row]); row.length = 0; }
    } else field += char;
  }
  assert.equal(quoted, false); assert.equal(field, ""); assert.equal(row.length, 0);
  const [headers, ...data] = rows;
  return data.map(cells => { assert.equal(cells.length, headers.length); return Object.fromEntries(headers.map((key, i) => [key, cells[i]])); });
}

async function preserve(name, bytes) {
  const directory = process.env.FILM_COMPOSITION_ACTUAL_DIR;
  if (!directory) return;
  assert.ok(isAbsolute(directory)); assert.match(name, /^[a-z0-9][a-z0-9.-]*$/u);
  const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
}
const encode = value => new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
const originalFetch = globalThis.fetch; let forbiddenFetches = 0;
test.before(() => { globalThis.fetch = async () => { forbiddenFetches++; throw new Error("film_composition_provider_network_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(forbiddenFetches, 0); });

function authority(state) {
  return {
    acceptances: state.sqlite.prepare("SELECT * FROM output_target_acceptances ORDER BY acceptance_id").all(),
    fulfillments: state.sqlite.prepare("SELECT * FROM output_plan_fulfillments ORDER BY target_id").all(),
    deliveries: state.sqlite.prepare("SELECT * FROM output_delivery_manifests ORDER BY manifest_id").all(),
    acceptedEvents: state.eventCount("OutputTargetAccepted"), selectedEvents: state.eventCount("OutputFulfillmentSelected"),
    changedEvents: state.eventCount("OutputTargetChangesRequested"), deliveryEvents: state.eventCount("OutputDeliveryPrepared"),
  };
}
function accounting(state) {
  return { tokens: state.sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id,period").all(),
    money: state.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all() };
}

async function authorFilmPlan(state) {
  const before = await state.snapshot();
  assert.equal(before.capabilities.nativeGeneration, false, "No installed generation bridge");
  const source = authoritativeCreativeContext(await readWorkspaceEvents(state.env, STREAM), { documentId: DOC, projectId: PROJECT });
  assert.deepEqual(source.snapshot.facts.map(row => ({ block_id: row.block_id, type: row.type, text: row.properties.text })),
    facts.map(row => ({ block_id: row.block_id, type: row.type, text: row.properties.text })));
  const draft = buildOutcomeRecipeDraft({
    scope: { projectId: PROJECT, documentId: DOC, authorizationScopeKey: `project:${before.scope.organizationId}:${before.scope.projectAccessId}` },
    expectedRevision: before.revision, sourceRevision: before.sourceRevision, requirementRevision: before.requirementRevision,
    requirementId: "local-composed-film-requirement", recipeId: "film-continuity", selectedChoices: ["composed-film"],
    originalText: "One thirty-second composed MP4 from the fifteen ordered owned local two-second repeated-color fixtures. This authored abstract test source does not fulfill the retained Harbor film obligation.",
    labels: { requirement: "Authored local repeated-color composition", choices: { "composed-film": "Thirty-second synthetic local film" },
      sourceUnknown: "Confirm the three saved local composition blocks", coverageUnknown: "Confirm abstract repeated-color coverage",
      scriptOwed: "No separate script requested in this software case", composedFilmOwed: "Compose and adopt the actual ordered local media before independent synthetic review" },
  });
  assert.equal(draft.spec.deliverables.length, 1);
  assert.equal(draft.spec.deliverables[0].media_kind, "video");
  assert.equal(draft.spec.deliverables[0].quantity.kind, "unknown");
  assert.equal(draft.spec.deliverables[0].coverage.kind, "unresolved");
  assert.deepEqual(await state.snapshot(), before, "Pure composition recipe grants no saved authority");
  const unresolved = confirmOutputRequirementInterpretation(structuredClone(draft.spec));
  await state.command({ action: "save", blockId: unresolved.id, spec: unresolved });
  const unknown = (await state.command({ action: "confirm" })).snapshot;
  assert.equal(unknown.summary.completion, "unresolved");
  assert.equal(unknown.summary.delivery_ready, false);
  assert.equal(unknown.confirmedPlan.plan.targets.length, 0);
  const stable = authority(state);
  await state.command({ action: "export", planRevisionId: unknown.confirmedPlan.revisionId }, 409, "output_assignment_incomplete");
  assert.deepEqual(authority(state), stable);
  let spec = structuredClone(draft.spec);
  const row = spec.deliverables[0];
  const confirmed = { kind: "confirmed", text: "Explicit synthetic author decision for exactly fifteen two-second owned repeated-color slots over the three saved blocks." };
  row.quantity = { kind: "exact", unit: "video", value: 1 };
  row.content_quantity = { kind: "exact", unit: "second", value: 30 };
  row.source_scope = { kind: "blocks", block_ids: facts.map(f => f.block_id) };
  row.coverage = { kind: "document_context" };
  for (const key of ["quantity", "content_quantity", "source_scope", "coverage"]) row.value_origins[key] = confirmed;
  await state.command({ action: "save", blockId: spec.id, spec });
  await state.command({ action: "confirm" }, 409, "output_interpretation_review_required");
  spec = confirmOutputRequirementInterpretation(spec);
  const saved = await state.command({ action: "save", blockId: spec.id, spec });
  assert.deepEqual(saved.snapshot.requirements[0].spec, spec);
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  assert.equal(plan.sourceDigest, saved.snapshot.sourceRevision);
  assert.equal(plan.plan.obligations.length, 1); assert.equal(plan.plan.targets.length, 1);
  assert.deepEqual(plan.plan.unresolved_groups, []);
  const target = plan.plan.targets[0];
  assert.equal(target.media_kind, "video"); assert.equal(target.required, true);
  assert.deepEqual(target.blocking_issues, []);
  assert.deepEqual(target.count_policy, { kind: "exact", unit: "second", value: 30 });
  assert.deepEqual(target.source_scope, { kind: "blocks", block_ids: facts.map(f => f.block_id) });
  return { plan, target };
}

function retainedFilm(state, assetId, film) {
  const row = state.sqlite.prepare("SELECT * FROM output_assets WHERE asset_id=?").get(assetId);
  assert.ok(row); assert.equal(row.owner_user_id, OWNER); assert.equal(row.document_id, DOC);
  assert.equal(row.media_kind, "video"); assert.equal(row.mime_type, "video/mp4");
  assert.equal(row.content_sha256, film.sha256); assert.equal(row.byte_length, film.bytes.length);
  assert.equal(row.storage_key, `output-requirements/${OWNER}/${PROJECT}/${DOC}/${assetId}/${film.sha256}.mp4`);
  const object = state.media.get(row.storage_key); assert.ok(object);
  assert.deepEqual(object.bytes, film.bytes); assert.equal(object.contentType, "video/mp4");
  assert.equal(object.metadata.ownerId, OWNER); assert.equal(object.metadata.projectId, PROJECT);
  assert.equal(object.metadata.documentId, DOC); assert.equal(object.metadata.assetId, assetId);
  assert.equal(object.metadata.scopeKey, row.scope_key); assert.equal(object.metadata.sha256, film.sha256);
  const write = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE asset_id=?").get(assetId);
  assert.equal(write.status, "written"); assert.equal(write.write_acknowledged, 1);
  assert.equal(write.storage_key, row.storage_key); assert.equal(write.content_sha256, film.sha256);
  assert.equal(write.publication_event_id, row.created_event_id);
  return { row, object, write };
}

async function unpackFilm(response, film, targetId, assetId, acceptanceId) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-output-delivery-completion"), "complete");
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.headers.get("x-output-sha256"), digest(bytes));
  const entries = readStoredZip(bytes);
  assert.equal(entries.size, 3);
  const manifest = JSON.parse(text(entries.get("manifest.json"))), csv = readCsv(text(entries.get("manifest.csv")));
  assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.scopeHistoryComplete, true);
  assert.equal(manifest.summary.owedTargets, 1); assert.deepEqual(manifest.missingWork, []);
  for (const key of ["groups", "obligations", "targets"]) assert.equal(manifest.scope[key].length, 1);
  assert.deepEqual(manifest.scope.unresolvedGroups, []);
  assert.equal(manifest.files.length, 1);
  const file = manifest.files[0];
  assert.equal(file.id, assetId); assert.equal(file.sha256, film.sha256); assert.equal(file.byteLength, film.bytes.length);
  assert.match(file.path, /\.mp4$/u); assert.deepEqual(entries.get(file.path), film.bytes);
  assert.deepEqual(manifest.targets, [{ targetId, fileId: assetId, acceptanceId }]);
  assert.equal(csv.filter(row => row.record_type === "file").length, 1);
  assert.ok(csv.some(row => row.record_type === "file" && row.file_id === assetId && row.sha256 === film.sha256));
  assert.equal(csv.filter(row => row.record_type === "missing_work").length, 0);
  const reopened = await inspectVideoPrefix(entries.get(file.path));
  assert.ok(reopened); assert.equal(reopened.sourceSha256, film.sha256);
  assert.equal(reopened.durationSeconds, 30); assert.equal(reopened.sampleCount, 60);
  return { bytes, entries, manifest, csv };
}

test("ordered local Film composition has exact owned upload, distinct review and usable thirty-second MP4 delivery; authority refusals remain", async t => {
  const state = await fixture(t, "local-film-composition"), initialAccounting = accounting(state);
  const { plan, target } = await authorFilmPlan(state);
  const source = ownedSocialVideo("16:9"), info = await inspectVideoPrefix(source);
  assert.ok(info); assert.equal(info.durationSeconds, 2); assert.equal(info.sampleCount, 4);
  assert.equal(info.timescale, 16384); assert.equal(info.durationTicks, 32768);
  assert.deepEqual(info.sampleDurationTicks, [8192, 8192, 8192, 8192]);
  assert.equal(info.width, 32); assert.equal(info.height, 18);
  const clips = Array.from({ length: 15 }, (_, index) => ({ id: `local-clip-${String(index + 1).padStart(2, "0")}`, bytes: source.slice(), sha256: digest(source) }));
  const prior = authority(state), beforeComposition = await state.snapshot();
  const film = await composeFilmClips(clips, { timescale: 16384, durationTicks: 491520 });
  assert.ok(film); assert.equal(film.sha256, digest(film.bytes));
  assert.equal(film.info.durationSeconds, 30); assert.equal(film.info.sampleCount, 60);
  assert.equal(film.info.sourceSha256, film.sha256);
  assert.equal(film.sources.length, clips.length);
  for (const [index, witness] of film.sources.entries()) {
    assert.deepEqual(witness, { id: clips[index].id, sha256: clips[index].sha256, byteLength: source.length,
      startSample: index * 4, endSample: (index + 1) * 4, startTick: index * info.durationTicks, endTick: (index + 1) * info.durationTicks });
  }
  assert.deepEqual(await state.snapshot(), beforeComposition); assert.deepEqual(authority(state), prior);
  assert.equal(state.media.size, 0, "Pure composition did not upload or adopt itself");
  const refusals = [];
  async function refused(body, status, error, headers = state.sharing.ownerHeaders) {
    const stable = authority(state); state.worker.setHeaders(headers);
    try { await state.command(body, status, error); } finally { state.worker.setHeaders(state.sharing.ownerHeaders); }
    assert.deepEqual(authority(state), stable); refusals.push({ action: body.action, status, error });
  }
  const revision = (await state.snapshot()).revision;
  const noRights = await state.worker.request(`${API}/assets?documentId=${DOC}`, { method: "POST", headers: {
    "content-type": "video/mp4", "x-output-filename": "authored-local-film.mp4", "x-output-rights-confirmed": "false",
    "x-output-expected-revision": revision, "x-output-client-mutation-id": "film-no-rights",
  }, body: film.bytes });
  assert.equal(noRights.status, 403); assert.equal((await noRights.json()).error, "owned_file_rights_attestation_required");
  assert.equal(state.ports.media.filter(row => row.method === "put").length, 0);
  assert.deepEqual(authority(state), prior);
  const uploaded = await state.upload(film.bytes, "authored-local-film.mp4"), assetId = uploaded.command.assetId;
  const asset = uploaded.snapshot.assets.find(row => row.id === assetId); assert.ok(asset);
  assert.equal(asset.mediaKind, "video"); assert.equal(asset.mimeType, "video/mp4");
  assert.equal(asset.sha256, film.sha256); assert.equal(asset.inspection.kind, "video");
  assert.equal(asset.inspection.facts.durationSeconds, 30);
  assert.equal(asset.inspection.facts.width, 32); assert.equal(asset.inspection.facts.height, 18);
  const retained = retainedFilm(state, assetId, film);
  const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId });
  const result = bound.snapshot.results.find(row => row.id === bound.command.resultId); assert.ok(result);
  assert.equal(result.checksStatus, "passed"); assert.equal(result.review, "pending");
  assert.equal(result.sha256, film.sha256); assert.equal(result.resultRevision, film.sha256);
  assert.equal(result.sourceDigest, plan.sourceDigest); assert.equal(result.targetContractDigest, plan.targetContractDigests[target.id]);
  const approve = { action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true };
  await refused(approve, 403, "independent_output_reviewer_required");
  await refused({ ...approve, reviewedRights: false }, 403, "output_content_and_rights_review_required", state.sharing.reviewerHeaders);
  await refused({ ...approve, reviewedCoverage: false }, 403, "output_content_and_rights_review_required", state.sharing.reviewerHeaders);
  await refused({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
  state.worker.setHeaders(state.sharing.reviewerHeaders);
  assert.equal((await state.snapshot()).results.find(row => row.id === result.id).reviewAllowed, true);
  const approved = await state.command({ ...approve, note: "Distinct eligible synthetic reviewer accepts the exact thirty-second repeated-color source contract and owned bytes. This API control is not human narrative review or playback." });
  state.worker.setHeaders(state.sharing.ownerHeaders);
  const acceptance = state.sqlite.prepare("SELECT * FROM output_target_acceptances WHERE acceptance_id=?").get(approved.command.acceptanceId);
  assert.ok(acceptance); assert.equal(acceptance.reviewer_user_id, state.sharing.reviewer); assert.notEqual(acceptance.reviewer_user_id, OWNER);
  assert.equal(acceptance.result_revision, film.sha256); assert.equal(acceptance.content_sha256, film.sha256);
  assert.equal(acceptance.target_id, target.id); assert.equal(acceptance.result_id, result.id);
  assert.equal(acceptance.source_digest, plan.sourceDigest); assert.equal(acceptance.target_contract_digest, plan.targetContractDigests[target.id]);
  const ready = await state.snapshot(); assert.equal(ready.summary.completion, "complete"); assert.equal(ready.summary.delivery_ready, true);
  assert.equal(ready.summary.required_obligations, 1); assert.equal(ready.summary.fulfilled_required_obligations, 1);
  const delivery = await state.command({ action: "export", planRevisionId: plan.revisionId });
  assert.equal(delivery.command.partCount, 1);
  const pack = await unpackFilm(await state.worker.request(delivery.command.downloadUrl), film, target.id, assetId, acceptance.acceptance_id);
  await preserve("authored-local-film.mp4", film.bytes);
  await preserve("authored-local-film.zip", pack.bytes);
  await preserve("authored-local-film-manifest.json", pack.entries.get("manifest.json"));
  await preserve("authored-local-film-manifest.csv", pack.entries.get("manifest.csv"));
  const faults = [];
  for (const fault of ["foreign_owner", "changed_private_bytes"]) {
    const stable = authority(state), original = structuredClone(state.media.get(retained.row.storage_key));
    const currentRevision = (await state.snapshot()).revision;
    try {
      const changed = structuredClone(original);
      if (fault === "foreign_owner") changed.metadata.ownerId = "foreign-film-owner";
      else { changed.bytes = changed.bytes.slice(); changed.bytes[changed.bytes.length - 3] ^= 1; }
      state.media.set(retained.row.storage_key, changed);
      const response = await state.worker.request(API, json({ documentId: DOC, clientMutationId: `composition-fault-${fault}`, expectedRevision: currentRevision,
        action: "bind", planRevisionId: plan.revisionId, targetId: target.id, acceptanceId: acceptance.acceptance_id }));
      assert.equal(response.status, 409, await response.clone().text());
      const error = (await response.json()).error;
      assert.equal(error, fault === "foreign_owner" ? "output_asset_custody_mismatch" : "output_asset_bytes_changed");
      const denied = await state.worker.request(delivery.command.downloadUrl);
      assert.equal(denied.status, 409, await denied.clone().text());
      const downloadError = (await denied.json()).error;
      assert.equal(downloadError, fault === "foreign_owner" ? "output_accepted_file_changed" : "output_asset_bytes_changed");
      assert.deepEqual(authority(state), stable); faults.push({ fault, status: 409, error, downloadError });
    } finally { state.media.set(retained.row.storage_key, original); }
    retainedFilm(state, assetId, film);
    const restored = await unpackFilm(await state.worker.request(delivery.command.downloadUrl), film, target.id, assetId, acceptance.acceptance_id);
    assert.deepEqual(restored.bytes, pack.bytes);
  }
  const stable = authority(state);
  await appendEvents(state.env, [state.authored("BlockPropertyEdited", { block_id: facts[0].block_id, property_path: "text", new_value: facts[0].properties.text + " Revised requirement: sixteen two-second slots instead." })]);
  const refresh = await state.worker.request("/api/events?after=0&limit=2000&content=0");
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const stale = await state.snapshot(); assert.notEqual(stale.sourceRevision, plan.sourceDigest); assert.equal(stale.summary.delivery_ready, false);
  await refused(approve, 409, "output_plan_needs_reconfirmation", state.sharing.reviewerHeaders);
  await refused({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, acceptanceId: acceptance.acceptance_id }, 409, "output_plan_needs_reconfirmation");
  await refused({ action: "export", planRevisionId: plan.revisionId }, 409, "output_plan_needs_reconfirmation");
  const staleDownload = await state.worker.request(delivery.command.downloadUrl);
  assert.equal(staleDownload.status, 409); assert.equal((await staleDownload.json()).error, "output_plan_needs_reconfirmation");
  assert.deepEqual(authority(state), stable);
  for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "output_provider_calls", "budget_reservations", "cost_budget_reservations"]) assert.equal(state.count(table), 0, table);
  assert.deepEqual(accounting(state), initialAccounting); assert.equal(forbiddenFetches, 0); assert.equal(state.ports.assetFetchAttempts, 0);
  assert.equal(state.eventCount("DocumentRenderCompleted"), 0); assert.equal(state.eventCount("ArtifactApproved"), 0);
  assert.equal(state.eventCount("OutputTargetAccepted"), 1); assert.equal(state.eventCount("OutputDeliveryPrepared"), 1);
  assert.equal(state.ports.media.filter(row => row.method === "put").length, 1);
  await state.drain(); retainedFilm(state, assetId, film);
  await preserve("local-composition-actual-receipt.json", encode({
    scope: "NEW pure local composition and actual in-memory SQLite/RAM production-handler pipeline. Fifteen repeated-color owned software fixture slots, one thirty-second structurally inspected MP4. No Harbor original completion, provider, browser decode, human review or live database claim.",
    sourceFacts: facts, sourceDigest: plan.sourceDigest, planRevisionId: plan.revisionId, target,
    film: { bytes: film.bytes.length, sha256: film.sha256, info: film.info, sources: film.sources },
    acceptance, storage: { row: retained.row, write: retained.write, metadata: retained.object.metadata },
    package: { bytes: pack.bytes.length, sha256: digest(pack.bytes), manifest: pack.manifest, csv: pack.csv },
    refusals, faults, sourceEditRetiredReviewReuseExportDownload: true,
    finalAuthority: authority(state), requests: state.requests, mediaOperations: state.ports.media,
    accounting: initialAccounting, accountingUnchanged: true, providerRequests: forbiddenFetches,
    assetFetchAttempts: state.ports.assetFetchAttempts, backgroundPending: 0,
  }));
});
