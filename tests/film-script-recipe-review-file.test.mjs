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
