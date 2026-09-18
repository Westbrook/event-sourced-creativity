import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
import { png, readStoredZip } from "./output-asset-fixtures.mjs";

// Declared synthetic campaign, real local SQLite/D1 and owned RAM MEDIA.
// Production handlers may import provider definitions; no provider bridge is
// supplied, no provider function is dispatched and all fetches are forbidden.
const hooks = registerOutputSourceImports();
const [{ ensureSchema, makeEvent, appendEvents, readWorkspaceEvents },
  { handleOutputRequirements }, { handleWorkspaces }, { handleSession }, { handleEvents },
  { buildOutcomeRecipeDraft }, { confirmOutputRequirementInterpretation },
  { createPowerPointDocument, POWERPOINT_DOCUMENT_MIME }, { authoritativeCreativeContext }] = await Promise.all([
  import("../worker/runtime.ts"), import("../worker/output-requirements-api.ts"),
  import("../worker/workspaces-api.ts"), import("../worker/pilot-policy.ts"), import("../worker/events-api.ts"),
  import("../src/model/outcome-recipes.ts"), import("../src/model/output-requirements.ts"),
  import("../src/model/office-documents.ts"), import("../worker/context-authority.ts"),
]).finally(() => hooks.deregister());
const digest = value => createHash("sha256").update(value).digest("hex");
// Authored for this software test, not recovered original campaign material.
const facts = [
  { block_id: "campaign-brand", type: "brand", properties: { text: "Cedar repair studio uses a forest-green square mark." } },
  { block_id: "campaign-audience", type: "audience", properties: { text: "Local residents who want to repair an existing chair." } },
  { block_id: "campaign-message", type: "message", properties: { text: "Bring one chair to the repair workshop. Reserve a place before arrival." } },
  { block_id: "campaign-exclusion", type: "exclusion", properties: { text: "Do not claim free service, guaranteed restoration or an invented event date." } },
];
const OWNER = "dev-local-creative", DOC = "campaign-recipe-document", PROJECT = "campaign-recipe-project";
const API = "/api/output-requirements", STREAM = `creative:${OWNER}`;
const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const text = value => new TextDecoder().decode(value);
const decodeXml = value => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
const xmlText = bytes => [...text(bytes).matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map(row => decodeXml(row[1]));

// Same actual Workspace/session membership sequence as artifact-review-host76–113.
// Copy this finite API setup instead of importing its unrelated renderer/Scene host.
async function shareWithIndependentReviewer(worker) {
  const reviewer = "campaign-independent-reviewer";
  const organization = await worker.request("/api/workspaces", json({ name: "Campaign exact review fixture" }));
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

async function fixture(t) {
  const state = outputTestDatabase(), background = [], pendingFailures = [], requests = [];
  let scopedHeaders = {}, serial = 0, disposed = false;
  const execution = { waitUntil(promise) { background.push(Promise.resolve(promise).catch(error => { pendingFailures.push(error); })); } };
  const drain = async () => { while (background.length) await Promise.all(background.splice(0)); assert.deepEqual(pendingFailures, []); };
  t.after(async () => {
    try { await drain(); } finally {
      state.sqlite.close(); disposed = true; state.media.clear();
      await preserve("closure.json", new TextEncoder().encode(JSON.stringify({ databaseClosed: disposed, backgroundPending: background.length, backgroundFailures: pendingFailures.length, mediaObjectsAfterDisposal: state.media.size }) + "\n"));
    }
  });
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(OWNER, "creative@local.forma", "Local campaign author", now, now, now);
  const authored = (type, payload) => makeEvent(STREAM, 0, `user:${OWNER}`, "campaign-recipe-test", "authored-source", type, { project_id: PROJECT, document_id: DOC, ...payload });
  await appendEvents(state.env, [
    authored("ProjectCreated", { project_id: PROJECT, name: "Campaign recipe" }),
    authored("DocumentCreated", { title: "Declared synthetic campaign brief", handle: "campaign-recipe" }),
    ...facts.map((fact, index) => authored("BlockCreated", { ...fact, scope: "document", position: `a${index}`, handle: `${fact.type}/${fact.block_id}` })),
  ]);
  const worker = {
    setHeaders(headers) { scopedHeaders = { ...headers }; },
    async request(route, init = {}) {
      const request = new Request("http://localhost" + route, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...scopedHeaders } });
      requests.push({ path: route, method: request.method, actor: scopedHeaders["oai-authenticated-user-id"] ?? OWNER });
      // Exact selected production-handler branches used by worker/index.ts. No
      // generated-job bridge or arbitrary route may enter this finite local test.
      if (route.split("?")[0] === "/api/session") return handleSession(request, state.env, execution);
      if (route.startsWith("/api/workspaces")) return handleWorkspaces(request, state.env, new URL(request.url).pathname.slice("/api/workspaces".length).split("/").filter(Boolean).map(decodeURIComponent));
      if (route.startsWith("/api/events?")) { assert.equal(request.method, "GET"); return handleEvents(request, state.env); }
      assert.ok(route.startsWith(API));
      return handleOutputRequirements(request, state.env, new URL(request.url).pathname, execution);
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
    const response = await worker.request(API, json({ documentId: DOC, clientMutationId: `campaign-${++serial}`, expectedRevision: current.revision, ...body }));
    assert.equal(response.status, status, await response.clone().text());
    const result = await response.json(); if (expectedError) assert.equal(result.error, expectedError); return result;
  }
  async function upload(bytes, name, mimeType = POWERPOINT_DOCUMENT_MIME) {
    const current = await snapshot();
    const response = await worker.request(`${API}/assets?documentId=${DOC}`, { method: "POST", headers: {
      "content-type": mimeType, "x-output-filename": encodeURIComponent(name), "x-output-rights-confirmed": "true",
      "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `campaign-upload-${++serial}`,
    }, body: bytes });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  }
  const count = table => state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const eventCount = type => state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type=?").get(type).count;
  return { ...state, worker, sharing, snapshot, command, upload, authored, count, eventCount, drain, requests, disposed: () => disposed };
}

const presentation = { theme: "Synthetic Cedar campaign", palette: { background: "#FFFFFF", foreground: "#111827", accent: "#254E37", muted: "#667085", surface: "#F4F5F7" }, fontFamily: "Arial" };
const items = [
  { title: "Cedar repair studio", body: facts[0].properties.text + "\n" + facts[1].properties.text },
  { title: "Bring one chair", body: facts[2].properties.text + "\n" + facts[3].properties.text },
].map(item => ({ ...item, notes: "PRIVATE_CAMPAIGN_REVIEW_NOTES", slide: { visual: { kind: "hero-type", label: "", value: "", data: [] } } }));

function assertEditableFile(bytes) {
  const entries = readStoredZip(bytes), names = [...entries.keys()];
  assert.equal(names.filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).length, 2);
  assert.equal((text(entries.get("ppt/presentation.xml")).match(/<p:sldId /gu) ?? []).length, 2);
  assert.equal(names.filter(name => name.startsWith("ppt/media/")).length, 0);
  for (const [index, item] of items.entries()) {
    const xml = entries.get(`ppt/slides/slide${index + 1}.xml`), texts = xmlText(xml);
    assert.ok(texts.includes(item.title)); assert.ok(texts.join("\n").includes(item.body));
    assert.match(text(xml), /<p:sp>/u); assert.doesNotMatch(text(xml), /<p:pic>/u);
  }
  for (const [name, value] of entries) {
    if (name.endsWith(".xml")) assert.doesNotMatch(text(value), /PRIVATE_CAMPAIGN_REVIEW_NOTES/u);
    if (name.endsWith(".rels")) assert.doesNotMatch(text(value), /TargetMode="External"/u);
  }
  return { entries: entries.size, slides: 2, editableBodies: items.map(item => item.body) };
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

async function unpack(response, status) {
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.equal(response.headers.get("x-output-delivery-completion"), status);
  const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(response.headers.get("x-output-sha256"), digest(bytes));
  const entries = readStoredZip(bytes), manifest = JSON.parse(text(entries.get("manifest.json"))), csv = readCsv(text(entries.get("manifest.csv")));
  assert.equal(manifest.deliveryStatus, status); assert.equal(manifest.scopeHistoryComplete, true);
  assert.equal(manifest.scope.groups.length, 2); assert.equal(manifest.scope.obligations.length, 2); assert.equal(manifest.scope.targets.length, 2);
  assert.equal(manifest.summary.owedTargets, 2); assert.equal(manifest.summary.optionalOffObligations, 0);
  assert.equal(manifest.scope.unresolvedGroups.length, 0);
  assert.equal(entries.size, manifest.files.length + 2);
  assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE_CAMPAIGN_REVIEW_NOTES|campaign-video|campaign-audio/u);
  return { bytes, entries, manifest, csv };
}

