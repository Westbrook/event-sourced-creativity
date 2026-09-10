import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
import { png, readStoredZip } from "./output-asset-fixtures.mjs";

// Declared synthetic film-script, real local SQLite/D1 and owned RAM MEDIA.
// Production handlers may import provider definitions; no provider bridge is
// supplied, no provider function is dispatched and all fetches are forbidden.
const hooks = registerOutputSourceImports();
const [{ ensureSchema, makeEvent, appendEvents, readWorkspaceEvents },
  { handleOutputRequirements }, { handleWorkspaces }, { handleSession }, { handleEvents },
  { buildOutcomeRecipeDraft }, { confirmOutputRequirementInterpretation },
  { authoritativeCreativeContext }, { FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES, outputDeliveryMessageDescriptor }] = await Promise.all([
  import("../worker/runtime.ts"), import("../worker/output-requirements-api.ts"),
  import("../worker/workspaces-api.ts"), import("../worker/pilot-policy.ts"), import("../worker/events-api.ts"),
  import("../src/model/outcome-recipes.ts"), import("../src/model/output-requirements.ts"),
  import("../worker/context-authority.ts"),
  import("../src/components/design-system/locales/output-delivery-runtime-messages.ts"),
]).finally(() => hooks.deregister());
const digest = value => createHash("sha256").update(value).digest("hex");
// Authored for this software test, not recovered original film-script material.
const facts = [
  { block_id: "film-subject", type: "direction", properties: { text: "Mara returns the brass key to the harbor keeper before sunset." } },
  { block_id: "film-continuity", type: "direction", properties: { text: "The brass key stays in Mara's left hand until she places it on the chart." } },
  { block_id: "film-exclusion", type: "exclusion", properties: { text: "No rescue, invented dialogue or completed-film claim is requested." } },
];
const SCRIPT_TEXT = "\uFEFF# Harbor key — declared synthetic script\r\n\r\n"
  + "Mara returns the brass key to the harbor keeper before sunset.\r\n"
  + "The brass key stays in Mara's left hand until she places it on the chart.\r\n"
  + "No rescue, invented dialogue or completed-film claim is requested.\r\n\r\n"
  + "Authored reading markers: café · 雨 · الميناء · 🌱.\r\n"
  + "[Inert reference](https://example.invalid/no-fetch)\r\n"
  + "<script>not executed; retained literal text</script>\r\n";
const SCRIPT = new TextEncoder().encode(SCRIPT_TEXT), SCRIPT_SHA = digest(SCRIPT);
const OWNER = "dev-local-creative", DOC = "film-script-recipe-document", PROJECT = "film-script-recipe-project";
const API = "/api/output-requirements", STREAM = `creative:${OWNER}`;
const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const text = value => new TextDecoder().decode(value);
// Same actual Workspace/session membership sequence as artifact-review-host76–113.
// Copy this finite API setup instead of importing its unrelated renderer/Scene host.
async function shareWithIndependentReviewer(worker) {
  const reviewer = "film-script-independent-reviewer";
  const organization = await worker.request("/api/workspaces", json({ name: "Film script exact review fixture" }));
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
  state.env.ASSETS = { fetch() { ports.assetFetchAttempts++; throw new Error("film_assets_network_forbidden"); } };
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
    .run(OWNER, "creative@local.forma", "Local film-script author", now, now, now);
  const authored = (type, payload) => makeEvent(STREAM, 0, `user:${OWNER}`, "film-script-recipe-test", "authored-source", type, { project_id: PROJECT, document_id: DOC, ...payload });
  await appendEvents(state.env, [
    authored("ProjectCreated", { project_id: PROJECT, name: "Film script recipe" }),
    authored("DocumentCreated", { title: "Declared synthetic film-script brief", handle: "film-script-recipe" }),
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
    const response = await worker.request(API, json({ documentId: DOC, clientMutationId: `film-script-${++serial}`, expectedRevision: current.revision, ...body }));
    assert.equal(response.status, status, await response.clone().text());
    const result = await response.json(); if (expectedError) assert.equal(result.error, expectedError); return result;
  }
  async function upload(bytes, name, mimeType = "text/markdown") {
    const current = await snapshot();
    const response = await worker.request(`${API}/assets?documentId=${DOC}`, { method: "POST", headers: {
      "content-type": mimeType, "x-output-filename": encodeURIComponent(name), "x-output-rights-confirmed": "true",
      "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `film-script-upload-${++serial}`,
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
  const directory = process.env.FILM_ACTUAL_DIR;
  if (!directory) return;
  assert.ok(isAbsolute(directory)); assert.match(name, /^[a-z0-9][a-z0-9.-]*$/u);
  const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
}
const encode = value => new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
const originalFetch = globalThis.fetch; let forbiddenFetches = 0;
test.before(() => { globalThis.fetch = async () => { forbiddenFetches++; throw new Error("film_provider_network_forbidden"); }; });
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
function scopedStorage(state, assetId) {
  const row = state.sqlite.prepare("SELECT * FROM output_assets WHERE asset_id=?").get(assetId);
  assert.ok(row); assert.equal(row.owner_user_id, OWNER); assert.equal(row.document_id, DOC);
  assert.equal(row.media_kind, "document"); assert.equal(row.mime_type, "text/markdown");
  assert.equal(row.content_sha256, SCRIPT_SHA); assert.equal(row.byte_length, SCRIPT.length);
  assert.equal(row.storage_key, `output-requirements/${OWNER}/${PROJECT}/${DOC}/${assetId}/${SCRIPT_SHA}.md`);
  const object = state.media.get(row.storage_key); assert.ok(object);
  assert.deepEqual(object.bytes, SCRIPT); assert.equal(object.contentType, "text/markdown");
  assert.equal(object.metadata.ownerId, OWNER); assert.equal(object.metadata.projectId, PROJECT);
  assert.equal(object.metadata.documentId, DOC); assert.equal(object.metadata.assetId, assetId);
  assert.equal(object.metadata.scopeKey, row.scope_key); assert.equal(object.metadata.sha256, SCRIPT_SHA);
  const write = state.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE asset_id=?").get(assetId);
  assert.equal(write.status, "written"); assert.equal(write.write_acknowledged, 1);
  assert.equal(write.storage_key, row.storage_key); assert.equal(write.content_sha256, SCRIPT_SHA);
  assert.equal(write.publication_event_id, row.created_event_id);
  return { row, object, write };
}

async function authorPlan(state, withFilm) {
  const before = await state.snapshot();
  assert.equal(before.capabilities.nativeGeneration, false, "No installed execution bridge in this integration");
  assert.ok(before.capabilities.supportedFileExtensions.includes("md"));
  const currentSource = authoritativeCreativeContext(await readWorkspaceEvents(state.env, STREAM), { documentId: DOC, projectId: PROJECT });
  assert.deepEqual(currentSource.snapshot.facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })),
    facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })));
  const draft = buildOutcomeRecipeDraft({
    scope: { projectId: PROJECT, documentId: DOC, authorizationScopeKey: `project:${before.scope.organizationId}:${before.scope.projectAccessId}` },
    expectedRevision: before.revision, sourceRevision: before.sourceRevision, requirementRevision: before.requirementRevision,
    requirementId: "film-script-requirement", recipeId: "film-continuity",
    selectedChoices: withFilm ? ["script", "composed-film"] : ["script"],
    originalText: withFilm
      ? "One owned Markdown script covering the saved brief, plus one separately owed composed film of exactly 30 seconds. These are declared test-author requirements; no film or measured video is supplied."
      : "Only one owned Markdown script covering the saved brief is requested in this case. Completing this script package is not completing a film.",
    labels: { requirement: "Declared synthetic harbor script scope", choices: { script: "Harbor script file", "composed-film": "Separately owed composed film" },
      sourceUnknown: "Confirm the saved source blocks", coverageUnknown: "Confirm exact source coverage",
      scriptOwed: "Script remains owed; adopt owned Markdown and review rights and coverage. Native document generation is unavailable.",
      composedFilmOwed: "Composed film remains separately owed and unassembled." },
  });
  assert.equal(draft.spec.deliverables.length, withFilm ? 2 : 1);
  for (const row of draft.spec.deliverables) {
    assert.equal(row.quantity.kind, "unknown"); assert.equal(row.source_scope.kind, "unknown");
    assert.equal(row.coverage.kind, "unresolved"); assert.equal(row.required, true);
  }
  assert.deepEqual(await state.snapshot(), before, "Local recipe choice grants no saved authority");
  let unresolved = null;
  if (withFilm) {
    // Preserve the actual model vocabulary: unknown quantity/source/coverage
    // yields an unresolved assignment, never a known partial or completed Film.
    const unknown = confirmOutputRequirementInterpretation(structuredClone(draft.spec));
    await state.command({ action: "save", blockId: unknown.id, spec: unknown });
    unresolved = (await state.command({ action: "confirm" })).snapshot;
    assert.equal(unresolved.summary.completion, "unresolved");
    assert.equal(unresolved.summary.delivery_ready, false);
    assert.equal(unresolved.summary.unresolved_required_groups, 2);
    assert.equal(unresolved.confirmedPlan.plan.targets.length, 0);
    assert.equal(unresolved.confirmedPlan.plan.obligations.length, 2);
    const stable = authority(state);
    await state.command({ action: "export", planRevisionId: unresolved.confirmedPlan.revisionId }, 409, "output_assignment_incomplete");
    assert.deepEqual(authority(state), stable);
  }
  let spec = structuredClone(draft.spec);
  const confirmed = { kind: "confirmed", text: "Explicit synthetic test-author decision over the three exact saved brief blocks." };
  for (const row of spec.deliverables) {
    row.quantity = { kind: "exact", unit: row.media_kind === "document" ? "document" : "video", value: 1 };
    row.source_scope = { kind: "blocks", block_ids: facts.map(f => f.block_id) };
    row.coverage = { kind: "document_context" };
    for (const key of ["quantity", "source_scope", "coverage"]) row.value_origins[key] = confirmed;
    if (row.media_kind === "video") {
      row.content_quantity = { kind: "exact", unit: "second", value: 30 };
      row.value_origins.content_quantity = confirmed;
    }
  }
  await state.command({ action: "save", blockId: spec.id, spec });
  await state.command({ action: "confirm" }, 409, "output_interpretation_review_required");
  spec = confirmOutputRequirementInterpretation(spec);
  const saved = await state.command({ action: "save", blockId: spec.id, spec });
  assert.deepEqual(saved.snapshot.requirements[0].spec, spec);
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  assert.equal(plan.sourceDigest, saved.snapshot.sourceRevision);
  assert.equal(plan.plan.obligations.length, withFilm ? 2 : 1);
  assert.equal(plan.plan.targets.length, withFilm ? 2 : 1);
  assert.deepEqual(plan.plan.unresolved_groups, []);
  for (const target of plan.plan.targets) {
    assert.equal(target.required, true); assert.deepEqual(target.blocking_issues, []);
    assert.deepEqual(target.source_scope, { kind: "blocks", block_ids: facts.map(f => f.block_id) });
  }
  const scriptTarget = plan.plan.targets.find(row => row.media_kind === "document"); assert.ok(scriptTarget);
  const filmTarget = plan.plan.targets.find(row => row.media_kind === "video");
  if (withFilm) { assert.ok(filmTarget); assert.deepEqual(filmTarget.count_policy, { kind: "exact", unit: "second", value: 30 }); }
  else assert.equal(filmTarget, undefined);
  return { plan, scriptTarget, filmTarget, unresolved: unresolved && { summary: unresolved.summary, plan: unresolved.confirmedPlan } };
}

