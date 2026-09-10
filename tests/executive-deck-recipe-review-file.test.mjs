import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { registerOutputSourceImports, outputTestDatabase } from "./output-server-test-helpers.mjs";
import { readStoredZip } from "./output-asset-fixtures.mjs";

// Current source, local SQLite/D1 and in-memory owned MEDIA only. No provider
// bridge, generated job, renderer host or browser is imported or dispatched.
const hooks = registerOutputSourceImports();
const [{ ensureSchema, makeEvent, appendEvents, readWorkspaceEvents },
  { handleOutputRequirements }, { handleWorkspaces }, { handleSession }, { handleEvents },
  { buildOutcomeRecipeDraft }, { confirmOutputRequirementInterpretation }, { buildPresentationSourceContract, validatePresentationSourceCoverage },
  { createPowerPointDocument, POWERPOINT_DOCUMENT_MIME }, { authoritativeCreativeContext }] = await Promise.all([
  import("../worker/runtime.ts"), import("../worker/output-requirements-api.ts"),
  import("../worker/workspaces-api.ts"), import("../worker/pilot-policy.ts"), import("../worker/events-api.ts"),
  import("../src/model/outcome-recipes.ts"), import("../src/model/output-requirements.ts"), import("../src/model/presentation-source.ts"),
  import("../src/model/office-documents.ts"), import("../worker/context-authority.ts"),
]).finally(() => hooks.deregister());
const fixtureBytes = await readFile(new URL("./fixtures/presentation-executive-source.json", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
assert.equal(fixtureBytes.length, 7267);
assert.equal(digest(fixtureBytes), "fae4a897a4bbafa9374acbad6ff23332668f4eb5da9e25b90eda2e144396d16c");
const executive = JSON.parse(fixtureBytes);
const OWNER = "dev-local-creative", DOC = "executive-recipe-document", PROJECT = "executive-recipe-project";
const API = "/api/output-requirements", STREAM = `creative:${OWNER}`;
const json = body => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const text = value => new TextDecoder().decode(value);
const decodeXml = value => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
const xmlText = bytes => [...text(bytes).matchAll(/<a:t>([\s\S]*?)<\/a:t>/gu)].map(row => decodeXml(row[1]));

// Same actual Workspace/session membership sequence as artifact-review-host76–113.
// Copy this finite API setup instead of importing its unrelated renderer/Scene host.
async function shareWithIndependentReviewer(worker) {
  const reviewer = "executive-independent-reviewer";
  const organization = await worker.request("/api/workspaces", json({ name: "Executive exact review fixture" }));
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
  t.after(async () => { try { await drain(); } finally { state.sqlite.close(); disposed = true; } });
  await ensureSchema(state.env);
  const now = new Date().toISOString();
  state.sqlite.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'creator','pilot-2026-08-10',?,?,?)")
    .run(OWNER, "creative@local.forma", "Local executive author", now, now, now);
  const authored = (type, payload) => makeEvent(STREAM, 0, `user:${OWNER}`, "executive-recipe-test", "authored-source", type, { project_id: PROJECT, document_id: DOC, ...payload });
  await appendEvents(state.env, [
    authored("ProjectCreated", { project_id: PROJECT, name: "Executive recipe" }),
    authored("DocumentCreated", { title: "Authorized executive source", handle: "executive-recipe" }),
    ...executive.snapshot.facts.map((fact, index) => authored("BlockCreated", { ...fact, scope: "document", position: `a${index}`, handle: `${fact.type}/${fact.block_id}` })),
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
    const response = await worker.request(API, json({ documentId: DOC, clientMutationId: `executive-${++serial}`, expectedRevision: current.revision, ...body }));
    assert.equal(response.status, status, await response.clone().text());
    const result = await response.json(); if (expectedError) assert.equal(result.error, expectedError); return result;
  }
  async function upload(bytes, name) {
    const current = await snapshot();
    const response = await worker.request(`${API}/assets?documentId=${DOC}`, { method: "POST", headers: {
      "content-type": POWERPOINT_DOCUMENT_MIME, "x-output-filename": encodeURIComponent(name), "x-output-rights-confirmed": "true",
      "x-output-expected-revision": current.revision, "x-output-client-mutation-id": `executive-upload-${++serial}`,
    }, body: bytes });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  }
  const count = table => state.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const eventCount = type => state.sqlite.prepare("SELECT COUNT(*) AS count FROM events WHERE type=?").get(type).count;
  return { ...state, worker, sharing, snapshot, command, upload, authored, count, eventCount, drain, requests, disposed: () => disposed };
}

function faithfulItems(contract) {
  // Existing presentation-source.test.mjs18–33 authored faithful-slide supplier.
  // No provider result is asserted: source prose is preserved verbatim in body.
  return contract.numberedOutline.map(source => ({ title: source.title, body: source.content,
    notes: "PRIVATE_REVIEW_NOTES_NOT_FOR_AUDIENCE", context_group_ids: source.contextGroupIds,
    slide: { section: source.section, sourceIds: source.sourceBlockId ? [source.sourceBlockId] : [], sourceOrder: source.number,
      visual: { kind: "hero-type", label: "", value: "", data: [] } },
  }));
}
const presentation = { theme: "Authorized executive evidence", palette: { background: "#FFFFFF", foreground: "#111827", accent: "#2563EB", muted: "#667085", surface: "#F4F5F7" }, fontFamily: "Arial" };
function assertEditableFile(bytes, items) {
  const entries = readStoredZip(bytes);
  const slides = [...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
  assert.equal(slides.length, 12); assert.equal((text(entries.get("ppt/presentation.xml")).match(/<p:sldId /gu) ?? []).length, 12);
  assert.equal([...entries.keys()].filter(name => /^ppt\/media\//u.test(name)).length, 0, "editable text, no slide screenshots");
  const all = [];
  for (const [index, item] of items.entries()) {
    const xml = entries.get(`ppt/slides/slide${index + 1}.xml`), texts = xmlText(xml); all.push(...texts);
    assert.ok(texts.includes(item.title), `exact source title ${index + 1}`);
    assert.ok(texts.join("\n").includes(item.body), `complete editable source prose ${index + 1}`);
    assert.match(text(xml), /<p:sp>/u); assert.doesNotMatch(text(xml), /<p:pic>/u);
  }
  for (const [name, bytes] of entries) {
    if (name.endsWith(".xml")) assert.doesNotMatch(text(bytes), /PRIVATE_REVIEW_NOTES_NOT_FOR_AUDIENCE/u);
    if (name.endsWith(".rels")) assert.doesNotMatch(text(bytes), /TargetMode="External"/u);
  }
  return { entries: entries.size, slideCount: slides.length, texts: all };
}

async function preserve(name, bytes) {
  const directory = process.env.FORMA_EXECUTIVE_RECIPE_EVIDENCE_DIR;
  if (!directory) return;
  assert.ok(isAbsolute(directory)); const path = resolve(directory, name);
  await writeFile(path, bytes, { flag: "wx" }); assert.deepEqual(await readFile(path), Buffer.from(bytes));
}

const originalFetch = globalThis.fetch; let forbiddenFetches = 0;
test.before(() => { globalThis.fetch = async () => { forbiddenFetches++; throw new Error("executive_recipe_provider_network_forbidden"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(forbiddenFetches, 0); });

test("authorized executive12 source joins a verified editable reuse file to current independent shared acceptance and full delivery", async t => {
  const state = await fixture(t), before = await state.snapshot();
  const accounting = () => ({
    tokens: state.sqlite.prepare("SELECT * FROM budget_counters ORDER BY scope,scope_id,period").all(),
    money: state.sqlite.prepare("SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period").all(),
  });
  const initialAccounting = accounting();
  for (const row of initialAccounting.tokens) { assert.equal(row.used_tokens, 0); assert.equal(row.reserved_tokens, 0); }
  for (const row of initialAccounting.money) { assert.equal(row.used_microusd, 0); assert.equal(row.reserved_microusd, 0); }
  const source = authoritativeCreativeContext(await readWorkspaceEvents(state.env, STREAM), { documentId: DOC, projectId: PROJECT });
  assert.deepEqual(source.snapshot.facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })),
    executive.snapshot.facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })));
  const contract = buildPresentationSourceContract(source.snapshot, { requestedSlideCount: 12, fidelity: "faithful" });
  assert.equal(contract.authoredSlideCount, 12); assert.equal(contract.slideCountMismatch, false);
  assert.deepEqual(contract.numberedOutline.map(s => s.title), executive.expectedSlideTitles);
  const items = faithfulItems(contract);
  assert.deepEqual(validatePresentationSourceCoverage(items, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }), []);
  const missingScore = structuredClone(items); missingScore[0].body = missingScore[0].body.replace("39.75", "");
  // A real protected fact omission must fail wherever the exact source places it.
  for (const item of missingScore) item.body = item.body.replaceAll("39.75", "");
  assert.ok(validatePresentationSourceCoverage(missingScore, contract, { requireEverySlideSource: true, requireAllProtectedContent: true }).length > 0);
  const pptx = createPowerPointDocument(items, presentation, { title: "Authorized executive deck", includePresenterNotes: false });
  const file = assertEditableFile(pptx, items), sha = digest(pptx);
  const draft = buildOutcomeRecipeDraft({ scope: { projectId: PROJECT, documentId: DOC, authorizationScopeKey: `project:${before.scope.organizationId}:${before.scope.projectAccessId}` },
    expectedRevision: before.revision, sourceRevision: before.sourceRevision, requirementRevision: before.requirementRevision,
    requirementId: "executive-deck-requirement", recipeId: "executive-deck", selectedChoices: ["deck"],
    originalText: "One editable executive presentation, exactly12 slides covering all three authorized source blocks in their authored order.",
    labels: { requirement: "Authorized executive deck", choices: { deck: "Editable executive presentation" }, sourceUnknown: "Choose the exact sources", coverageUnknown: "Confirm complete outline coverage", scriptOwed: "Script not requested", composedFilmOwed: "Film not requested" },
  });
  assert.equal(draft.spec.deliverables.length, 1); assert.equal(draft.spec.deliverables[0].source_scope.kind, "unknown");
  assert.equal(draft.spec.deliverables[0].quantity.kind, "unknown"); assert.equal(draft.spec.deliverables[0].coverage.kind, "unresolved");
  assert.deepEqual(await state.snapshot(), before, "the guide constructs no saved requirement, approval or execution");
  let spec = structuredClone(draft.spec); const deck = spec.deliverables[0];
  Object.assign(deck, { quantity: { kind: "exact", unit: "presentation", value: 1 }, content_quantity: { kind: "exact", unit: "slide", value: 12 },
    source_scope: { kind: "blocks", block_ids: executive.snapshot.facts.map(f => f.block_id) }, coverage: { kind: "document_outline" } });
  for (const key of ["quantity", "content_quantity", "source_scope", "coverage"]) deck.value_origins[key] = { kind: "confirmed", text: "Explicit test-author decision over the exact authorized12-slide source; not inferred by the guide." };
  let saved = await state.command({ action: "save", blockId: spec.id, spec });
  assert.deepEqual(saved.snapshot.requirements[0].spec, spec);
  await state.command({ action: "confirm" }, 409, "output_interpretation_review_required");
  // Explicit author acknowledgement uses the existing editor decision helper;
  // selecting a guide or supplying counts does not silently approve wording.
  spec = confirmOutputRequirementInterpretation(spec);
  saved = await state.command({ action: "save", blockId: spec.id, spec });
  assert.deepEqual(saved.snapshot.requirements[0].spec, spec);
  // The conservative source digest includes every current block, including the
  // newly saved Output requirement. Exact authored source prose stays unchanged.
  assert.notEqual(saved.snapshot.sourceRevision, before.sourceRevision);
  const savedSource = authoritativeCreativeContext(await readWorkspaceEvents(state.env, STREAM), { documentId: DOC, projectId: PROJECT });
  assert.deepEqual(savedSource.snapshot.facts.filter(f => executive.snapshot.facts.some(original => original.block_id === f.block_id))
    .map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })), executive.snapshot.facts.map(f => ({ block_id: f.block_id, type: f.type, text: f.properties.text })));
  const plan = (await state.command({ action: "confirm" })).snapshot.confirmedPlan, target = plan.plan.targets[0];
  assert.equal(plan.sourceDigest, saved.snapshot.sourceRevision);
  assert.equal(plan.plan.targets.length, 1); assert.equal(plan.plan.obligations.length, 1); assert.deepEqual(target.blocking_issues, []);
  assert.deepEqual(target.source_scope, deck.source_scope); assert.deepEqual(target.count_policy, { kind: "exact", unit: "slide", value: 12 });
  assert.equal(target.media_kind, "slides");
  await t.test("foreign assets and wrong-count editable files cannot receive target acceptance", async () => {
    await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId: "foreign-unowned-deck" }, 404);
    const short = await state.upload(createPowerPointDocument(items.slice(0, 11), presentation), "wrong-count.pptx");
    const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId: short.command.assetId });
    const row = bound.snapshot.results.find(r => r.id === bound.command.resultId);
    assert.equal(row.checksStatus, "failed"); assert.ok(row.problems.includes("required_content_quantity_mismatch"));
    state.worker.setHeaders(state.sharing.reviewerHeaders);
    await state.command({ action: "review", resultId: row.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409, "output_mandatory_checks_failed");
    state.worker.setHeaders(state.sharing.ownerHeaders);
    assert.equal(state.eventCount("OutputTargetAccepted"), 0);
  });
  const uploaded = await state.upload(pptx, "authorized-executive-deck.pptx"), assetId = uploaded.command.assetId;
  const asset = uploaded.snapshot.assets.find(a => a.id === assetId);
  assert.equal(asset.sha256, sha); assert.equal(asset.mimeType, POWERPOINT_DOCUMENT_MIME); assert.equal(asset.inspection.facts.slideCount, 12);
  const originalMedia = [...state.media.values()].find(row => digest(row.bytes) === sha); assert.ok(originalMedia);
  const originalDocument = originalMedia.metadata.documentId;
  originalMedia.metadata.documentId = "foreign-document";
  try { await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId }, 409, "output_asset_custody_mismatch"); }
  finally { originalMedia.metadata.documentId = originalDocument; }
  const bound = await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, assetId });
  const result = bound.snapshot.results.find(r => r.id === bound.command.resultId);
  assert.equal(result.checksStatus, "passed"); assert.equal(result.resultRevision, sha); assert.equal(result.sourceDigest, plan.sourceDigest);
  assert.equal(result.review, "pending"); assert.equal(bound.snapshot.summary.delivery_ready, false);
  await t.test("self-approval and absent current file bytes cannot establish independent acceptance", async () => {
    await state.command({ action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 403, "independent_output_reviewer_required");
    await state.command({ action: "export", planRevisionId: plan.revisionId }, 409, "output_assignment_incomplete");
    const stored = [...state.media.values()].find(row => digest(row.bytes) === sha); assert.ok(stored);
    const original = stored.bytes; stored.bytes = new Uint8Array(original); stored.bytes[100] ^= 1;
    try {
      state.worker.setHeaders(state.sharing.reviewerHeaders);
      await state.command({ action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409);
    } finally { stored.bytes = original; state.worker.setHeaders(state.sharing.ownerHeaders); }
    assert.equal(state.eventCount("OutputTargetAccepted"), 0);
  });
  state.worker.setHeaders(state.sharing.reviewerHeaders);
  const reviewView = await state.snapshot(); assert.equal(reviewView.results.find(r => r.id === result.id).reviewAllowed, true);
  const approved = await state.command({ action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true,
    note: "Distinct synthetic eligible reviewer confirms the exact12 authored positions and editable file. No human quality study claimed." });
  const acceptanceId = approved.command.acceptanceId;
  const acceptance = state.sqlite.prepare("SELECT * FROM output_target_acceptances WHERE acceptance_id=?").get(acceptanceId);
  assert.equal(acceptance.reviewer_user_id, state.sharing.reviewer); assert.notEqual(acceptance.reviewer_user_id, OWNER);
  assert.equal(acceptance.result_revision, sha); assert.equal(acceptance.content_sha256, sha);
  assert.equal(acceptance.source_digest, plan.sourceDigest); assert.equal(acceptance.target_id, target.id);
  assert.equal(acceptance.target_contract_digest, plan.targetContractDigests[target.id]);
  assert.equal(state.eventCount("OutputTargetAccepted"), 1); assert.equal(state.eventCount("ArtifactApproved"), 0, "legacy artifact approval is not this target acceptance");
  state.worker.setHeaders(state.sharing.ownerHeaders);
  const ready = await state.snapshot(); assert.equal(ready.summary.delivery_ready, true);
  assert.equal(ready.summary.fulfilled_required_obligations, 1); assert.equal(ready.summary.required_obligations, 1);
  const delivery = await state.command({ action: "export", planRevisionId: plan.revisionId });
  assert.equal(delivery.command.partCount, 1);
  const response = await state.worker.request(delivery.command.downloadUrl);
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get("content-type"), "application/zip");
  const archive = new Uint8Array(await response.arrayBuffer()); assert.equal(response.headers.get("x-output-sha256"), digest(archive));
  const entries = readStoredZip(archive), manifest = JSON.parse(text(entries.get("manifest.json")));
  assert.equal(manifest.deliveryStatus, "complete"); assert.equal(manifest.scopeHistoryComplete, true); assert.deepEqual(manifest.missingWork, []);
  assert.equal(manifest.files.length, 1); assert.equal(entries.size, 3); assert.equal(manifest.targets.length, 1);
  assert.equal(manifest.targets[0].targetId, target.id); assert.equal(manifest.targets[0].acceptanceId, acceptanceId);
  assert.equal(manifest.files[0].id, assetId); assert.equal(manifest.files[0].sha256, sha); assert.equal(manifest.files[0].facts.slideCount, 12);
  assert.deepEqual(entries.get(manifest.files[0].path), pptx);
  assertEditableFile(entries.get(manifest.files[0].path), items);
  await preserve("executive-delivery.zip", archive); await preserve("authorized-executive-deck.pptx", entries.get(manifest.files[0].path));
  await t.test("a new authored source revision retires old review, reuse and delivery", async () => {
    const facts = executive.snapshot.facts, updated = facts[0].properties.text + "\nCurrent revision requires renewed review.";
    await appendEvents(state.env, [state.authored("BlockPropertyEdited", { block_id: facts[0].block_id, property_path: "text", new_value: updated })]);
    const refreshed = await state.worker.request("/api/events?after=0&limit=2000&content=0");
    assert.equal(refreshed.status, 200, await refreshed.clone().text());
    const changed = await state.snapshot(); assert.notEqual(changed.sourceRevision, plan.sourceDigest); assert.equal(changed.summary.delivery_ready, false);
    state.worker.setHeaders(state.sharing.reviewerHeaders);
    await state.command({ action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true }, 409, "output_plan_needs_reconfirmation");
    state.worker.setHeaders(state.sharing.ownerHeaders);
    await state.command({ action: "bind", planRevisionId: plan.revisionId, targetId: target.id, acceptanceId }, 409, "output_plan_needs_reconfirmation");
    await state.command({ action: "export", planRevisionId: plan.revisionId }, 409, "output_plan_needs_reconfirmation");
    const stale = await state.worker.request(delivery.command.downloadUrl); assert.equal(stale.status, 409, await stale.clone().text());
    assert.equal(state.eventCount("OutputTargetAccepted"), 1); assert.equal(state.eventCount("OutputDeliveryPrepared"), 1);
  });
  await state.drain();
  for (const table of ["document_jobs", "output_execution_grants", "budget_reservations", "cost_budget_reservations"]) assert.equal(state.count(table), 0, table);
  assert.deepEqual(accounting(), initialAccounting, "session-created zero-use counter rows remain byte-for-value unchanged through recipe/review/delivery");
  assert.equal(forbiddenFetches, 0); assert.equal(state.eventCount("DocumentRenderCompleted"), 0);
  await preserve("actual-receipt.json", new TextEncoder().encode(JSON.stringify({ scope: "Declared authored executive source and reusable editable output; real local APIs with distinct synthetic reviewer; no provider/human/browser claim", sourceFixtureSha256: digest(fixtureBytes), sourceDigest: plan.sourceDigest, planRevisionId: plan.revisionId, resultId: result.id, resultRevision: sha, acceptanceId, reviewer: state.sharing.reviewer, manifestId: delivery.command.manifestId, pptx: { bytes: pptx.length, sha256: sha, slideCount: file.slideCount, entries: file.entries }, delivery: { bytes: archive.length, sha256: digest(archive), status: manifest.deliveryStatus }, sourceChangeRetiredOldAcceptance: true, requests: state.requests, providerRequests: forbiddenFetches, accounting: initialAccounting, accountingUnchanged: true, backgroundPending: 0 }, null, 2) + "\n"));
});