async function preserve(name, bytes) {
  const directory = process.env.FORMA_CAMPAIGN_RECIPE_EVIDENCE_DIR;
  if (!directory) return;
  assert.ok(isAbsolute(directory)); const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: "wx" }); assert.deepEqual(await readFile(path), Buffer.from(bytes));
}

const originalFetch = globalThis.fetch; let forbiddenFetches = 0;
test.before(() => { globalThis.fetch = async () => { forbiddenFetches++; throw new Error("campaign_recipe_provider_network_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(forbiddenFetches, 0); });

test("declared two-output campaign joins current independent sibling acceptance to exact partial and full files", async t => {
  const state = await fixture(t), before = await state.snapshot();
  const accounting = () => ({ tokens: state.sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id,period").all(), money: state.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all() });
  const initialAccounting = accounting();
  for (const row of initialAccounting.tokens) { assert.equal(row.used_tokens, 0); assert.equal(row.reserved_tokens, 0); }
  for (const row of initialAccounting.money) { assert.equal(row.used_microusd, 0); assert.equal(row.reserved_microusd, 0); }
  const authority = () => ({
    acceptances: state.sqlite.prepare("SELECT * FROM output_target_acceptances ORDER BY acceptance_id").all(),
    fulfillments: state.sqlite.prepare("SELECT * FROM output_plan_fulfillments ORDER BY target_id").all(),
    deliveries: state.sqlite.prepare("SELECT * FROM output_delivery_manifests ORDER BY manifest_id").all(),
    acceptedEvents: state.eventCount("OutputTargetAccepted"), selectedEvents: state.eventCount("OutputFulfillmentSelected"),
    changedEvents: state.eventCount("OutputTargetChangesRequested"), deliveryEvents: state.eventCount("OutputDeliveryPrepared"),
  });
  const source = () => authoritativeCreativeContext(awaitableEvents, { documentId: DOC, projectId: PROJECT });
  let awaitableEvents = await readWorkspaceEvents(state.env, STREAM);
  assert.deepEqual(source().snapshot.facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })),
    facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })));
  const originalText = "Cedar campaign: one square image and one editable presentation of exactly two slides covering this saved brand, audience, message and exclusions. No other outputs are requested.";
  const draft = buildOutcomeRecipeDraft({ scope: { projectId: PROJECT, documentId: DOC, authorizationScopeKey: `project:${before.scope.organizationId}:${before.scope.projectAccessId}` },
    expectedRevision: before.revision, sourceRevision: before.sourceRevision, requirementRevision: before.requirementRevision,
    requirementId: "campaign-requirement", recipeId: "campaign", selectedChoices: ["campaign-image", "campaign-deck"], originalText,
    labels: { requirement: "Synthetic Cedar campaign", choices: { "campaign-image": "Square Cedar image", "campaign-deck": "Editable Cedar deck" }, sourceUnknown: "Confirm the saved brief", coverageUnknown: "Confirm current campaign coverage", scriptOwed: "Not requested", composedFilmOwed: "Not requested" },
  });
  assert.equal(draft.spec.deliverables.length, 2);
  for (const row of draft.spec.deliverables) { assert.equal(row.quantity.kind, "unknown"); assert.equal(row.source_scope.kind, "unknown"); assert.equal(row.coverage.kind, "unresolved"); }
  assert.deepEqual(await state.snapshot(), before, "recipe suggestions do not save, confirm or accept anything");
  let spec = structuredClone(draft.spec); const [imageSpec, deckSpec] = spec.deliverables;
  const confirmed = { kind: "confirmed", text: "Explicit synthetic test-author decision over the exact four saved campaign blocks." };
  for (const row of spec.deliverables) {
    row.quantity = { kind: "exact", unit: row.media_kind === "image" ? "image" : "presentation", value: 1 };
    row.source_scope = { kind: "blocks", block_ids: facts.map(f => f.block_id) }; row.coverage = { kind: "document_context" };
    for (const key of ["quantity", "source_scope", "coverage"]) row.value_origins[key] = confirmed;
  }
  deckSpec.content_quantity = { kind: "exact", unit: "slide", value: 2 }; deckSpec.value_origins.content_quantity = confirmed;
  imageSpec.format_variants = [{ id: "campaign-square", label: "Square Cedar image", required: true, aspect_ratio: { width: 1, height: 1 },
    quantity: { kind: "exact", unit: "image", value: 1 }, placements: [], original_text: "One square image", value_origins: { aspect_ratio: confirmed, quantity: confirmed, required: confirmed } }];
  imageSpec.value_origins.format_variants = confirmed;
  await state.command({ action: "save", blockId: spec.id, spec });
  await state.command({ action: "confirm" }, 409, "output_interpretation_review_required");
  spec = confirmOutputRequirementInterpretation(spec);
  const saved = await state.command({ action: "save", blockId: spec.id, spec }); assert.deepEqual(saved.snapshot.requirements[0].spec, spec);
  awaitableEvents = await readWorkspaceEvents(state.env, STREAM);
  assert.deepEqual(source().snapshot.facts.filter(f => facts.some(original => original.block_id === f.block_id)).map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })), facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })));
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan;
  assert.equal(plan.sourceDigest, saved.snapshot.sourceRevision);
  assert.equal(plan.plan.targets.length, 2); assert.equal(plan.plan.obligations.length, 2);
  assert.equal((await state.snapshot()).summary.required_obligations, 2);
  const imageTarget = plan.plan.targets.find(row => row.media_kind === "image"), deckTarget = plan.plan.targets.find(row => row.media_kind === "slides");
  for (const target of [imageTarget, deckTarget]) { assert.ok(target); assert.equal(target.required, true); assert.deepEqual(target.blocking_issues, []); assert.deepEqual(target.source_scope, imageSpec.source_scope); }
  assert.deepEqual(imageTarget.aspect_ratio, { width: 1, height: 1 });
  assert.deepEqual(deckTarget.count_policy, { kind: "exact", unit: "slide", value: 2 });

  // Exactly 16×16 opaque forest-green pixels. This is a declared structural
  // fixture, not a generated image or proof of semantic campaign design quality.
  const raw = new Uint8Array((16 * 4 + 1) * 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) raw.set([37, 78, 55, 255], y * 65 + 1 + x * 4);
  const imageBytes = png({ width: 16, height: 16, raw });
  const pptx = createPowerPointDocument(items, presentation, { title: "Synthetic Cedar campaign", includePresenterNotes: false });
  const editable = assertEditableFile(pptx), imageSha = digest(imageBytes), deckSha = digest(pptx);
  const imageUpload = await state.upload(imageBytes, "cedar-square.png", "image/png"), imageAssetId = imageUpload.command.assetId;
  const deckUpload = await state.upload(pptx, "cedar-campaign.pptx"), deckAssetId = deckUpload.command.assetId;
  const assets = (await state.snapshot()).assets, imageAsset = assets.find(row => row.id === imageAssetId), deckAsset = assets.find(row => row.id === deckAssetId);
  assert.equal(imageAsset.mimeType, "image/png"); assert.equal(imageAsset.sha256, imageSha);
  assert.equal(imageAsset.inspection.facts.width, 16); assert.equal(imageAsset.inspection.facts.height, 16);
  assert.equal(deckAsset.sha256, deckSha); assert.equal(deckAsset.inspection.facts.slideCount, 2);
  const imageBound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: imageTarget.id, assetId: imageAssetId });
  const deckBound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: deckTarget.id, assetId: deckAssetId });
  const imageResult = imageBound.snapshot.results.find(row => row.id === imageBound.command.resultId), deckResult = deckBound.snapshot.results.find(row => row.id === deckBound.command.resultId);
  for (const [row, sha, target] of [[imageResult, imageSha, imageTarget], [deckResult, deckSha, deckTarget]]) {
    assert.equal(row.checksStatus, "passed"); assert.equal(row.resultRevision, sha); assert.equal(row.sourceDigest, plan.sourceDigest);
    assert.equal(row.targetContractDigest, plan.targetContractDigests[target.id]); assert.equal(row.review, "pending");
  }
  await t.test("self-review and premature full delivery cannot create acceptance or delivery authority", async () => {
    const stable = authority();
    for (const row of [imageResult, deckResult]) await state.command({ action: "review", resultId: row.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 403, "independent_output_reviewer_required");
    await state.command({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
    assert.deepEqual(authority(), stable);
  });
  async function approve(row, target, sha) {
    state.worker.setHeaders(state.sharing.reviewerHeaders);
    assert.equal((await state.snapshot()).results.find(value => value.id === row.id).reviewAllowed, true);
    const result = await state.command({ action: "review", resultId: row.id, decision: "approve", reviewedCoverage: true, reviewedRights: true,
      note: "Distinct synthetic eligible reviewer accepts only this exact authored-fixture file and source contract; no human quality claim." });
    const accepted = state.sqlite.prepare("SELECT * FROM output_target_acceptances WHERE acceptance_id=?").get(result.command.acceptanceId);
    assert.equal(accepted.reviewer_user_id, state.sharing.reviewer); assert.notEqual(accepted.reviewer_user_id, OWNER);
    assert.equal(accepted.result_revision, sha); assert.equal(accepted.content_sha256, sha); assert.equal(accepted.target_id, target.id);
    assert.equal(accepted.source_digest, plan.sourceDigest); assert.equal(accepted.target_contract_digest, plan.targetContractDigests[target.id]);
    state.worker.setHeaders(state.sharing.ownerHeaders); return accepted;
  }
  const imageAcceptance = await approve(imageResult, imageTarget, imageSha);
  const imageOnly = await state.snapshot(); assert.equal(imageOnly.summary.fulfilled_required_obligations, 1); assert.equal(imageOnly.summary.delivery_ready, false);
  const noPartialByDefault = authority();
  await state.command({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
  assert.deepEqual(authority(), noPartialByDefault);
  const partialDelivery = await state.command({ action: "export", planRevisionId: plan.revisionId, allowPartial: true });
  const partial = await unpack(await state.worker.request(partialDelivery.command.downloadUrl), "partial");
  assert.equal(partial.manifest.files.length, 1); assert.equal(partial.manifest.targets.length, 1);
  assert.deepEqual(partial.manifest.targets[0], { targetId: imageTarget.id, fileId: imageAssetId, acceptanceId: imageAcceptance.acceptance_id });
  assert.equal(partial.manifest.files[0].sha256, imageSha); assert.deepEqual(partial.entries.get(partial.manifest.files[0].path), imageBytes);
  assert.ok(partial.manifest.missingWork.some(row => row.targetId === deckTarget.id && row.label.includes("Editable Cedar deck")));
  assert.ok(partial.csv.some(row => row.record_type === "missing_work" && row.target_id === deckTarget.id && row.label.includes("Editable Cedar deck")));
  assert.deepEqual(partial.csv.filter(row => row.record_type === "file").map(row => row.file_id), [imageAssetId]);

  await t.test("cross-target acceptance reuse and failed format, ratio or count candidates preserve accepted siblings and prepared delivery", async () => {
    const stable = authority();
    await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: deckTarget.id, acceptanceId: imageAcceptance.acceptance_id }, 409, "prior_output_acceptance_not_eligible");
    assert.deepEqual(authority(), stable);
    const short = await state.upload(createPowerPointDocument(items.slice(0, 1), presentation), "wrong-count.pptx");
    const nonsquare = await state.upload(png({ width: 3, height: 2 }), "wrong-ratio.png", "image/png");
    for (const [assetId, target, problem] of [[imageAssetId, deckTarget, "target_media_kind_mismatch"], [short.command.assetId, deckTarget, "required_content_quantity_mismatch"], [nonsquare.command.assetId, imageTarget, "required_aspect_ratio_mismatch"]]) {
      const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId });
      const failed = bound.snapshot.results.find(row => row.id === bound.command.resultId);
      assert.equal(failed.checksStatus, "failed"); assert.ok(failed.problems.includes(problem));
      state.worker.setHeaders(state.sharing.reviewerHeaders);
      await state.command({ action: "review", resultId: failed.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409, "output_mandatory_checks_failed");
      state.worker.setHeaders(state.sharing.ownerHeaders); assert.deepEqual(authority(), stable);
    }
    assert.deepEqual((await unpack(await state.worker.request(partialDelivery.command.downloadUrl), "partial")).manifest, partial.manifest);
  });

  const deckAcceptance = await approve(deckResult, deckTarget, deckSha);
  assert.notEqual(deckAcceptance.acceptance_id, imageAcceptance.acceptance_id); assert.notEqual(deckSha, imageSha);
  const ready = await state.snapshot(); assert.equal(ready.summary.required_obligations, 2); assert.equal(ready.summary.fulfilled_required_obligations, 2); assert.equal(ready.summary.delivery_ready, true);
  const fullDelivery = await state.command({ action: "export", planRevisionId: plan.revisionId }); assert.equal(fullDelivery.command.partCount, 1);
  const full = await unpack(await state.worker.request(fullDelivery.command.downloadUrl), "complete");
  assert.equal(full.manifest.files.length, 2); assert.equal(full.manifest.targets.length, 2); assert.deepEqual(full.manifest.missingWork, []);
  assert.equal(full.csv.filter(row => row.record_type === "missing_work").length, 0);
  assert.equal(full.csv.filter(row => row.record_type === "file").length, 2);
  for (const [target, assetId, accepted, bytes] of [[imageTarget, imageAssetId, imageAcceptance, imageBytes], [deckTarget, deckAssetId, deckAcceptance, pptx]]) {
    const mapping = full.manifest.targets.find(row => row.targetId === target.id), file = full.manifest.files.find(row => row.id === assetId);
    assert.deepEqual(mapping, { targetId: target.id, fileId: assetId, acceptanceId: accepted.acceptance_id });
    assert.equal(file.sha256, digest(bytes)); assert.equal(file.byteLength, bytes.length); assert.deepEqual(full.entries.get(file.path), bytes);
    assert.ok(full.csv.some(row => row.record_type === "file" && row.target_id === target.id && row.acceptance_id === accepted.acceptance_id && row.sha256 === file.sha256));
  }
  assertEditableFile(full.entries.get(full.manifest.files.find(row => row.id === deckAssetId).path));
  const pinnedPartial = await unpack(await state.worker.request(partialDelivery.command.downloadUrl), "partial");
  assert.deepEqual(pinnedPartial.manifest, partial.manifest); assert.deepEqual(pinnedPartial.bytes, partial.bytes);
  await preserve("campaign-partial.zip", partial.bytes); await preserve("campaign-full.zip", full.bytes);
  await preserve("cedar-square.png", imageBytes); await preserve("cedar-campaign.pptx", pptx);

  await t.test("deck-only withdrawal preserves the exact accepted image and its historical partial file", async () => {
    const beforeWithdrawal = authority(); state.worker.setHeaders(state.sharing.reviewerHeaders);
    await state.command({ action: "review", resultId: deckResult.id, decision: "changes_requested", note: "Revise this deck only; the image is unchanged." });
    state.worker.setHeaders(state.sharing.ownerHeaders);
    const withdrawn = authority(); assert.deepEqual(withdrawn.acceptances, beforeWithdrawal.acceptances, "historical acceptance rows are retained");
    assert.deepEqual(withdrawn.deliveries, beforeWithdrawal.deliveries);
    assert.deepEqual(withdrawn.fulfillments, beforeWithdrawal.fulfillments.filter(row => row.target_id === imageTarget.id));
    const row = (await state.snapshot()).results.find(value => value.id === imageResult.id);
    assert.equal(row.acceptanceId, imageAcceptance.acceptance_id); assert.equal(row.sha256, imageSha); assert.equal(row.review, "approved");
    assert.equal((await state.snapshot()).summary.delivery_ready, false);
    const refused = await state.worker.request(fullDelivery.command.downloadUrl); assert.equal(refused.status, 409); assert.equal((await refused.json()).error, "output_delivery_acceptance_changed");
    await state.command({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
    assert.deepEqual(authority(), withdrawn, "refused full delivery adds no new authority");
    const retained = await unpack(await state.worker.request(partialDelivery.command.downloadUrl), "partial");
    assert.deepEqual(retained.manifest, partial.manifest); assert.deepEqual(retained.bytes, partial.bytes);
  });
  await t.test("a real source edit and ordinary shared refresh retire the old image partial as well", async () => {
    const stable = authority();
    await appendEvents(state.env, [state.authored("BlockPropertyEdited", { block_id: facts[0].block_id, property_path: "text", new_value: facts[0].properties.text + " Current brand now requires a blue mark." })]);
    const refreshed = await state.worker.request("/api/events?after=0&limit=2000&content=0"); assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const changed = await state.snapshot(); assert.notEqual(changed.sourceRevision, plan.sourceDigest); assert.equal(changed.summary.delivery_ready, false);
    state.worker.setHeaders(state.sharing.reviewerHeaders);
    await state.command({ action: "review", resultId: imageResult.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409, "output_plan_needs_reconfirmation");
    state.worker.setHeaders(state.sharing.ownerHeaders);
    await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: imageTarget.id, acceptanceId: imageAcceptance.acceptance_id }, 409, "output_plan_needs_reconfirmation");
    await state.command({ action: "export", planRevisionId: plan.revisionId, allowPartial: true }, 409, "output_plan_needs_reconfirmation");
    for (const delivery of [partialDelivery, fullDelivery]) {
      const response = await state.worker.request(delivery.command.downloadUrl); assert.equal(response.status, 409); assert.equal((await response.json()).error, "output_plan_needs_reconfirmation");
    }
    assert.deepEqual(authority(), stable);
  });
  await state.drain();
  for (const table of ["document_jobs", "output_execution_grants", "budget_reservations", "cost_budget_reservations"]) assert.equal(state.count(table), 0, table);
  assert.deepEqual(accounting(), initialAccounting); assert.equal(forbiddenFetches, 0);
  assert.equal(state.eventCount("DocumentRenderCompleted"), 0); assert.equal(state.eventCount("ArtifactApproved"), 0);
  assert.equal(state.eventCount("OutputTargetAccepted"), 2); assert.equal(state.eventCount("OutputDeliveryPrepared"), 2); assert.equal(state.eventCount("OutputTargetChangesRequested"), 1);
  await preserve("actual-receipt.json", new TextEncoder().encode(JSON.stringify({ scope: "Authored synthetic two-output campaign; real local handlers and eligible synthetic shared review. No original-corpus, generated-image, human-quality or browser claim.", sourceFacts: facts, sourceDigest: plan.sourceDigest, planRevisionId: plan.revisionId,
    targets: [imageTarget, deckTarget], acceptances: [imageAcceptance, deckAcceptance], image: { bytes: imageBytes.length, sha256: imageSha, width: 16, height: 16 }, deck: { bytes: pptx.length, sha256: deckSha, ...editable },
    partial: { bytes: partial.bytes.length, sha256: digest(partial.bytes), manifest: partial.manifest }, full: { bytes: full.bytes.length, sha256: digest(full.bytes), manifest: full.manifest },
    deckWithdrawalPreservedImage: true, oldPartialPinnedAfterDeckAcceptanceAndWithdrawal: true, sourceEditRetiredBothDownloads: true, finalAuthority: authority(),
    requests: state.requests, providerRequests: forbiddenFetches, accounting: initialAccounting, accountingUnchanged: true, backgroundPending: 0 }, null, 2) + "\n"));
});