async function unpack(response, status, targetCount) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-output-delivery-completion"), status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.headers.get("x-output-sha256"), digest(bytes));
  const entries = readStoredZip(bytes), manifest = JSON.parse(text(entries.get("manifest.json"))), csv = readCsv(text(entries.get("manifest.csv")));
  assert.equal(manifest.deliveryStatus, status); assert.equal(manifest.scopeHistoryComplete, true);
  for (const key of ["groups", "obligations", "targets"]) assert.equal(manifest.scope[key].length, targetCount);
  assert.equal(manifest.summary.owedTargets, targetCount); assert.deepEqual(manifest.scope.unresolvedGroups, []);
  assert.equal(manifest.files.length, 1); assert.equal(manifest.targets.length, 1); assert.equal(entries.size, 3);
  const file = manifest.files[0];
  assert.equal(file.sha256, SCRIPT_SHA); assert.equal(file.byteLength, SCRIPT.length);
  assert.match(file.path, /\.md$/u); assert.deepEqual(entries.get(file.path), SCRIPT);
  assert.equal(csv.filter(row => row.record_type === "file").length, 1);
  assert.ok(csv.some(row => row.record_type === "file" && row.sha256 === SCRIPT_SHA && row.file_id === file.id));
  assert.equal([...entries.keys()].some(name => /\.(?:mp4|mov|webm|wav|mp3)$/iu.test(name)), false);
  return { bytes, entries, manifest, csv };
}

async function runCase(t, withFilm) {
  const caseName = withFilm ? "script-and-missing-film" : "script-only";
  const state = await fixture(t, caseName), initialAccounting = accounting(state);
  for (const row of initialAccounting.tokens) { assert.equal(row.used_tokens, 0); assert.equal(row.reserved_tokens, 0); }
  for (const row of initialAccounting.money) { assert.equal(row.used_microusd, 0); assert.equal(row.reserved_microusd, 0); }
  const { plan, scriptTarget, filmTarget, unresolved } = await authorPlan(state, withFilm);
  const refusals = [];
  async function refused(body, status, error, headers = state.sharing.ownerHeaders) {
    const stable = authority(state); state.worker.setHeaders(headers);
    const result = await state.command(body, status, error);
    state.worker.setHeaders(state.sharing.ownerHeaders); assert.deepEqual(authority(state), stable);
    refusals.push({ action: body.action, status, error }); return result;
  }
  // Upload permission is an explicit attestation before any MEDIA write.
  const uploadRevision = (await state.snapshot()).revision, writesBefore = state.ports.media.filter(row => row.method === "put").length;
  const noRightsState = authority(state);
  const noRights = await state.worker.request(`${API}/assets?documentId=${DOC}`, { method: "POST", headers: {
    "content-type": "text/markdown", "x-output-filename": "script.md", "x-output-rights-confirmed": "false",
    "x-output-expected-revision": uploadRevision, "x-output-client-mutation-id": "no-rights-upload",
  }, body: SCRIPT });
  assert.equal(noRights.status, 403); assert.equal((await noRights.json()).error, "owned_file_rights_attestation_required");
  assert.equal(state.ports.media.filter(row => row.method === "put").length, writesBefore);
  assert.deepEqual(authority(state), noRightsState);
  refusals.push({ action: "upload", status: 403, error: "owned_file_rights_attestation_required" });
  const uploaded = await state.upload(SCRIPT, "script.md"), assetId = uploaded.command.assetId;
  const asset = uploaded.snapshot.assets.find(row => row.id === assetId); assert.ok(asset);
  assert.equal(asset.mediaKind, "document"); assert.equal(asset.mimeType, "text/markdown");
  assert.equal(asset.sha256, SCRIPT_SHA); assert.equal(asset.inspection.kind, "document");
  assert.deepEqual(asset.inspection.facts, {});
  for (const code of ["output_markdown_content_review_required", "output_inspection_not_acceptance"]) assert.ok(asset.inspection.limitationCodes.includes(code));
  for (const code of ["invalid_markdown_text", "output_markdown_content_review_required"]) {
    const descriptor = outputDeliveryMessageDescriptor(code); assert.equal(descriptor.known, true);
    for (const locale of ["en", "fr", "ar", "ja"]) {
      const copy = FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES[locale][descriptor.id];
      assert.equal(typeof copy, "string"); assert.ok(copy.trim().length > 20); assert.match(copy, /UTF-8|Markdown|\.md/u);
      assert.notEqual(copy, FORMA_OUTPUT_DELIVERY_RUNTIME_MESSAGES[locale]["output.delivery.message.unknown"]);
    }
  }
  const retained = scopedStorage(state, assetId);
  const binding = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, assetId });
  const result = binding.snapshot.results.find(row => row.id === binding.command.resultId); assert.ok(result);
  assert.equal(result.checksStatus, "passed"); assert.equal(result.review, "pending");
  assert.equal(result.sha256, SCRIPT_SHA); assert.equal(result.resultRevision, SCRIPT_SHA);
  assert.equal(result.sourceDigest, plan.sourceDigest); assert.equal(result.targetContractDigest, plan.targetContractDigests[scriptTarget.id]);
  const approve = { action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true };
  await refused(approve, 403, "independent_output_reviewer_required");
  await refused({ ...approve, reviewedRights: false }, 403, "output_content_and_rights_review_required", state.sharing.reviewerHeaders);
  await refused({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");

  state.worker.setHeaders(state.sharing.reviewerHeaders);
  assert.equal((await state.snapshot()).results.find(row => row.id === result.id).reviewAllowed, true);
  const approved = await state.command({ ...approve, note: "Eligible distinct synthetic reviewer accepts this exact authored script/source/rights contract. This test is not a human review or completed-film claim." });
  state.worker.setHeaders(state.sharing.ownerHeaders);
  const acceptance = state.sqlite.prepare("SELECT * FROM output_target_acceptances WHERE acceptance_id=?").get(approved.command.acceptanceId);
  assert.ok(acceptance); assert.equal(acceptance.reviewer_user_id, state.sharing.reviewer); assert.notEqual(acceptance.reviewer_user_id, OWNER);
  assert.equal(acceptance.result_revision, SCRIPT_SHA); assert.equal(acceptance.content_sha256, SCRIPT_SHA);
  assert.equal(acceptance.target_id, scriptTarget.id); assert.equal(acceptance.result_id, result.id);
  assert.equal(acceptance.source_digest, plan.sourceDigest); assert.equal(acceptance.target_contract_digest, plan.targetContractDigests[scriptTarget.id]);
  const ready = await state.snapshot();
  assert.equal(ready.summary.required_obligations, withFilm ? 2 : 1);
  assert.equal(ready.summary.fulfilled_required_obligations, 1);
  assert.equal(ready.summary.delivery_ready, !withFilm);
  if (withFilm) {
    assert.equal(ready.summary.completion, "partial");
    await refused({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
    await refused({ action: "bind", planRevisionId: plan.revisionId, targetId: filmTarget.id, acceptanceId: acceptance.acceptance_id }, 409, "prior_output_acceptance_not_eligible");
  } else assert.equal(ready.summary.completion, "complete");
  const delivery = await state.command({ action: "export", planRevisionId: plan.revisionId, ...(withFilm ? { allowPartial: true } : {}) });
  assert.equal(delivery.command.partCount, 1);
  const status = withFilm ? "partial" : "complete", pack = await unpack(await state.worker.request(delivery.command.downloadUrl), status, withFilm ? 2 : 1);
  assert.deepEqual(pack.manifest.targets, [{ targetId: scriptTarget.id, fileId: assetId, acceptanceId: acceptance.acceptance_id }]);
  if (withFilm) {
    assert.ok(pack.manifest.missingWork.some(row => row.targetId === filmTarget.id && row.label.includes("Separately owed composed film")));
    assert.ok(pack.csv.some(row => row.record_type === "missing_work" && row.target_id === filmTarget.id && row.label.includes("Separately owed composed film")));
    assert.equal(pack.manifest.scope.targets.find(row => row.id === filmTarget.id)?.deliveryState, "missing");
  } else { assert.deepEqual(pack.manifest.missingWork, []); assert.equal(pack.csv.filter(row => row.record_type === "missing_work").length, 0); }
  await preserve(`${caseName}.zip`, pack.bytes);
  await preserve(`${caseName}-manifest.json`, pack.entries.get("manifest.json"));
  await preserve(`${caseName}-manifest.csv`, pack.entries.get("manifest.csv"));
  if (!withFilm) await preserve("script.md", SCRIPT);

  if (!withFilm) {
    // Binary signature wins even when the upload advertises the new suffix/MIME.
    // Failed candidate evidence is permitted; it cannot acquire authority.
    const stable = authority(state), wrong = await state.upload(png({ width: 3, height: 2 }), "misleading.md", "text/markdown");
    const wrongAsset = wrong.snapshot.assets.find(row => row.id === wrong.command.assetId);
    assert.equal(wrongAsset.mediaKind, "image"); assert.equal(wrongAsset.mimeType, "image/png");
    const boundWrong = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, assetId: wrong.command.assetId });
    const failed = boundWrong.snapshot.results.find(row => row.id === boundWrong.command.resultId);
    assert.equal(failed.checksStatus, "failed"); assert.ok(failed.problems.includes("target_media_kind_mismatch"));
    await refused({ ...approve, resultId: failed.id }, 409, "output_mandatory_checks_failed", state.sharing.reviewerHeaders);
    assert.deepEqual(authority(state), stable);
  }

  // Adversarial local object substitutions, explicitly restored. No product
  // row/schema/trigger is edited, and no response is manufactured by the test.
  const faults = [];
  for (const fault of ["foreign_owner", "changed_private_bytes"]) {
    const stable = authority(state), object = structuredClone(state.media.get(retained.row.storage_key));
    const revision = (await state.snapshot()).revision;
    try {
      const changed = structuredClone(object);
      if (fault === "foreign_owner") changed.metadata.ownerId = "foreign-film-owner";
      else { changed.bytes = changed.bytes.slice(); changed.bytes[changed.bytes.length - 3] ^= 1; }
      state.media.set(retained.row.storage_key, changed);
      const response = await state.worker.request(API, json({ documentId: DOC, clientMutationId: `fault-${fault}`, expectedRevision: revision,
        action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, acceptanceId: acceptance.acceptance_id }));
      assert.equal(response.status, 409, await response.clone().text());
      const error = (await response.json()).error;
      assert.equal(error, fault === "foreign_owner" ? "output_asset_custody_mismatch" : "output_asset_bytes_changed");
      const refusedDownload = await state.worker.request(delivery.command.downloadUrl);
      assert.equal(refusedDownload.status, 409, await refusedDownload.clone().text());
      const downloadError = (await refusedDownload.json()).error;
      // The download checks the current metadata inventory before opening bytes.
      assert.equal(downloadError, fault === "foreign_owner" ? "output_accepted_file_changed" : "output_asset_bytes_changed");
      assert.deepEqual(authority(state), stable); faults.push({ fault, status: 409, error, downloadError, authorityUnchanged: true });
    } finally { state.media.set(retained.row.storage_key, object); }
    scopedStorage(state, assetId);
    const again = await unpack(await state.worker.request(delivery.command.downloadUrl), status, withFilm ? 2 : 1);
    assert.deepEqual(again.bytes, pack.bytes); assert.deepEqual(again.manifest, pack.manifest);
  }
  const stable = authority(state);
  await appendEvents(state.env, [state.authored("BlockPropertyEdited", { block_id: facts[0].block_id, property_path: "text", new_value: facts[0].properties.text + " Revised source: return the key after sunset." })]);
  const refreshed = await state.worker.request("/api/events?after=0&limit=2000&content=0"); assert.equal(refreshed.status, 200, await refreshed.clone().text());
  const changed = await state.snapshot(); assert.notEqual(changed.sourceRevision, plan.sourceDigest); assert.equal(changed.summary.delivery_ready, false);
  await refused(approve, 409, "output_plan_needs_reconfirmation", state.sharing.reviewerHeaders);
  await refused({ action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, acceptanceId: acceptance.acceptance_id }, 409, "output_plan_needs_reconfirmation");
  await refused({ action: "export", planRevisionId: plan.revisionId, ...(withFilm ? { allowPartial: true } : {}) }, 409, "output_plan_needs_reconfirmation");
  const staleDownload = await state.worker.request(delivery.command.downloadUrl);
  assert.equal(staleDownload.status, 409); assert.equal((await staleDownload.json()).error, "output_plan_needs_reconfirmation");
  assert.deepEqual(authority(state), stable);
  assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets WHERE media_kind='video'").get().count, 0);
  for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "output_provider_calls", "budget_reservations", "cost_budget_reservations"]) assert.equal(state.count(table), 0, table);
  assert.deepEqual(accounting(state), initialAccounting); assert.equal(forbiddenFetches, 0); assert.equal(state.ports.assetFetchAttempts, 0);
  assert.equal(state.eventCount("DocumentRenderCompleted"), 0); assert.equal(state.eventCount("ArtifactApproved"), 0);
  assert.equal(state.eventCount("OutputTargetAccepted"), 1); assert.equal(state.eventCount("OutputDeliveryPrepared"), 1);
  assert.equal(state.ports.media.filter(row => row.method === "put").length, withFilm ? 1 : 2);
  await state.drain(); scopedStorage(state, assetId);
  await preserve(`${caseName}-actual-receipt.json`, encode({
    scope: "Declared synthetic script bytes; actual local handlers and distinct eligible synthetic shared review. No generated script, composed film, human review, browser Download, renderer or provider claim.",
    caseName, sourceFacts: facts, sourceDigest: plan.sourceDigest, planRevisionId: plan.revisionId,
    originalScript: { bytes: SCRIPT.length, sha256: SCRIPT_SHA, encoding: "UTF-8 with original BOM and CRLF", semanticInspection: false },
    unresolved, targets: plan.plan.targets, acceptance, storage: { row: retained.row, write: retained.write, metadata: retained.object.metadata },
    package: { bytes: pack.bytes.length, sha256: digest(pack.bytes), manifest: pack.manifest, csv: pack.csv },
    refusals, faults, sourceEditRetiredReviewReuseExportDownload: true, finalAuthority: authority(state),
    requests: state.requests, mediaOperations: state.ports.media, accounting: initialAccounting, accountingUnchanged: true,
    providerRequests: forbiddenFetches, assetFetchAttempts: state.ports.assetFetchAttempts, backgroundPending: 0,
  }));
}

test("owned Markdown script has exact shared review and complete script-only delivery", t => runCase(t, false));
test("script plus separately owed composed film remains partial; unresolved scope is never completed", t => runCase(t, true));

// Joined Scene → Film continuation. The two original Film cases above remain
// unchanged. Only the named safe Scene donor declarations/native ports are
// composed here; no Scene test suite is imported or registered.
import { resolveObjectURL } from "node:buffer";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import {
  nodes, disabled, reviewControl, settle, click, openGallery, promote,
  currentArtifact, currentHash, currentReview, currentDelivery, hash, loadActual,
} from "./helpers/artifact-review-host.mjs";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { artifactApprovalMatches } from "../src/model/artifact-delivery.ts";
import { appendAuditEvent } from "../worker/runtime.ts";
import { storePrivateContent } from "../worker/pilot-policy.ts";
import { documentArtifactValidationIssues, parseDocumentArtifactContent, documentArtifactRevision } from "../src/model/document-artifacts.ts";

const joinedSourceText = "At dawn, Mara checks a salt-stained chart beneath a brass lantern in the harbor watch room. The keeper has marked the safe channel.";
// Exact finite RAM MEDIA implementation from output-server-test-helpers.mjs.
// Its map joins both surfaces to the Scene fixture's single active SQLite DB.
function joinedMediaPort() {
  const media = new Map();
  const MEDIA = {
    async put(key, value, options = {}) { const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value); media.set(key, { bytes: bytes.slice(), metadata: structuredClone(options.customMetadata ?? {}), contentType: options.httpMetadata?.contentType }); return { key, httpEtag: "test-etag" }; },
    async get(key) { const item = media.get(key); return item ? { body: new Blob([item.bytes]).stream(), size: item.bytes.length, customMetadata: structuredClone(item.metadata), httpEtag: "test-etag", writeHttpMetadata(headers) { headers.set("content-type", item.contentType ?? "application/octet-stream"); } } : null; },
    async head(key) { return this.get(key); },
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) media.delete(key); },
    async list(options = {}) {
      const keys = [...media.keys()].filter((key) => !options.prefix || key.startsWith(options.prefix)).sort();
      const start = Number(options.cursor ?? 0), limit = Math.min(1000, Math.max(1, Number(options.limit ?? 1000))), selected = keys.slice(start, start + limit);
      return { objects: selected.map((key) => { const value = media.get(key); return { key, size: value.bytes.length, customMetadata: structuredClone(value.metadata), httpMetadata: { contentType: value.contentType } }; }), truncated: start + limit < keys.length, ...(start + limit < keys.length ? { cursor: String(start + limit) } : {}) };
    },
  };
  return { media, MEDIA };
}

// Reuse the existing media-title fixture's export-only frame/reviewer setup.
// No production method is replaced and no test body is executed by this import.
const hostUrl = pathToFileURL(fs.realpathSync(new URL("./helpers/artifact-review-host.mjs", import.meta.url)));
const hostSource = fs.readFileSync(hostUrl, "utf8"), hostVirtual = hostUrl.href + "?scene-film-joined-file-setup";
const hostHook = registerHooks({ load(url, context, next) {
  return url === hostVirtual ? { format: "module", source: hostSource + "\nexport {fixture,shareWithIndependentReviewer};\n", shortCircuit: true } : next(url, context);
} });
const { fixture: createFrame, shareWithIndependentReviewer: shareSceneWithIndependentReviewer } = await import(hostVirtual).finally(() => hostHook.deregister());
const { localizeTemplateResult } = await loadActual("src/components/design-system/localized-template.ts");
const originalMarkdown = "# INT. HARBOR WATCH ROOM — DAWN\n\nMara checks the salt-stained chart beneath a brass lantern.\n\nMARA\nThe channel is clear.\n";

async function createSceneReviewHost(t) {
  const worker = await createSceneCostFixture(1, "visual", { depth: true });
  const { media, MEDIA } = joinedMediaPort(), routeReceipts = [], pendingWorker = new Set();
  const mediaCalls = []; let scopedHeaders = {}, assetFetches = 0, closed = false, disposeScene = null;
  // The inherited fixture's generation methods are never invoked. Remove its
  // unused fake credential and refuse those routes before the actual Worker.
  delete worker.env.OPENAI_API_KEY;
  worker.env.ASSETS = { fetch() { assetFetches++; throw new Error("joined_scene_film_asset_fetch_forbidden"); } };
  worker.env.MEDIA = MEDIA;
  for (const method of ["put", "get", "head", "delete", "list"]) {
    const original = MEDIA[method].bind(MEDIA);
    MEDIA[method] = async (...args) => {
      assert.ok(mediaCalls.length < 300, "finite owned MEDIA calls");
      mediaCalls.push({ method, key: typeof args[0] === "string" ? args[0] : null });
      return original(...args);
    };
  }
  const originalRequest = worker.request, originalHeaders = worker.setScopedHeaders, originalClose = worker.close;
  worker.setScopedHeaders = headers => { scopedHeaders = { ...headers }; originalHeaders(headers); };
  worker.request = async (route, init = {}) => {
    assert.ok(routeReceipts.length < 240, "finite joined application requests");
    assert.ok(route.startsWith("/") && !route.startsWith("//"), "only relative local application routes");
    const pathname = new URL(route, "http://localhost").pathname, method = init.method ?? "GET";
    if (pathname === API) {
      assert.ok(method === "GET" || method === "POST");
      if (method === "POST") assert.ok(["save", "confirm", "bind", "review", "export"].includes(JSON.parse(init.body).action), "no Output preflight, grant or provider execution action");
    } else if (pathname.startsWith(API + "/")) {
      assert.ok(pathname === API + "/assets" && method === "POST"
        || /^\/api\/output-requirements\/deliveries\/[^/]+$/u.test(pathname) && method === "GET", "only owned Markdown upload and prepared delivery reads");
    }
    assert.ok(pathname === "/api/session" || pathname.startsWith("/api/workspaces/") || pathname === "/api/workspaces"
      || pathname === "/api/events" || pathname.startsWith("/api/content/")
      || pathname === "/api/artifacts/retained-written-scene-revision-file"
      || pathname === API || pathname.startsWith(API + "/"), "only named existing application surfaces: " + route);
    if (pathname === "/api/events" && method !== "GET") {
      assert.equal(method, "POST");
      const body = JSON.parse(init.body), events = body.events ?? [body.event];
      assert.ok(events.length > 0 && events.length <= 2);
      assert.ok(events.every(event => ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(event.type)), "only actual Scene review/export writes");
    }
    const receipt = { path: route, method, actor: scopedHeaders["oai-authenticated-user-id"] ?? worker.owner };
    routeReceipts.push(receipt);
    const task = originalRequest(route, init); pendingWorker.add(task);
    try { const response = await task; receipt.status = response.status; return response; }
    finally { pendingWorker.delete(task); }
  };
  worker.close = () => { try { originalClose(); } finally { closed = true; media.clear(); } };
  t.after(async () => {
    try {
      await worker.drainBackground();
      if (disposeScene) await disposeScene();
      assert.equal(pendingWorker.size, 0); assert.equal(assetFetches, 0);
    } finally {
      if (!closed) worker.close();
      await preserve("scene-film-closure.json", encode({ databaseClosed: closed, mediaObjectsAfterDisposal: media.size,
        pendingWorker: pendingWorker.size, assetFetches, providerFetchAttempts: forbiddenFetches }));
    }
  });
  await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "BlockPropertyEdited", {
    project_id: worker.projectId, document_id: worker.documentId, block_id: "scene-reuse-direction", property_path: "text", new_value: joinedSourceText,
  });
  const source = authoritativeCreativeContext(await readWorkspaceEvents(worker.env, worker.streamId), { documentId: worker.documentId, projectId: worker.projectId });
  assert.ok(source.snapshot.facts.some(fact => fact.block_id === "scene-reuse-direction" && fact.properties.text === joinedSourceText));
  const priorRows = worker.sqlite.prepare("SELECT * FROM private_content ORDER BY content_id").all();
  const priorHistory = worker.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
  const artifactId = "retained-written-scene-revision-file";
  const draft = { title: "Harbor watch scene", summary: "A declared written Scene for local revision/review/file verification.",
    content_markdown: originalMarkdown, presentation: null,
    items: [{ title: "Harbor watch room", body: originalMarkdown, notes: "Preserve the authored harbor setting.", image_prompt: "", context_group_ids: [], slide: null }] };
  assert.deepEqual(documentArtifactValidationIssues("scene", parseDocumentArtifactContent(JSON.stringify(draft)), { itemCount: 1 }), []);
  const retained = JSON.stringify(draft), stored = await storePrivateContent(worker.env, worker.owner, "document-artifact", retained);
  const completion = await appendAuditEvent(worker.env, worker.streamId, "worker:renderer", "DocumentRenderCompleted", {
    project_id: worker.projectId, document_id: worker.documentId, artifact_id: artifactId, artifact_kind: "scene",
    title: draft.title, summary: draft.summary, content_ref: stored.contentId, item_count: 1,
    source_block_versions: source.sourceBlockVersions, requested_by_user_id: worker.owner,
    items: [{ id: "retained-written-scene-part", title: draft.items[0].title }],
    provider: "simulation", model_id: "retained-written-scene-fixture", simulation: true, source_surface: "document",
  });
  // A new typed retained fixture is declared through server storage before
  // ordinary content=1 bootstrap. Original Story bytes/history are untouched.
  for (const row of priorRows) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id), row);
  for (const row of priorHistory) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row);
  const sharing = await shareSceneWithIndependentReviewer(worker);
  const h = await createSceneStoreHost({ workerFixture: worker, shared: true, beforeFetch(input) {
    assert.ok(String(input).startsWith("/api/") && !String(input).startsWith("/api/document-jobs"), "no foreground generation stub or execution route may run");
  } }); h.store.patchUi({ instrumentation: false });
  const pending = new Set(), replies = [];
  h.transport = async request => {
    const task = worker.request(request.url, request.init); pending.add(task);
    try { const response = await task; replies.push({ request, status: response.status, body: await response.clone().json() }); return response; }
    finally { pending.delete(task); }
  };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (!String(url).startsWith("/api/")) { forbiddenFetches++; throw new Error("joined_scene_film_provider_network_forbidden"); }
    return h.fetch(url, init);
  });
  const f = createFrame("create", { locale: "en" });
  f.store = h.store; f.host.store = h.store; f.host.documentId = worker.documentId; f.host.launcherOnly = false;
  f.reviewReplies = replies; f.artifactId = artifactId; f.state.documentId = worker.documentId;
  const render = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return render.call(this, localizeTemplateResult(value, f.i18n), ...rest); }; f.draw();
  const initialCounts = worker.counts();
  disposeScene = async () => {
    await settle(f, () => pending.size === 0, "all actual application replies finish before disposal");
    await worker.drainBackground();
    assert.deepEqual(worker.counts(), initialCounts, "no job or budget admission");
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    f.i18n.hostDisconnected(); await h.close();
  };
  assert.equal(currentArtifact(f).sourceEventId, completion.eventId);
  assert.equal(currentArtifact(f).contentRef, stored.contentId);
  assert.equal(h.store.content.get()[stored.contentId], retained);
  const switchActor = async role => {
    worker.setScopedHeaders(role === "reviewer" ? sharing.reviewerHeaders : sharing.ownerHeaders);
    const response = await worker.request("/api/session"); assert.equal(response.status, 200);
    h.store.session.set(await response.json()); await h.store.refreshEvents(); f.draw();
  };
  return { f, h, worker, replies, sharing, switchActor, media, mediaCalls, routeReceipts, source,
    revision: () => documentArtifactRevision(h.store.events.get(), artifactId), priorRows, priorHistory };
}

// One composition of existing actual viewer/Store/Worker fixtures. Distinct
// synthetic principals exercise authorization; no human approval is claimed.
const revisedMarkdown = "# INT. HARBOR WATCH ROOM — DAWN\n\nMara aligns the salt-stained chart beneath the brass lantern. Rain taps the café window.\n\nMARA\nKeep the gate open — the keeper marked 雨 beside the safe channel.\n\nShe leaves a green 🌱 beside the final bearing.\n";
const isType = (request, type) => request.url === "/api/events"
  && (request.body?.events ?? [request.body?.event]).some(event => event?.type === type);
const replyFor = (q, type) => q.replies.find(reply => isType(reply.request, type));
const view = f => nodes(f, "dialog").find(node => node.classList.contains("document-artifact-view") && node.open);
const methodButton = (f, method) => {
  const found = nodes(f, "button").filter(node => node.handlers.click?.toString().includes(method));
  assert.equal(found.length, 1, "one current actual viewer control: " + method); return found[0];
};
async function actions(f) {
  const popover = f.renderer.query(f.host, "forma-ui-popover").find(node => node.attributes.class === "artifact-viewer-actions-popover");
  if (!popover) return;
  const panel = f.renderer.ownNodes(popover, "section").find(node => node.attributes.popover === "auto");
  const trigger = f.renderer.ownNodes(popover, "button").find(node => node.attributes.popovertarget === panel?.attributes.id);
  assert.ok(panel && trigger && trigger.isConnected);
  if (!panel.matches(":popover-open")) trigger.click(); // Existing native popovertarget default.
  await settle(f);
  assert.ok(f.renderer.ownNodes(popover, "section").find(node => node.attributes.popover === "auto")?.matches(":popover-open"));
}
function installMarkdownFilePort(t, f, q) {
  const document = f.host.ownerDocument, window = document.defaultView;
  const downloads = [], timers = [];
  const previousCreate = Object.getOwnPropertyDescriptor(document, "createElement");
  const previousTimer = Object.getOwnPropertyDescriptor(window, "setTimeout");
  // These are missing native ports only. Production creates the real Blob and
  // object URL and must receive real Worker export authorization before click.
  Object.defineProperty(document, "createElement", { configurable: true, value(tag) {
    assert.equal(tag, "a");
    return { href: "", download: "", click() {
      const receipt = replyFor(q, "DocumentArtifactExported");
      assert.equal(receipt?.status, 200, "actual export acknowledgment precedes the native download click");
      const blob = resolveObjectURL(this.href); assert.ok(blob instanceof Blob);
      assert.equal(blob.type, "text/markdown;charset=utf-8");
      assert.equal(this.download, "harbor-watch-scene.md");
      downloads.push({ blob, href: this.href, filename: this.download });
    } };
  } });
  Object.defineProperty(window, "setTimeout", { configurable: true, value(callback, ms) {
    assert.equal(ms, 1000, "only the existing object-URL cleanup timer"); timers.push(callback); return timers.length;
  } });
  t.after(() => {
    for (const callback of timers.splice(0)) callback();
    for (const download of downloads) assert.equal(resolveObjectURL(download.href), undefined);
    if (previousCreate) Object.defineProperty(document, "createElement", previousCreate); else delete document.createElement;
    if (previousTimer) Object.defineProperty(window, "setTimeout", previousTimer); else delete window.setTimeout;
  });
  return downloads;
}

async function joinSceneFileToFilm(t, q, scene) {
  const { f, h, worker, sharing } = q, { opened, savedHash, originalHash, expected, chain, exported } = scene;
  const documentId = worker.documentId, projectId = worker.projectId, rawSha = digest(opened);
  assert.notEqual(rawSha, savedHash, "raw Markdown and serialized Scene JSON have distinct byte identities");
  assert.notEqual(savedHash, originalHash);
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(opened), revisedMarkdown);
  assert.equal(digest(h.store.content.get()[currentArtifact(f).contentRef]), savedHash);
  assert.equal(q.revision(), 1);
  const completed = h.store.events.get().find(event => event.eventId === currentArtifact(f).sourceEventId);
  assert.ok(completed); assert.deepEqual(completed.payload.source_block_versions, q.source.sourceBlockVersions);
  const sceneApproval = chain.find(event => event.type === "ArtifactApproved"); assert.ok(sceneApproval);
  assert.equal(sceneApproval.actor, "user:" + sharing.reviewer);
  assert.equal(exported.body.appended[0].actor, "user:" + sharing.reviewer);
  const approvedScenePayload = structuredClone(sceneApproval.payload);
  await q.switchActor("owner");
  assert.equal(h.store.session.get().user.userId, worker.owner);

  // The same active RAM Worker, project context, source stream and MEDIA map
  // handle both surfaces. This facade only supplies existing HTTP call syntax.
  let serial = 0;
  const state = {
    sqlite: worker.sqlite, env: worker.env, media: q.media,
    eventCount: type => worker.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type=?").get(type).count,
    count: table => worker.sqlite.prepare("SELECT COUNT(*) AS count FROM " + table).get().count,
    async snapshot() {
      const response = await worker.request(`${API}?documentId=${documentId}`);
      assert.equal(response.status, 200, await response.clone().text()); return response.json();
    },
    async command(body, status = 200, expectedError) {
      const current = await this.snapshot();
      const response = await worker.request(API, json({ documentId, clientMutationId: `scene-film-${++serial}`, expectedRevision: current.revision, ...body }));
      assert.equal(response.status, status, await response.clone().text());
      const result = await response.json(); if (expectedError) assert.equal(result.error, expectedError); return result;
    },
  };
  const before = await state.snapshot(), initialAccounting = accounting(state);
  assert.equal(state.eventCount("ArtifactApproved"), 1);
  assert.equal(state.eventCount("OutputTargetAccepted"), 0, "Scene approval has granted no Output acceptance");
  assert.equal(state.count("output_target_acceptances"), 0);
  // The actual index installs its native execution bridge. Read its advertised
  // capability truthfully; the route/action guards above prohibit dispatch.
  assert.equal(typeof before.capabilities.nativeGeneration, "boolean");
  const trusted = authoritativeCreativeContext(await readWorkspaceEvents(worker.env, worker.streamId), { documentId, projectId });
  assert.deepEqual(trusted.sourceBlockVersions, q.source.sourceBlockVersions);
  const sourceFact = trusted.snapshot.facts.find(fact => fact.block_id === "scene-reuse-direction");
  assert.ok(sourceFact); assert.equal(sourceFact.type, "direction"); assert.equal(sourceFact.properties.text, joinedSourceText);
  // These exact authored harbor-watch facts belong to this Scene. The separate
  // brass-key fixture above contributes no facts or coverage to this contract.
  const draft = buildOutcomeRecipeDraft({
    scope: { projectId, documentId, authorizationScopeKey: `project:${before.scope.organizationId}:${before.scope.projectAccessId}` },
    expectedRevision: before.revision, sourceRevision: before.sourceRevision, requirementRevision: before.requirementRevision,
    requirementId: "scene-film-joined-requirement", recipeId: "film-continuity", selectedChoices: ["script", "composed-film"],
    originalText: "Adopt the exact locally authored and edited harbor-watch Scene Markdown as one script. A separately owed composed film of 30 seconds remains unassembled; no video asset or human approval is supplied.",
    labels: { requirement: "Edited harbor-watch Scene to Film", choices: { script: "Reviewed harbor-watch script", "composed-film": "Separately owed composed film" },
      sourceUnknown: "Confirm the exact authored harbor-watch source", coverageUnknown: "Review its exact source coverage",
      scriptOwed: "Adopt the actual saved Scene Markdown and independently review this Film script contract.",
      composedFilmOwed: "The separately owed composed film has no supplied video." },
  });
  assert.deepEqual(await state.snapshot(), before, "local recipe construction grants no authority");
  assert.equal(draft.spec.deliverables.length, 2);
  const spec = structuredClone(draft.spec), origin = { kind: "confirmed", text: "Declared synthetic test-author requirement over the one exact saved harbor-watch source block." };
  for (const row of spec.deliverables) {
    row.quantity = { kind: "exact", unit: row.media_kind === "document" ? "document" : "video", value: 1 };
    row.source_scope = { kind: "blocks", block_ids: [sourceFact.block_id] };
    row.coverage = { kind: "document_context" };
    for (const key of ["quantity", "source_scope", "coverage"]) row.value_origins[key] = origin;
    if (row.media_kind === "video") { row.content_quantity = { kind: "exact", unit: "second", value: 30 }; row.value_origins.content_quantity = origin; }
  }
  const confirmedSpec = confirmOutputRequirementInterpretation(spec);
  const saved = await state.command({ action: "save", blockId: spec.id, spec: confirmedSpec });
  assert.deepEqual(saved.snapshot.requirements.find(row => row.spec.id === spec.id).spec, confirmedSpec);
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  assert.equal(plan.sourceDigest, saved.snapshot.sourceRevision);
  assert.equal(plan.plan.targets.length, 2); assert.deepEqual(plan.plan.unresolved_groups, []);
  const scriptTarget = plan.plan.targets.find(row => row.media_kind === "document"), filmTarget = plan.plan.targets.find(row => row.media_kind === "video");
  assert.ok(scriptTarget && filmTarget); assert.notEqual(scriptTarget.id, filmTarget.id);
  for (const target of [scriptTarget, filmTarget]) {
    assert.equal(target.required, true); assert.deepEqual(target.source_scope, { kind: "blocks", block_ids: [sourceFact.block_id] });
    assert.deepEqual(target.blocking_issues, []);
  }
  assert.deepEqual(filmTarget.count_policy, { kind: "exact", unit: "second", value: 30 });
  const refusals = [];
  async function refused(body, status, error, headers = sharing.ownerHeaders) {
    const stable = authority(state); worker.setScopedHeaders(headers);
    try { await state.command(body, status, error); }
    finally { worker.setScopedHeaders(sharing.ownerHeaders); }
    assert.deepEqual(authority(state), stable); refusals.push({ action: body.action, status, error });
  }
  await refused({ action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, acceptanceId: sceneApproval.eventId }, 409, "prior_output_acceptance_not_eligible");
  assert.deepEqual(sceneApproval.payload, approvedScenePayload, "the legacy review receipt is retained rather than reclassified");
  const uploadRevision = (await state.snapshot()).revision;
  const response = await worker.request(`${API}/assets?documentId=${documentId}`, { method: "POST", headers: {
    "content-type": "text/markdown", "x-output-filename": "harbor-watch-scene.md", "x-output-rights-confirmed": "true",
    "x-output-expected-revision": uploadRevision, "x-output-client-mutation-id": `scene-film-upload-${++serial}`,
  }, body: opened });
  assert.equal(response.status, 200, await response.clone().text());
  const uploaded = await response.json(), assetId = uploaded.command.assetId;
  const asset = uploaded.snapshot.assets.find(row => row.id === assetId); assert.ok(asset);
  assert.equal(asset.sha256, rawSha); assert.equal(asset.mediaKind, "document"); assert.equal(asset.mimeType, "text/markdown");
  assert.equal(asset.inspection.kind, "document"); assert.deepEqual(asset.inspection.facts, {});
  assert.ok(asset.inspection.limitationCodes.includes("output_markdown_content_review_required"));
  assert.ok(asset.inspection.limitationCodes.includes("output_inspection_not_acceptance"));
  const retained = worker.sqlite.prepare("SELECT * FROM output_assets WHERE asset_id=?").get(assetId); assert.ok(retained);
  assert.equal(retained.owner_user_id, worker.owner); assert.equal(retained.document_id, documentId);
  assert.equal(retained.content_sha256, rawSha); assert.equal(retained.byte_length, opened.length);
  assert.equal(retained.storage_key, `output-requirements/${worker.owner}/${projectId}/${documentId}/${assetId}/${rawSha}.md`);
  const object = q.media.get(retained.storage_key); assert.ok(object); assert.deepEqual(Buffer.from(object.bytes), opened);
  assert.equal(object.contentType, "text/markdown");
  for (const [key, value] of Object.entries({ ownerId: worker.owner, projectId, documentId, assetId, scopeKey: retained.scope_key, sha256: rawSha })) assert.equal(object.metadata[key], value);
  const write = worker.sqlite.prepare("SELECT * FROM output_asset_storage_writes WHERE asset_id=?").get(assetId);
  assert.equal(write.status, "written"); assert.equal(write.write_acknowledged, 1);
  assert.equal(write.content_sha256, rawSha); assert.equal(write.publication_event_id, retained.created_event_id);
  const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, assetId });
  const result = bound.snapshot.results.find(row => row.id === bound.command.resultId); assert.ok(result);
  assert.equal(result.checksStatus, "passed"); assert.equal(result.review, "pending");
  assert.equal(result.sha256, rawSha); assert.equal(result.resultRevision, rawSha); assert.equal(result.sourceDigest, plan.sourceDigest);
  assert.equal(result.targetContractDigest, plan.targetContractDigests[scriptTarget.id]);
  assert.equal(state.eventCount("OutputTargetAccepted"), 0);
  const approve = { action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true };
  await refused(approve, 403, "independent_output_reviewer_required");
  await refused({ ...approve, reviewedCoverage: false }, 403, "output_content_and_rights_review_required", sharing.reviewerHeaders);
  await refused({ action: "export", planRevisionId: plan.revisionId, allowPartial: true }, 409, "no_accepted_outputs_to_export");
  worker.setScopedHeaders(sharing.reviewerHeaders);
  assert.equal((await state.snapshot()).results.find(row => row.id === result.id).reviewAllowed, true);
  const approved = await state.command({ ...approve, note: "Separate eligible synthetic Film decision on the exact adopted Scene Markdown, authored harbor-watch source and rights. Prior Scene approval alone was insufficient; no human or composed-film claim." });
  worker.setScopedHeaders(sharing.ownerHeaders);
  const acceptance = worker.sqlite.prepare("SELECT * FROM output_target_acceptances WHERE acceptance_id=?").get(approved.command.acceptanceId); assert.ok(acceptance);
  assert.equal(acceptance.reviewer_user_id, sharing.reviewer); assert.notEqual(acceptance.reviewer_user_id, worker.owner);
  assert.notEqual(acceptance.acceptance_id, sceneApproval.eventId);
  assert.equal(acceptance.content_sha256, rawSha); assert.equal(acceptance.result_revision, rawSha);
  assert.equal(acceptance.target_id, scriptTarget.id); assert.equal(acceptance.result_id, result.id);
  assert.equal(acceptance.source_digest, plan.sourceDigest); assert.equal(acceptance.target_contract_digest, plan.targetContractDigests[scriptTarget.id]);
  assert.equal(state.eventCount("ArtifactApproved"), 1); assert.equal(state.eventCount("OutputTargetAccepted"), 1);
  await refused({ action: "bind", planRevisionId: plan.revisionId, targetId: filmTarget.id, acceptanceId: acceptance.acceptance_id }, 409, "prior_output_acceptance_not_eligible");
  const ready = await state.snapshot();
  assert.equal(ready.summary.completion, "partial"); assert.equal(ready.summary.delivery_ready, false);
  assert.equal(ready.summary.required_obligations, 2); assert.equal(ready.summary.fulfilled_required_obligations, 1);
  await refused({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
  const delivery = await state.command({ action: "export", planRevisionId: plan.revisionId, allowPartial: true });
  assert.equal(delivery.command.partCount, 1);
  const download = await worker.request(delivery.command.downloadUrl);
  assert.equal(download.status, 200, await download.clone().text());
  assert.equal(download.headers.get("content-type"), "application/zip");
  assert.equal(download.headers.get("cache-control"), "private, no-store");
  assert.equal(download.headers.get("x-output-delivery-completion"), "partial");
  const zipBytes = new Uint8Array(await download.arrayBuffer()); assert.equal(download.headers.get("x-output-sha256"), digest(zipBytes));
  const entries = readStoredZip(zipBytes), manifest = JSON.parse(text(entries.get("manifest.json"))), csv = readCsv(text(entries.get("manifest.csv")));
  assert.equal(manifest.deliveryStatus, "partial"); assert.equal(manifest.scopeHistoryComplete, true);
  assert.equal(manifest.summary.owedTargets, 2); assert.equal(manifest.scope.targets.length, 2);
  assert.equal(manifest.files.length, 1); assert.equal(entries.size, 3);
  assert.deepEqual(manifest.targets, [{ targetId: scriptTarget.id, fileId: assetId, acceptanceId: acceptance.acceptance_id }]);
  const delivered = manifest.files[0]; assert.equal(delivered.sha256, rawSha); assert.equal(delivered.byteLength, opened.length);
  assert.match(delivered.path, /\.md$/u); assert.deepEqual(Buffer.from(entries.get(delivered.path)), opened);
  assert.ok(csv.some(row => row.record_type === "file" && row.sha256 === rawSha && row.file_id === assetId));
  assert.ok(manifest.missingWork.some(row => row.targetId === filmTarget.id && row.label.includes("Separately owed composed film")));
  assert.ok(csv.some(row => row.record_type === "missing_work" && row.target_id === filmTarget.id));
  assert.equal(manifest.scope.targets.find(row => row.id === filmTarget.id).deliveryState, "missing");
  assert.equal([...entries.keys()].some(name => /\.(?:mp4|mov|webm|wav|mp3)$/iu.test(name)), false);
  await preserve("scene-film-partial.zip", zipBytes);
  await preserve("scene-film-manifest.json", entries.get("manifest.json"));
  await preserve("scene-film-manifest.csv", entries.get("manifest.csv"));

  // A real authored source edit retires both uses without changing the saved
  // Markdown or its historical approvals into current authority.
  const stable = authority(state), revisedSource = joinedSourceText + " Revised requirement: the keeper closes the channel at noon.";
  await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "BlockPropertyEdited", {
    project_id: projectId, document_id: documentId, block_id: sourceFact.block_id, property_path: "text", new_value: revisedSource,
  });
  await h.store.refreshEvents(); f.draw();
  assert.equal(q.revision(), 1); assert.equal(currentHash(f), savedHash);
  assert.equal(currentDelivery(f).releaseAllowed, false, "old Scene approval cannot authorize the changed source");
  const changed = await state.snapshot(); assert.notEqual(changed.sourceRevision, plan.sourceDigest); assert.equal(changed.summary.delivery_ready, false);
  await refused(approve, 409, "output_plan_needs_reconfirmation", sharing.reviewerHeaders);
  await refused({ action: "bind", planRevisionId: plan.revisionId, targetId: scriptTarget.id, acceptanceId: acceptance.acceptance_id }, 409, "output_plan_needs_reconfirmation");
  await refused({ action: "export", planRevisionId: plan.revisionId, allowPartial: true }, 409, "output_plan_needs_reconfirmation");
  const staleDownload = await worker.request(delivery.command.downloadUrl);
  assert.equal(staleDownload.status, 409); assert.equal((await staleDownload.json()).error, "output_plan_needs_reconfirmation");
  assert.deepEqual(authority(state), stable);
  assert.deepEqual(Buffer.from(q.media.get(retained.storage_key).bytes), opened);
  assert.equal(worker.sqlite.prepare("SELECT COUNT(*) AS count FROM output_assets WHERE media_kind='video'").get().count, 0);
  for (const table of ["document_jobs", "output_execution_grants", "output_operation_slots", "output_provider_calls", "budget_reservations", "cost_budget_reservations"]) assert.equal(state.count(table), 0, table);
  assert.deepEqual(accounting(state), initialAccounting); assert.equal(forbiddenFetches, 0);
  assert.equal(state.eventCount("OutputTargetAccepted"), 1); assert.equal(state.eventCount("OutputDeliveryPrepared"), 1);
  assert.equal(q.mediaCalls.filter(row => row.method === "put").length, 1);
  await worker.drainBackground();
  const actual = await readWorkspaceEvents(worker.env, worker.streamId);
  const acceptedEvent = actual.find(event => event.type === "OutputTargetAccepted" && event.payload.acceptance_id === acceptance.acceptance_id); assert.ok(acceptedEvent);
  assert.equal(acceptedEvent.actor, "user:" + sharing.reviewer);
  assert.ok(actual.findIndex(event => event.eventId === exported.body.appended[0].eventId) < actual.findIndex(event => event.eventId === acceptedEvent.eventId), "actual Scene export ACK precedes separate Film acceptance");
  await preserve("scene-film-joined-receipt.json", encode({
    scope: "Declared synthetic authored Scene, actual component edit/review/export and shared RAM Worker adoption/review/delivery. Native ports; no browser, human review, provider generation, original-corpus recovery, recipient delivery or composed-film claim.",
    identity: { owner: worker.owner, reviewer: sharing.reviewer, documentId, projectId, organizationId: sharing.organizationId, projectAccessId: sharing.projectAccessId },
    scene: { ...expected, originalHash, sourceBlockVersions: q.source.sourceBlockVersions, sequence: chain.map(event => ({ type: event.type, eventId: event.eventId, actor: event.actor })), artifactJsonSha256: savedHash },
    adoptedMarkdown: { bytes: opened.length, sha256: rawSha, text: revisedMarkdown, productionBlobAfterExportAck: true,
      provenanceLimit: "Observed byte identity across the two surfaces; owned-file adoption does not persist an automatic Scene artifact-origin link." },
    film: { sourceFact, sourceDigest: plan.sourceDigest, planRevisionId: plan.revisionId, result, acceptance, acceptanceEventId: acceptedEvent.eventId, storage: retained, write, targets: plan.plan.targets },
    delivery: { status: "partial", composedFilmSupplied: false, bytes: zipBytes.length, sha256: digest(zipBytes), manifest },
    refusals, staleDownload: { status: 409, error: "output_plan_needs_reconfirmation" },
    sourceAfterEdit: { text: revisedSource, digest: changed.sourceRevision, sceneReleaseAllowed: currentDelivery(f).releaseAllowed },
    accountingUnchanged: true, nativeGenerationAdvertised: before.capabilities.nativeGeneration,
    providerRequests: forbiddenFetches, routes: q.routeReceipts, mediaCalls: q.mediaCalls,
  }));
  t.diagnostic("SCENE_FILM_JOIN " + JSON.stringify({ rawMarkdownBytes: opened.length, rawMarkdownSha256: rawSha, sceneJsonSha256: savedHash,
    planRevisionId: plan.revisionId, acceptanceId: acceptance.acceptance_id, delivery: "partial", composedFilmSupplied: false, refusals }));
}

test("edited Scene Markdown joins separately reviewed Film delivery while the composed film remains owed", { timeout: 60_000 }, async t => {
  const q = await createSceneReviewHost(t), { f, h, worker, sharing } = q;
  const artifactId = f.artifactId, originalHash = currentHash(f), owner = h.store.session.get().user.userId;
  assert.equal(q.revision(), 0); assert.equal(currentArtifact(f).kind, "scene");
  assert.notEqual(sharing.reviewer, owner);
  const financialTables = ["document_jobs", "budget_reservations", "cost_budget_reservations", "cost_budget_counters"];
  const finances = () => Object.fromEntries(financialTables.map(table => [table, worker.sqlite.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]));
  const beforeFinances = finances();
  const downloads = installMarkdownFilePort(t, f, q);
  try {
  await openGallery(f); await actions(f);
  click(f, methodButton(f, "#startArtifactEdit"));
  await settle(f, () => nodes(f, "textarea").some(node => node.attributes.rows === "12"));
  const editor = nodes(f, "textarea").find(node => node.attributes.rows === "12");
  assert.ok(view(f) && editor.isConnected); assert.equal(disabled(editor), false);
  editor.value = revisedMarkdown; editor.handlers.input.call(f.host, { target: editor, currentTarget: editor });
  f.draw();
  assert.equal(nodes(f, "textarea").find(node => node.attributes.rows === "12").value, revisedMarkdown);
  click(f, methodButton(f, "#saveArtifactEdit"));
  await settle(f, () => q.revision() === 1 && !nodes(f, "textarea").some(node => node.attributes.rows === "12"), "actual finished-output Save acknowledgment");
  const patches = q.replies.filter(reply => reply.request.url === "/api/artifacts/" + artifactId && reply.request.init.method === "PATCH");
  assert.equal(patches.length, 1); assert.equal(patches[0].status, 200);
  assert.equal(patches[0].request.body.expectedRevision, 0); assert.equal(patches[0].request.body.markdown, revisedMarkdown);
  assert.equal(patches[0].request.body.items.length, 1);
  assert.equal(patches[0].request.body.items[0].body, revisedMarkdown, "actual one-item Scene input handler synchronizes the item with edited Markdown");
  assert.equal(patches[0].request.body.items[0].title, "Harbor watch room");
  assert.equal(patches[0].request.body.items[0].notes, "Preserve the authored harbor setting.");
  const artifact = currentArtifact(f), raw = h.store.content.get()[artifact.contentRef], savedHash = currentHash(f);
  assert.equal(JSON.parse(raw).content_markdown, revisedMarkdown); assert.notEqual(savedHash, originalHash);
  assert.equal(JSON.parse(raw).items[0].body, revisedMarkdown);
  assert.deepEqual(documentArtifactValidationIssues("scene", parseDocumentArtifactContent(raw), { itemCount: 1 }), []);
  assert.equal(currentReview(f).status, "draft");
  assert.equal(currentArtifact(f).mediaUrl, null, "this retained written Scene does not claim generated visual/audio media");
  const retained = worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(artifact.contentRef);
  assert.equal(retained.content, raw, "current Store bytes equal the actual Worker retained content");
  const edits = h.store.events.get().filter(event => event.type === "DocumentArtifactEdited" && event.payload.artifact_id === artifactId);
  assert.equal(edits.length, 1); assert.equal(edits[0].actor, "user:" + owner);
  assert.equal(currentDelivery(f).approved, false); assert.equal(currentDelivery(f).releaseAllowed, false);
  assert.equal(downloads.length, 0);

  await promote(f);
  assert.equal(reviewControl(f, "ArtifactApproved"), undefined, "the author/editor cannot self-approve");
  const assign = reviewControl(f, "ArtifactReviewRequested"); assert.ok(assign); assert.equal(disabled(assign), false);
  click(f, assign);
  await settle(f, () => currentReview(f).status === "in-review", "new exact saved-revision assignment");
  const request = replyFor(q, "ArtifactReviewRequested"); assert.equal(request.status, 200);
  const expected = { artifact_id: artifactId, document_id: worker.documentId, project_id: worker.projectId, artifact_revision: 1, content_sha256: savedHash };
  for (const [key, value] of Object.entries(expected)) assert.equal(request.body.appended[0].payload[key], value);
  assert.equal(request.body.appended[0].payload.assigned_reviewer_user_id, sharing.reviewer);
  assert.equal(currentDelivery(f).releaseAllowed, false);

  await q.switchActor("reviewer");
  await openGallery(f); await promote(f);
  assert.equal(h.store.session.get().user.userId, sharing.reviewer);
  assert.equal(q.revision(), 1); assert.equal(currentHash(f), savedHash);
  assert.equal(currentDelivery(f).action, "review");
  const approve = reviewControl(f, "ArtifactApproved"); assert.ok(approve); assert.equal(disabled(approve), false);
  click(f, approve);
  await settle(f, () => currentDelivery(f).approved, "actual distinct synthetic reviewer decision on saved revision 1");
  const decision = replyFor(q, "ArtifactApproved"); assert.equal(decision.status, 200);
  assert.equal(decision.body.appended[0].actor, "user:" + sharing.reviewer);
  for (const [key, value] of Object.entries(expected)) assert.equal(decision.body.appended[0].payload[key], value);
  assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 1, savedHash), true);
  assert.equal(artifactApprovalMatches(currentArtifact(f), h.store.events.get(), 0, originalHash), false, "approval cannot be applied to the old revision's bytes");
  assert.equal(currentDelivery(f).releaseAllowed, true);

  await promote(f); await actions(f);
  const download = methodButton(f, "#download(artifact)"); assert.equal(disabled(download), false);
  click(f, download);
  await settle(f, () => downloads.length === 1, "actual authorized Markdown Blob reaches native anchor click");
  const exported = replyFor(q, "DocumentArtifactExported"); assert.equal(exported.status, 200);
  for (const [key, value] of Object.entries(expected)) assert.equal(exported.body.appended[0].payload[key], value);
  assert.equal(exported.body.appended[0].payload.format, "markdown");
  assert.equal(exported.body.appended[0].payload.artifact_kind, "scene");
  const bytes = Buffer.from(await downloads[0].blob.arrayBuffer());
  await preserve("scene-film-script.md", bytes);
  const file = process.env.FILM_ACTUAL_DIR ? resolve(process.env.FILM_ACTUAL_DIR, "scene-film-script.md") : null;
  const opened = file ? await readFile(file) : bytes;
  assert.deepEqual(opened, bytes); assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(opened), revisedMarkdown);
  assert.ok(opened.length > 0); assert.equal(currentHash(f), savedHash); assert.equal(q.revision(), 1);
  const actual = await readWorkspaceEvents(worker.env, worker.streamId);
  const chain = actual.filter(event => event.payload.artifact_id === artifactId && ["DocumentArtifactEdited", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].includes(event.type));
  assert.deepEqual(chain.map(event => event.type), ["DocumentArtifactEdited", "ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"]);
  assert.ok(h.requests.filter(request => ["POST", "PATCH", "DELETE"].includes(request.init.method)).every(request => request.url === "/api/artifacts/" + artifactId && request.init.method === "PATCH"
    || ["ArtifactReviewRequested", "ArtifactApproved", "DocumentArtifactExported"].some(type => isType(request, type))), "only the explicit RAM edit/review/export chain writes");
  assert.deepEqual(finances(), beforeFinances);
  for (const row of q.priorRows) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(row.content_id), row, "original Story content remains exact after Scene edit/review/export");
  for (const row of q.priorHistory) assert.deepEqual(worker.sqlite.prepare("SELECT * FROM events WHERE event_id=?").get(row.event_id), row, "original Story history remains exact");
  await joinSceneFileToFilm(t, q, { opened, savedHash, originalHash, expected, chain, exported });
  t.diagnostic("SCENE_FILM_REVIEW_FILE " + JSON.stringify({ artifactId, kind: "scene", revision: 1, savedHash, editor: owner, syntheticReviewer: sharing.reviewer,
    file, bytes: opened.length, fileSha256: hash(opened), sequence: chain.map(event => ({ type: event.type, eventId: event.eventId, actor: event.actor })),
    limit: "Actual component handlers, Store and RAM Worker plus a materialized production Blob. Native-control port only: not a browser download, human independent review, recipient delivery provider-generation, visual/audio media, or screenplay-application claim." }));
  } finally { assert.deepEqual(finances(), beforeFinances); }
});
