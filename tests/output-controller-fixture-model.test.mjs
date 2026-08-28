// Adapter/scoped-transport tests only: these do not establish real DOM or server behavior.
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { controllerFixture } from "./output-ui-source-harness.mjs";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createOutputControllerFixture, reconcileOutputFixtureReceipt, OUTPUT_CONTROLLER_SCENARIOS, FIXTURE_DOCUMENT_IDS, FIXTURE_ACTOR, FIXTURE_PROJECT, FIXTURE_PROJECT_ACCESS } from "./output-controller-fixture-model.mjs";

const sourceRoot = resolve(process.env.FORMA_OUTPUT_REGRESSION_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const source = (path) => import(pathToFileURL(resolve(sourceRoot, path)).href);
const [requirements, plan, assets, transport, recovery, messages, planning, readiness, supportReceipts] = await Promise.all([
  source("src/model/output-requirements.ts"), source("src/model/output-plan.ts"), source("src/model/output-asset-inspection.ts"),
  source("src/state/output-requirements-client.ts"), source("src/components/output-controller-recovery.ts"),
  source("src/components/design-system/locales/output-delivery-runtime-messages.ts"),
  source("src/components/output-plan-proposal-state.ts"),
  source("src/components/output-source-readiness.ts"), source("src/components/output-operation-support-receipt.ts"),
]);
const domain = { ...requirements, ...plan, ...assets };
const doc = FIXTURE_DOCUMENT_IDS[0];
const fixture = (onRecord) => createOutputControllerFixture({ domain, onRecord });
let mutation = 0;
function post(adapter, command) {
  return adapter.fetch("/api/output-requirements", { method: "POST", body: JSON.stringify({ documentId: doc,
    expectedRevision: adapter.snapshot(doc).revision, clientMutationId: `fixture-unit-${++mutation}`, ...command }) });
}
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));
function realClient(adapter) {
  return new transport.OutputRequirementsClient({
    captureScope: () => adapter.scope(), scopeActive: (scope) => adapter.scopeActive(scope), fetch: (...args) => adapter.fetch(...args), notify() {},
    isSnapshot: (value, documentId, scope) => value?.documentId === documentId && value.projectId === scope.projectId
      && value.scope?.actorUserId === FIXTURE_ACTOR && typeof value.revision === "string",
  });
}

test("all twenty-five synthetic scenarios use valid real specifications and the real summary reducer", async () => {
  const adapter = await fixture();
  assert.equal(Object.keys(OUTPUT_CONTROLLER_SCENARIOS).length, 25);
  for (const scenario of Object.keys(OUTPUT_CONTROLLER_SCENARIOS)) {
    const snapshot = adapter.seed(doc, scenario);
    assert.equal(snapshot.projectId, FIXTURE_PROJECT);
    assert.equal(requirements.inspectOutputRequirement(snapshot.requirements[0].spec).status, "valid", scenario);
    if (snapshot.summary) assert.equal(typeof snapshot.summary.delivery_ready, "boolean", scenario);
  }
});

test("executive fixture retains authored 5–15, keeps 8 only as a suggestion, and does not preconfirm the plan", async () => {
  const snapshot = (await fixture()).seed(doc, "draft");
  const row = snapshot.requirements[0];
  const deck = row.spec.deliverables.find((entry) => entry.media_kind === "slides");
  assert.deepEqual(deck.content_quantity, { kind: "range", unit: "slide", min: 5, max: 15 });
  assert.equal(row.planSuggestions.suggested_counts[deck.id], 8);
  assert.deepEqual(row.planSuggestions.count_policies, {});
  assert.equal(row.status, "draft");
  assert.equal(snapshot.confirmedPlan, null);
  assert.deepEqual(row.spec.deliverables.map((entry) => entry.media_kind), ["slides", "audio", "video"]);
  assert.equal(row.spec.deliverables[2].series.state, "unresolved");
});

test("completed native fixture supplies a real recovery candidate but not an accepted file", async () => {
  const adapter = await fixture();
  const snapshot = adapter.seed(doc, "native-completed");
  const choices = recovery.outputCompletedNativeChoices(snapshot, adapter.jobs(doc), snapshot.confirmedPlan.plan.targets[0]);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].job.status, "completed");
  assert.equal(snapshot.assets.length, 0);
  assert.equal(snapshot.results.length, 0);
  assert.equal(snapshot.summary.delivery_ready, false);
  const bound = await (await post(adapter, { action: "bind", planRevisionId: snapshot.confirmedPlan.revisionId,
    targetId: snapshot.confirmedPlan.plan.targets[0].id, nativeJobId: choices[0].job.jobId })).json();
  assert.equal(bound.snapshot.results[0].checksStatus, "passed");
  assert.equal(bound.snapshot.results[0].review, "pending");
  assert.equal(bound.snapshot.summary.delivery_ready, false);
});

test("alternative fixture retains failed accounting and has a distinct startable disclosed grant", async () => {
  const adapter = await fixture();
  const snapshot = adapter.seed(doc, "failed-alternative");
  const [failed, alternative] = snapshot.grants;
  assert.notEqual(failed.id, alternative.id);
  assert.equal(failed.usedMicrousd, 50_000);
  assert.equal(failed.operations[0].status, "failed");
  assert.equal(recovery.outputOperationRecovery(failed.operations[0], adapter.jobs(doc)[0], doc).canPrepareAlternative, true);
  assert.equal(alternative.status, "authorized");
  assert.equal(alternative.actorUserId, snapshot.scope.actorUserId);
  assert.equal(messages.outputDeliveryMessageDescriptor(alternative.disclosure.targets[0].reasonCode).known, true);
  assert.equal(messages.outputDeliveryMessageDescriptor(alternative.disclosure.targets[0].transferCode).known, true);
  assert.equal((await post(adapter, { action: "run", grantId: alternative.id })).status, 200);
  assert.deepEqual(adapter.snapshot(doc).grants[0], failed, "running alternative must not rewrite prior failed history");
  assert.equal(adapter.snapshot(doc).grants[1].operations[0].status, "queued");
});

test("accepted PNG has inspected bytes, exact SHA, and a correctly named exact-file download", async () => {
  const adapter = await fixture();
  const snapshot = adapter.seed(doc, "accepted-file");
  const row = snapshot.assets[0];
  const download = await adapter.fetch(row.downloadUrl);
  const bytes = new Uint8Array(await download.arrayBuffer());
  const inspected = await assets.inspectOutputAsset(bytes, row.name);
  assert.equal(inspected.status, "inspected");
  assert.equal(inspected.sha256, row.sha256);
  assert.equal(bytes.byteLength, row.byteLength);
  assert.deepEqual(inspected.facts, { width: 1, height: 1 });
  assert.match(download.headers.get("content-disposition"), /SYNTHETIC-fixture-pixel\.png/);
  assert.match(download.headers.get("content-disposition"), /^attachment; filename="output\.png"; filename\*=UTF-8''/);
  assert.equal(transport.outputDownloadFilename(download.headers.get("content-disposition")), row.name, "the real client keeps the server's UTF-8 filename rather than its generic fallback");
  assert.equal(snapshot.summary.delivery_ready, true, "fictional approval scenario only, not a real review");
});

test("optional unresolved work stays separate from required completion; selecting it blocks delivery", async () => {
  const adapter = await fixture();
  const off = adapter.seed(doc, "optional-off");
  const selected = adapter.seed(doc, "optional-selected");
  assert.equal(off.summary.required_groups, 1);
  assert.equal(off.summary.selected_optional_obligations, 0);
  assert.equal(off.summary.delivery_ready, true);
  assert.equal(selected.summary.required_groups, 1);
  assert.equal(selected.summary.selected_optional_obligations, 1);
  assert.equal(selected.summary.unresolved_selected_optional_groups, 1);
  assert.equal(selected.summary.delivery_ready, false);
  assert.ok(selected.confirmedPlan.plan.unresolved_groups[0].issues.length);
});

test("source changes and unloaded rows cannot inherit accepted-file readiness", async () => {
  const adapter = await fixture();
  for (const scenario of ["source-stale", "partial"]) {
    const snapshot = adapter.seed(doc, scenario);
    assert.equal(snapshot.summary.completion, "unknown", scenario);
    assert.equal(snapshot.summary.delivery_ready, false, scenario);
    assert.equal(snapshot.summary.required_groups, 1, scenario);
  }
});

test("fixture response-body delay exercises the actual scoped client's late-JSON guard", async () => {
  const adapter = await fixture();
  const client = realClient(adapter);
  await client.ensure(doc);
  adapter.armHold("read", "body");
  const old = client.ensure(doc, { force: true });
  await nextTurn();
  assert.equal(adapter.heldAction, "read");
  adapter.bumpRevision(doc);
  await client.ensure(doc, { force: true });
  assert.equal(client.resource(doc).snapshot.revision, "2");
  adapter.release(); await old;
  assert.equal(client.resource(doc).snapshot.revision, "2", "late old JSON cannot replace the newer request's snapshot");
});

test("late fixture JSON cannot enter a new authorization scope", async () => {
  const adapter = await fixture();
  const client = realClient(adapter);
  adapter.armHold("read", "body");
  const old = client.ensure(doc);
  await nextTurn();
  adapter.changeScope(); client.clear();
  const next = await client.ensure(FIXTURE_DOCUMENT_IDS[1]);
  assert.equal(next.snapshot.documentId, FIXTURE_DOCUMENT_IDS[1]);
  adapter.release(); await old;
  assert.equal(client.resource(doc).snapshot, null);
});

test("fixture conflict returns only a code and later GET exposes the newer revision", async () => {
  const adapter = await fixture();
  const row = adapter.snapshot(doc).requirements[0];
  adapter.conflictNextWrite();
  const response = await post(adapter, { action: "save", blockId: row.blockId, spec: row.spec });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).snapshot, undefined);
  assert.equal((await (await adapter.fetch(`/api/output-requirements?documentId=${doc}`)).json()).revision, "2");
});

test("the visible next-write conflict probe also covers binary uploads without adopting a file", async () => {
  const adapter = await fixture();
  const file = adapter.sampleFile();
  const upload = () => adapter.fetch(`/api/output-requirements/assets?documentId=${doc}`, { method: "POST", body: file, headers: {
    "x-output-rights-confirmed": "true", "x-output-expected-revision": adapter.snapshot(doc).revision,
    "x-output-filename": encodeURIComponent(file.name),
  } });
  adapter.conflictNextWrite();
  const conflict = await upload();
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: "output_revision_conflict" });
  assert.equal(adapter.snapshot(doc).revision, "2");
  assert.equal(adapter.snapshot(doc).assets.length, 0);
  assert.equal((await upload()).status, 200, "an explicit later request uses the refreshed revision");
  assert.equal(adapter.snapshot(doc).assets.length, 1);
  assert.equal(adapter.snapshot(doc).results.length, 0, "upload does not match or accept a target");
});

test("preflight, authorization, and run are harmless fixture intents and never invoke global fetch", async () => {
  const entries = [];
  const adapter = await fixture((entry) => entries.push(entry));
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("global fetch must not be used by the fixture"); };
  try {
    const snapshot = adapter.snapshot(doc);
    const prepared = await (await post(adapter, { action: "preflight", planRevisionId: snapshot.confirmedPlan.revisionId,
      targetIds: [snapshot.confirmedPlan.plan.targets[0].id] })).json();
    const preflight = prepared.command.preflight;
    const authorize = { action: "authorize", preflightId: preflight.id, termsDigest: preflight.termsDigest,
      maximumMicrousd: preflight.maximumMicrousd, explicitAuthorization: true, clientMutationId: "one-fixture-authorization" };
    const accepted = await (await post(adapter, authorize)).json();
    const replayed = await (await post(adapter, authorize)).json();
    assert.equal(replayed.replayed, true);
    assert.equal(adapter.snapshot(doc).grants.length, 1);
    assert.equal((await post(adapter, { action: "run", grantId: accepted.command.grantId })).status, 200);
    assert.equal(adapter.snapshot(doc).targetStates[0].execution, "queued");
    assert.equal(adapter.snapshot(doc).summary.delivery_ready, false);
    assert.equal((await adapter.fetch("https://provider.example/real-call")).status, 403);
    assert.equal((await adapter.fetch("/api/session")).status, 403);
    assert.equal(entries.filter((entry) => entry.type === "fixture-commit" && entry.detail.action === "authorize").length, 1);
  } finally { globalThis.fetch = original; }
});

test("fixture delivery button produces a visibly named diagnostic JSON, never a fake media package", async () => {
  const adapter = await fixture();
  const snapshot = adapter.seed(doc, "accepted-file");
  const exported = await (await post(adapter, { action: "export", planRevisionId: snapshot.confirmedPlan.revisionId })).json();
  const download = await adapter.fetch(exported.command.downloadUrl);
  assert.equal((await download.json()).synthetic, true);
  assert.match(download.headers.get("content-disposition"), /SYNTHETIC-output-fixture-diagnostic\.json/);
  assert.match(download.headers.get("content-type"), /application\/json/);
});


const planScope = (adapter) => `${adapter.scope().key}\u0000${doc}`;
const deckOf = (snapshot) => snapshot.requirements[0].spec.deliverables.find((entry) => entry.media_kind === "slides");
const compileSnapshot = (snapshot, options) => plan.compileOutputPlan(snapshot.requirements.map((row) => row.spec), {
  document_id: snapshot.documentId, source_revision: snapshot.sourceRevision, requirement_revision: snapshot.requirementRevision, ...options,
});
async function collaboratorWrite(adapter, client, kind) {
  const resource = await client.ensure(doc, { force: true });
  return client.command(doc, { ...adapter.prepareCollaboratorSave(doc, kind), expectedRevision: resource.snapshot.revision,
    clientMutationId: `fixture-collaborator-${++mutation}` }, "save synthetic collaborator proposal");
}

test("saved planning scenario is valid, unconfirmed, and preserves flexible 5–15 separately from aim eight", async () => {
  const snapshot = (await fixture()).seed(doc, "planning-saved");
  const deck = deckOf(snapshot);
  const options = planning.outputSavedPlanningOptions(snapshot);
  assert.equal(snapshot.requirements[0].status, "valid");
  assert.equal(requirements.outputRequirementInterpretationNeedsReview(snapshot.requirements[0].spec), false);
  assert.equal(snapshot.confirmedPlan, null);
  assert.deepEqual(deck.content_quantity, { kind: "range", unit: "slide", min: 5, max: 15 });
  assert.deepEqual(planning.resolveOutputPlanningCountPolicy(options, deck.id, deck.id, "slide").policy, { kind: "flexible", unit: "slide", min: 5, max: 15, aim: 8 });
  assert.equal(options.suggested_counts[deck.id], 8);
});

test("two actual scoped clients retain independent caches when B saves a same-ID qualified exact eleven", async () => {
  const records = [];
  const adapter = await fixture((entry) => records.push(entry));
  const original = adapter.seed(doc, "planning-saved");
  const a = realClient(adapter), b = realClient(adapter);
  await Promise.all([a.ensure(doc), b.ensure(doc)]);
  const beforeA = a.resource(doc).snapshot;
  const aState = planning.observeOutputPlanProposal(null, beforeA, planScope(adapter));
  const written = await collaboratorWrite(adapter, b, "exact11");
  assert.equal(written.status, "saved");
  const latestB = b.resource(doc).snapshot;
  const deck = deckOf(latestB);
  assert.equal(latestB.requirements[0].blockId, original.requirements[0].blockId);
  assert.deepEqual(latestB.requirements[0].spec.deliverables.map((group) => group.id), original.requirements[0].spec.deliverables.map((group) => group.id));
  assert.equal(a.resource(doc).snapshot.revision, beforeA.revision, "B cannot publish directly into A's cache");
  assert.notEqual(latestB.revision, beforeA.revision);
  assert.deepEqual(latestB.requirements[0].planSuggestions.count_policies[`${deck.id}:slide`], { kind: "exact", unit: "slide", value: 11 });
  assert.equal(latestB.requirements[0].planSuggestions.suggested_counts[deck.id], 8);
  await a.ensure(doc, { force: true });
  const clean = planning.observeOutputPlanProposal(aState, a.resource(doc).snapshot, planScope(adapter));
  assert.equal(planning.outputPlanCountField(clean.draft.options, deck.id, deck.id, deck.content_quantity).exact, "11");
  const target = compileSnapshot(a.resource(doc).snapshot, clean.draft.options).targets.find((row) => row.media_kind === "slides");
  assert.equal(target.count_policy.value, 11); assert.equal(target.suggested_count, 8);
  assert.equal(adapter.snapshot(doc).confirmedPlan, null, "saving never confirms or generates");
  assert.equal(records.filter((entry) => entry.type === "fixture-request" && ["authorize", "run", "preflight"].includes(entry.detail.action)).length, 0);
});

test("A's stale confirmation gets 409, then a refreshed dirty proposal needs explicit compare/ack/stage", async () => {
  const adapter = await fixture(); adapter.seed(doc, "planning-saved");
  const a = realClient(adapter), b = realClient(adapter);
  await a.ensure(doc);
  const initial = a.resource(doc).snapshot, deck = deckOf(initial);
  let state = planning.observeOutputPlanProposal(null, initial, planScope(adapter));
  state = planning.editOutputPlanCountField(state, deck.id, deck.content_quantity, { kind: "exact", exact: "12", min: "5", max: "15", aim: "8" });
  const captured = planning.captureOutputPlanConfirmation(state, initial, planScope(adapter));
  await collaboratorWrite(adapter, b, "exact11");
  const stale = await a.command(doc, { action: "confirm", expectedRevision: captured.expectedRevision, clientMutationId: `fixture-stale-${++mutation}`, options: captured.options }, "confirm synthetic stale choices");
  assert.equal(stale.status, "conflict");
  assert.equal(adapter.snapshot(doc).confirmedPlan, null);
  await a.ensure(doc, { force: true });
  state = planning.observeOutputPlanProposal(state, a.resource(doc).snapshot, planScope(adapter));
  assert.equal(planning.outputPlanProposalConflicts(state), true);
  assert.equal(state.draft.options.count_policies[`${deck.id}:slide`].value, 12);
  assert.equal(state.latest.options.count_policies[`${deck.id}:slide`].value, 11);
  assert.equal(planning.captureOutputPlanConfirmation(state, a.resource(doc).snapshot, planScope(adapter)), null);
  state = planning.reapplyOutputPlanProposal(planning.acknowledgeOutputPlanProposal(state, true));
  const reviewed = planning.captureOutputPlanConfirmation(state, a.resource(doc).snapshot, planScope(adapter));
  const confirmed = await a.command(doc, { action: "confirm", expectedRevision: reviewed.expectedRevision, clientMutationId: `fixture-reviewed-${++mutation}`, options: reviewed.options }, "confirm synthetic reviewed choices");
  assert.equal(confirmed.status, "saved");
  assert.equal(a.resource(doc).snapshot.confirmedPlan.plan.targets.find((row) => row.media_kind === "slides").count_policy.value, 12);
  assert.equal(a.resource(doc).snapshot.grants.length, 0);
});

test("collaborator source and structure publications preserve identities and invalidate the exact acknowledgment", async () => {
  const adapter = await fixture(); const initial = adapter.seed(doc, "planning-saved");
  const a = realClient(adapter), b = realClient(adapter); await a.ensure(doc);
  const deck = deckOf(initial);
  let state = planning.editOutputPlanCountField(planning.observeOutputPlanProposal(null, initial, planScope(adapter)), deck.id, deck.content_quantity,
    { kind: "exact", exact: "13", min: "5", max: "15", aim: "8" });
  await collaboratorWrite(adapter, b, "exact11"); await a.ensure(doc, { force: true });
  state = planning.acknowledgeOutputPlanProposal(planning.observeOutputPlanProposal(state, a.resource(doc).snapshot, planScope(adapter)), true);
  assert.equal(planning.outputPlanProposalCanReapply(state), true);
  const source = adapter.publishSourceRevision(doc);
  assert.deepEqual(source.requirements[0].spec, b.resource(doc).snapshot.requirements[0].spec, "source change does not rewrite requirement structure");
  await a.ensure(doc, { force: true });
  state = planning.observeOutputPlanProposal(state, a.resource(doc).snapshot, planScope(adapter));
  assert.equal(planning.outputPlanProposalCanReapply(state), false);
  await collaboratorWrite(adapter, b, "structure"); await a.ensure(doc, { force: true });
  const latest = a.resource(doc).snapshot;
  assert.deepEqual(latest.requirements[0].spec.deliverables.map((group) => group.id), initial.requirements[0].spec.deliverables.map((group) => group.id));
  assert.equal(deckOf(latest).content_quantity.max, 12);
  assert.equal(deckOf(latest).coverage.kind, "topics");
  assert.equal(requirements.outputRequirementInterpretationNeedsReview(latest.requirements[0].spec), false, "fictional B explicitly retained the displayed structure");
  state = planning.observeOutputPlanProposal(state, latest, planScope(adapter));
  assert.equal(state.draft.countFields[`${deck.id}:slide`].field.exact, "13");
  state = planning.reapplyOutputPlanProposal(planning.acknowledgeOutputPlanProposal(state, true));
  assert.equal(planning.outputPlanProposalHasInvalidFields(state), true, "retained 13 does not fit the newer maximum of 12");
  assert.equal(adapter.snapshot(doc).grants.length, 0);
});

test("eligible review-only fixture uses current checked bytes and can review without authoring or starting work", async () => {
  const adapter = await fixture(); const snapshot = adapter.seed(doc, "review-only-eligible");
  const result = snapshot.results[0], asset = snapshot.assets[0], target = snapshot.confirmedPlan.plan.targets[0];
  assert.deepEqual(snapshot.permissions, { canAuthor: false, canRequest: false, canReview: true, canDownload: true, independentReview: true });
  assert.equal(result.reviewAllowed, true); assert.equal(result.independentReviewBlocked, false);
  assert.equal(result.resultRevision, asset.sha256); assert.equal(result.sha256, asset.sha256);
  assert.equal(result.sourceDigest, snapshot.sourceRevision);
  assert.equal(result.targetContractDigest, snapshot.confirmedPlan.targetContractDigests[target.id]);
  assert.notEqual(result.createdByUserId, FIXTURE_ACTOR); assert.notEqual(asset.createdByUserId, FIXTURE_ACTOR);
  assert.equal(snapshot.requirementFileCounts[snapshot.requirements[0].blockId], 0, "pending files are not accepted current files");
  for (const action of ["save", "confirm", "bind", "remove", "preflight", "authorize", "run"]) assert.equal((await post(adapter, { action })).status, 403, action);
  assert.equal((await post(adapter, { action: "review", resultId: result.id, decision: "approve", reviewedCoverage: true, reviewedRights: true })).status, 200);
  const reviewed = adapter.snapshot(doc);
  assert.equal(reviewed.results[0].review, "approved"); assert.equal(reviewed.summary.delivery_ready, true);
  assert.equal(reviewed.requirementFileCounts[snapshot.requirements[0].blockId], 1);
  assert.equal(reviewed.grants.length, 0);
});

test("origin contributor is blocked before either review decision despite a different uploader and binder", async () => {
  const adapter = await fixture(); const snapshot = adapter.seed(doc, "review-only-contributor");
  const result = snapshot.results[0], asset = snapshot.assets[0];
  assert.equal(snapshot.permissions.canReview, true);
  assert.notEqual(result.createdByUserId, FIXTURE_ACTOR); assert.notEqual(asset.createdByUserId, FIXTURE_ACTOR);
  assert.equal(result.checksStatus, "passed"); assert.equal(result.reviewAllowed, false); assert.equal(result.independentReviewBlocked, true);
  assert.equal(result.resultRevision, asset.sha256);
  assert.equal(JSON.stringify(snapshot).includes("fixture-other-origin-author"), false, "custody contributor IDs stay outside the DTO");
  for (const decision of ["approve", "changes_requested"]) {
    const response = await post(adapter, { action: "review", resultId: result.id, decision, reviewedCoverage: true, reviewedRights: true });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "independent_output_reviewer_required");
  }
  assert.equal(adapter.snapshot(doc).results[0].review, "pending");
  assert.equal(adapter.snapshot(doc).results[0].acceptanceId, null);
});

test("fixture sample file and Unicode exact download preserve real fallback and RFC5987 decoding", async () => {
  const adapter = await fixture();
  const file = adapter.sampleFile();
  const checked = await assets.inspectOutputAsset(new Uint8Array(await file.arrayBuffer()), file.name);
  assert.equal(checked.status, "inspected"); assert.deepEqual(checked.facts, { width: 1, height: 1 });
  const name = "SYNTHETIC-épreuve-日本語.png";
  const response = await adapter.fetch(`/api/output-requirements/assets?documentId=${doc}`, { method: "POST", body: file, headers: {
    "x-output-rights-confirmed": "true", "x-output-expected-revision": adapter.snapshot(doc).revision,
    "x-output-filename": encodeURIComponent(name),
  } });
  assert.equal(response.status, 200);
  const asset = (await response.json()).snapshot.assets[0];
  const download = await adapter.fetch(asset.downloadUrl);
  const header = download.headers.get("content-disposition");
  assert.match(header, /^attachment; filename="output\.png"; filename\*=UTF-8''/);
  assert.equal(transport.outputDownloadFilename(header), asset.name);
  assert.equal(header.includes(encodeURIComponent(name)), true);
});

test("synthetic collaborator controls preserve page CSP, pre-import fetch denial, and real scoped clients", () => {
  const html = readFileSync(new URL("./output-controller.fixture.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("./output-controller.fixture.mjs", import.meta.url), "utf8");
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /window\.fetch = async/);
  assert.ok(html.indexOf("window.fetch = async") < html.indexOf('src="/tests/output-controller.fixture.mjs"'));
  assert.match(html, /id="fixture-collaborator-controls"/);
  for (const id of ["fixture-publish-exact11", "fixture-publish-source", "fixture-publish-structure", "fixture-inspect-planning"]) assert.ok(html.includes(`id="${id}"`));
  assert.equal((script.match(/new OutputRequirementsClient\(/g) ?? []).length, 2);
  assert.match(script, /collaboratorClient\.command\(documentId,/);
  assert.match(script, /resolveOutputPlanningCountPolicy/);
  assert.equal(/window\.open|localStorage|sessionStorage|BroadcastChannel/.test(script), false, "fixture must not open a user tab or share state with another account context");
});


test("only the explicitly labeled legacy DTO case omits review eligibility; normal binds always expose booleans", async () => {
  const adapter = await fixture();
  for (const scenario of Object.keys(OUTPUT_CONTROLLER_SCENARIOS)) {
    const snapshot = adapter.seed(doc, scenario);
    for (const result of snapshot.results) {
      if (scenario === "review-only-unknown") {
        assert.equal(result.reviewAllowed, undefined); assert.equal(result.independentReviewBlocked, undefined);
      } else {
        assert.equal(typeof result.reviewAllowed, "boolean", scenario); assert.equal(typeof result.independentReviewBlocked, "boolean", scenario);
      }
    }
  }
  const seeded = adapter.seed(doc, "native-completed");
  const target = seeded.confirmedPlan.plan.targets[0];
  const job = adapter.jobs(doc)[0];
  const result = (await (await post(adapter, { action: "bind", planRevisionId: seeded.confirmedPlan.revisionId, targetId: target.id, nativeJobId: job.jobId })).json()).snapshot.results[0];
  assert.equal(result.reviewAllowed, true); assert.equal(result.independentReviewBlocked, false);
  const legacy = adapter.seed(doc, "review-only-unknown");
  const exposed = await (await adapter.fetch(`/api/output-requirements?documentId=${doc}`)).json();
  assert.equal(exposed.results[0].reviewAllowed, undefined);
  assert.equal(legacy.permissions.canReview, true, "unknown eligibility is not the same as a missing review capability");
});


test("normal fixture snapshots carry explicit source proof and numeric capacity; only the named legacy case omits it", async () => {
  const adapter = await fixture();
  for (const scenario of Object.keys(OUTPUT_CONTROLLER_SCENARIOS)) {
    const snapshot = adapter.seed(doc, scenario);
    if (scenario === "source-unknown") {
      assert.equal(snapshot.sourceVerification, undefined);
      assert.equal(readiness.outputSourceReadiness(snapshot).reason, "source_unknown");
      continue;
    }
    assert.ok(["verified", "unavailable"].includes(snapshot.sourceVerification.status), scenario);
    assert.equal(typeof snapshot.sourceVerification.capacity.countsComplete, "boolean", scenario);
    assert.equal(snapshot.sourceVerification.capacity.nativeLimit, 1, scenario);
    assert.equal(snapshot.sourceVerification.capacity.ownedReadLimit, 4, scenario);
    assert.ok(Array.isArray(snapshot.sourceVerification.capacity.sources), scenario);
  }
  const normal = adapter.seed(doc, "ready");
  assert.equal(readiness.outputNativeReadiness(normal).allowed, true);
  const atLimit = structuredClone(normal);
  Object.assign(atLimit.sourceVerification.capacity, { referenceCount: 1, distinctObjectCount: 1,
    sources: [{ blockId: "fixture-one-import", label: "SYNTHETIC one imported source" }] });
  assert.equal(readiness.outputNativeReadiness(atLimit).allowed, true, "a verified count equal to the supplied native limit fits");
  for (const nativeLimit of [undefined, null, -1, NaN, "1"]) {
    const malformed = structuredClone(atLimit); malformed.sourceVerification.capacity.nativeLimit = nativeLimit;
    assert.equal(readiness.outputNativeReadiness(malformed).reason, "capacity_unknown", "malformed route metadata remains unknown, not a fallback limit");
  }
  const incomplete = structuredClone(atLimit); incomplete.sourceVerification.capacity.countsComplete = false;
  assert.equal(readiness.outputNativeReadiness(incomplete).reason, "capacity_unknown");
});

test("same-digest capacity failure blocks consequential work while preserving authoring, free confirmation, and Stop", async () => {
  const adapter = await fixture(); const snapshot = adapter.seed(doc, "source-unverified");
  assert.equal(snapshot.confirmedPlan.sourceDigest, snapshot.sourceRevision);
  assert.equal(snapshot.confirmedPlan.requirementsDigest, snapshot.requirementRevision);
  assert.equal(snapshot.sourceVerification.capacity.distinctObjectCount, 5);
  assert.equal(snapshot.sourceVerification.capacity.ownedReadLimit, 4);
  assert.equal(snapshot.sourceVerification.capacity.sources.length, 5);
  assert.equal(snapshot.summary.scope_known, false);
  assert.equal(snapshot.results[0].reviewAllowed, false);
  assert.equal(snapshot.results[0].independentReviewBlocked, false, "source failure must not accuse the actor of contributing");
  assert.equal(readiness.outputSourceReadiness(snapshot).allowed, false);
  assert.equal(readiness.outputNativeReadiness(snapshot).allowed, false);
  for (const action of ["preflight", "authorize", "run", "bind", "review", "export"]) {
    const response = await post(adapter, { action });
    assert.equal(response.status, 409, action);
    assert.equal((await response.json()).error, "context_source_evidence_capacity_exceeded", action);
  }
  const download = await adapter.fetch(snapshot.assets[0].downloadUrl);
  assert.equal(download.status, 409);
  assert.equal((await download.json()).error, "context_source_evidence_capacity_exceeded");
  const job = adapter.jobs(doc)[0], operation = snapshot.grants[0].operations[0];
  assert.equal(recovery.outputOperationRecovery(operation, job, doc).canStop, true);
  assert.equal(adapter.stopJob(job.jobId), true);
  const row = adapter.snapshot(doc).requirements[0];
  assert.equal((await post(adapter, { action: "save", blockId: row.blockId, spec: row.spec, planSuggestions: row.planSuggestions })).status, 200);
  assert.equal((await post(adapter, { action: "confirm", options: snapshot.confirmedPlan.confirmationOptions })).status, 200);
  assert.equal(adapter.snapshot(doc).sourceVerification.status, "unavailable");
  assert.equal(adapter.snapshot(doc).summary.delivery_ready, false);
  const checkedAgain = adapter.setSourceVerification(doc, true);
  assert.equal(checkedAgain.sourceVerification.status, "unavailable", "rechecking does not cure the five-object capacity problem");
  assert.deepEqual(checkedAgain.sourceVerification.capacity, snapshot.sourceVerification.capacity, "no source or limit changes are hidden in refresh");
});

test("owned/read verification does not claim that the stricter native route fits", async () => {
  const adapter = await fixture(); const snapshot = adapter.seed(doc, "source-native-capacity");
  assert.equal(snapshot.sourceVerification.status, "verified");
  assert.equal(snapshot.sourceVerification.capacity.referenceCount, 2);
  assert.equal(snapshot.sourceVerification.capacity.distinctObjectCount, 2);
  assert.equal(snapshot.sourceVerification.capacity.ownedReadLimit, 4);
  assert.equal(snapshot.sourceVerification.capacity.nativeLimit, 1);
  assert.deepEqual(snapshot.sourceVerification.capacity.sources.map((source) => source.label), ["SYNTHETIC imported source 1", "SYNTHETIC imported source 2"]);
  assert.equal(new Set(snapshot.sourceVerification.capacity.sources.map((source) => source.blockId)).size, 2);
  assert.equal(snapshot.sourceVerification.capacity.countsComplete, true);
  assert.equal(snapshot.sourceVerification.capacity.sourcesComplete, true);
  assert.match(OUTPUT_CONTROLLER_SCENARIOS["source-native-capacity"], /two imported files exceed native limit one/);
  assert.equal(readiness.outputDeliveryReadiness(snapshot).allowed, true);
  assert.equal(readiness.outputNativeReadiness(snapshot).reason, "native_capacity");
  assert.deepEqual(readiness.outputNativeReadiness(snapshot).values, { count: 2, limit: 1 });
  assert.equal((await adapter.fetch(snapshot.assets[0].downloadUrl)).status, 200);
  const response = await post(adapter, { action: "preflight", planRevisionId: snapshot.confirmedPlan.revisionId, targetIds: [snapshot.confirmedPlan.plan.targets[0].id] });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "context_source_evidence_capacity_exceeded");
});

test("evidence can become unavailable without any revision or source-set change, invalidating an awaited release", async () => {
  const adapter = await fixture(); const initial = adapter.seed(doc, "accepted-file");
  const capture = readiness.captureOutputRelease(initial, "file");
  const changed = adapter.setSourceVerification(doc, false);
  assert.equal(changed.revision, initial.revision);
  assert.equal(changed.sourceRevision, initial.sourceRevision);
  assert.equal(changed.requirementRevision, initial.requirementRevision);
  assert.deepEqual(changed.sourceVerification.capacity, initial.sourceVerification.capacity);
  assert.equal(readiness.outputReleaseStillAllowed(capture, changed), false);
  assert.equal(changed.results[0].reviewAllowed, false);
  assert.equal(changed.results[0].independentReviewBlocked, false);
  const restored = adapter.setSourceVerification(doc, true);
  assert.equal(restored.sourceVerification.status, "verified");
  assert.equal(readiness.outputReleaseStillAllowed(capture, restored), true);
});

test("binary capacity 409 is not a CAS restage permission and never adopts the selected file", async () => {
  const adapter = await fixture(); const file = adapter.sampleFile(), before = adapter.snapshot(doc);
  adapter.failNextUploadCapacity();
  const response = await adapter.fetch(`/api/output-requirements/assets?documentId=${doc}`, { method: "POST", body: file, headers: {
    "x-output-rights-confirmed": "true", "x-output-expected-revision": before.revision, "x-output-filename": encodeURIComponent(file.name),
  } });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error, "context_source_evidence_capacity_exceeded");
  const failure = readiness.classifyOutputUploadFailure({ status: "conflict", body });
  assert.equal(readiness.outputUploadNeedsRestage(failure), false);
  assert.equal(adapter.snapshot(doc).revision, before.revision);
  assert.equal(adapter.snapshot(doc).assets.length, 0);
  assert.equal(file.size, adapter.sampleFile().size);
});

test("synthetic native offers contain explicit whole-attempt policy rather than an invented UI fallback", async () => {
  const adapter = await fixture(); const snapshot = adapter.snapshot(doc);
  const response = await post(adapter, { action: "preflight", planRevisionId: snapshot.confirmedPlan.revisionId, targetIds: [snapshot.confirmedPlan.plan.targets[0].id] });
  assert.deepEqual((await response.json()).command.preflight.targets[0].settings.executionPolicy,
    { maximumMilliseconds: 240_000, heartbeatMilliseconds: 60_000, maximumRenewals: 3 });
});

function receiptIdentity(snapshot) {
  const grant = snapshot.grants[0], slot = grant.operations[0];
  return { documentId: snapshot.documentId, grantId: grant.id, slotId: slot.id, jobId: slot.jobId };
}
const receiptRequest = (adapter, identity) => adapter.fetch(`/api/document-jobs/${encodeURIComponent(identity.jobId)}/reconcile-output`, { method: "POST" });

test("synthetic timeout scenarios expose failed jobs, held accounting, and real support-receipt text without outputs", async () => {
  const adapter = await fixture();
  for (const scenario of ["native-timeout-unknown", "late-known-receipt"]) {
    const snapshot = adapter.seed(doc, scenario), grant = snapshot.grants[0], slot = grant.operations[0], job = adapter.jobs(doc)[0];
    assert.equal(job.status, "failed");
    assert.equal(job.errorDetail.code, "output_execution_time_limit");
    assert.equal(slot.status, "uncertain");
    assert.equal(grant.pendingCalls, 1); assert.equal(slot.pendingCalls, 1);
    assert.equal(grant.exposedMicrousd, 100_000); assert.equal(slot.exposedMicrousd, 100_000);
    assert.equal(recovery.outputOperationRecovery(slot, job, doc).canPrepareAlternative, false);
    assert.equal(snapshot.assets.length, 0); assert.equal(snapshot.results.length, 0);
    assert.equal(snapshot.summary.delivery_ready, false);
    const receipt = JSON.parse(supportReceipts.outputOperationSupportReceipt(snapshot, grant.id, slot.id, [job]));
    assert.equal(receipt.job.failureCode, "output_execution_time_limit");
    assert.equal(receipt.operation.accounting.unresolvedExposure, 100_000);
    assert.equal(receipt.operation.accounting.unresolvedCalls, 1);
    assert.ok(!JSON.stringify(receipt).includes(snapshot.requirements[0].content));
  }
});

test("unknown saved-receipt checks retain the exact reservation and zero outputs across repeated requests", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry));
  const before = adapter.seed(doc, "native-timeout-unknown"), identity = receiptIdentity(before);
  for (let i = 0; i < 2; i++) {
    const response = await receiptRequest(adapter, identity), body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.reconciliation, { ...identity, status: "uncertain", reconciled: false });
    assert.equal(body.job.status, "failed");
    assert.deepEqual(adapter.snapshot(doc), before);
  }
  assert.deepEqual(records.filter((entry) => entry.type === "fixture-request").map((entry) => entry.detail.action), ["receipt", "receipt"]);
  const checks = records.filter((entry) => entry.type === "fixture-receipt-check");
  assert.equal(checks.length, 2);
  assert.ok(checks.every((entry) => entry.detail.providerRequests === 0 && entry.detail.queueDriverCalls === 0 && entry.detail.acceptedOutputs === 0));
});

test("late known saved receipt settles cost once without reviving the failed job, accepting files, or creating another grant", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry));
  const before = adapter.seed(doc, "late-known-receipt"), identity = receiptIdentity(before);
  const first = await (await receiptRequest(adapter, identity)).json(), after = adapter.snapshot(doc);
  assert.deepEqual(first.reconciliation, { ...identity, status: "known", reconciled: true });
  assert.equal(after.grants.length, 1);
  assert.equal(after.grants[0].id, before.grants[0].id);
  assert.equal(after.grants[0].status, before.grants[0].status, "a receipt check does not manufacture a new grant lifecycle");
  assert.equal(after.grants[0].operations[0].id, identity.slotId);
  assert.equal(after.grants[0].operations[0].status, "failed");
  assert.equal(after.grants[0].usedMicrousd, 50_000); assert.equal(after.grants[0].usedCalls, 1);
  assert.equal(after.grants[0].exposedMicrousd, 0); assert.equal(after.grants[0].pendingCalls, 0);
  assert.equal(after.assets.length, 0); assert.equal(after.results.length, 0);
  assert.equal(adapter.jobs(doc).length, 1); assert.equal(adapter.jobs(doc)[0].status, "failed");
  assert.equal(adapter.jobs(doc)[0].errorDetail.code, "output_execution_time_limit");
  assert.equal(after.summary.delivery_ready, false);
  assert.equal(after.sourceRevision, before.sourceRevision); assert.equal(after.requirementRevision, before.requirementRevision);
  assert.equal(after.confirmedPlan.revisionId, before.confirmedPlan.revisionId);
  const repeated = await (await receiptRequest(adapter, identity)).json();
  assert.deepEqual(repeated.reconciliation, { ...identity, status: "known", reconciled: false });
  assert.deepEqual(adapter.snapshot(doc), after, "replay must not charge, bump a revision, or create work twice");
  assert.ok(records.filter((entry) => entry.type === "fixture-request").every((entry) => entry.detail.action === "receipt"));
});

test("explicit synthetic receipt bridge refreshes the real scoped client even when source verification is unavailable", async () => {
  for (const scenario of ["native-timeout-unknown", "late-known-receipt"]) {
    const records = [], adapter = await fixture((entry) => records.push(entry));
    adapter.seed(doc, scenario); adapter.setSourceVerification(doc, false);
    const client = realClient(adapter); await client.ensure(doc);
    const before = client.resource(doc).snapshot, identity = receiptIdentity(before);
    assert.equal(readiness.outputDeliveryReadiness(before).allowed, false);
    let notified = 0;
    const result = await reconcileOutputFixtureReceipt({ adapter, client, ...identity, notify: () => notified++ });
    assert.deepEqual(result, { status: scenario === "late-known-receipt" ? "known" : "uncertain", reconciled: scenario === "late-known-receipt", refreshed: true });
    assert.equal(notified, 1);
    const current = client.resource(doc).snapshot;
    assert.equal(current.sourceVerification.status, "unavailable");
    assert.equal(current.results.length, 0); assert.equal(current.assets.length, 0); assert.equal(current.grants.length, 1);
    assert.equal(current.grants[0].operations[0].pendingCalls, scenario === "late-known-receipt" ? 0 : 1);
    assert.deepEqual(records.filter((entry) => entry.type === "fixture-request").map((entry) => entry.detail.action), ["read", "receipt", "read"]);
    assert.ok(!records.some((entry) => entry.type === "fixture-job-sync" || entry.detail.action === "authorize" || entry.detail.action === "run"));
  }
});

test("both receipt delay boundaries discard a former-scope reply before updating or notifying the current view", async () => {
  for (const stage of ["response", "body"]) {
    const adapter = await fixture(); adapter.seed(doc, "native-timeout-unknown");
    const client = realClient(adapter); await client.ensure(doc);
    const identity = receiptIdentity(client.resource(doc).snapshot);
    let notified = 0;
    adapter.armHold("receipt", stage);
    const pending = reconcileOutputFixtureReceipt({ adapter, client, ...identity, notify: () => notified++ });
    await nextTurn();
    assert.equal(adapter.heldAction, "receipt");
    adapter.changeScope(); client.clear();
    assert.equal(adapter.release(), true);
    assert.deepEqual(await pending, { status: "forbidden", errorCode: "output_receipt_scope_changed" });
    assert.equal(client.resource(doc).snapshot, null);
    assert.equal(notified, 0);
  }
});

test("synthetic receipt bridge refuses mismatched IDs and a malformed echoed response", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry));
  adapter.seed(doc, "native-timeout-unknown"); const client = realClient(adapter); await client.ensure(doc);
  const identity = receiptIdentity(client.resource(doc).snapshot);
  const requestCount = records.filter((entry) => entry.type === "fixture-request").length;
  assert.equal((await reconcileOutputFixtureReceipt({ adapter, client, ...identity, jobId: "another-job" })).status, "forbidden");
  assert.equal(records.filter((entry) => entry.type === "fixture-request").length, requestCount);
  const mismatching = Object.create(adapter);
  mismatching.fetch = async (...args) => {
    const response = await adapter.fetch(...args), body = await response.json();
    body.reconciliation.documentId = "another-document";
    return Response.json(body);
  };
  assert.deepEqual(await reconcileOutputFixtureReceipt({ adapter: mismatching, client, ...identity }), { status: "invalid", errorCode: "output_receipt_response_mismatch" });
  assert.equal(client.resource(doc).snapshot.grants[0].operations[0].pendingCalls, 1);
});

test("receipt simulation adds only its exact local POST path and preserves page isolation and explicit boundary labeling", async () => {
  const adapter = await fixture(), snapshot = adapter.seed(doc, "native-timeout-unknown"), identity = receiptIdentity(snapshot);
  const path = `/api/document-jobs/${identity.jobId}/reconcile-output`;
  for (const url of ["https://provider.example/jobs/check", "/api/document-jobs", `/api/document-jobs/${identity.jobId}/run`, `${path}?documentId=${doc}`]) {
    assert.ok((await adapter.fetch(url, { method: "POST" })).status >= 400, url);
  }
  assert.equal((await adapter.fetch(path)).status, 400);
  assert.equal((await adapter.fetch(path, { method: "POST", body: "{}" })).status, 400);
  const entry = readFileSync(new URL("./output-controller.fixture.mjs", import.meta.url), "utf8"), html = readFileSync(new URL("./output-controller.fixture.html", import.meta.url), "utf8");
  assert.match(entry, /store\.reconcileOutputOperationReceipt = .*reconcileOutputFixtureReceipt/s);
  assert.ok(!entry.includes("FormaStore.prototype.reconcileOutputOperationReceipt.call"));
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /<option value="receipt">Saved receipt check<\/option>/);
  assert.match(html, /does not execute FormaStore’s private receipt state or the actual server endpoint/);
  assert.match(entry, /qa.*automated/s);
  assert.match(entry, /receiptKnown: 0, receiptUncertain: 0, jobSync: 0/);
});

test("generic fixture run/completion controls cannot revive a timed-out receipt job", async () => {
  for (const scenario of ["native-timeout-unknown", "late-known-receipt"]) {
    const adapter = await fixture(), snapshot = adapter.seed(doc, scenario), identity = receiptIdentity(snapshot);
    if (scenario === "late-known-receipt") await receiptRequest(adapter, identity);
    const before = adapter.snapshot(doc).grants;
    const response = await post(adapter, { action: "run", grantId: identity.grantId });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "fixture_terminal_receipt_job_not_restartable");
    adapter.completeOperations(doc);
    assert.deepEqual(adapter.snapshot(doc).grants, before);
    assert.equal(adapter.jobs(doc)[0].status, "failed");
    assert.equal(adapter.snapshot(doc).results.length, 0);
  }
});

test("actual scoped download client accepts the canonical fixture asset URL and returns the inspected exact PNG", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry));
  adapter.seed(doc, "accepted-file");
  const client = realClient(adapter); await client.ensure(doc);
  const snapshot = client.resource(doc).snapshot, row = snapshot.assets[0];
  assert.equal(row.downloadUrl, `/api/output-requirements/assets/${row.id}?documentId=${doc}`);
  const downloaded = await client.download(doc, row.downloadUrl);
  assert.equal(downloaded.status, "saved", downloaded.error);
  assert.equal(downloaded.body.filename, row.name);
  const bytes = new Uint8Array(await downloaded.body.blob.arrayBuffer());
  const inspection = await assets.inspectOutputAsset(bytes, downloaded.body.filename);
  assert.equal(inspection.status, "inspected"); assert.equal(inspection.sha256, row.sha256);
  assert.deepEqual(inspection.facts, { width: 1, height: 1 });
  assert.equal(records.filter((entry) => entry.type === "fixture-request" && entry.detail.path === row.downloadUrl).length, 1,
    "the real allowlist must allow an actual adapter request, not fail before a held reply exists");
});

test("actual scoped command/download client accepts the canonical diagnostic delivery URL without pretending it is a media package", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry)); adapter.seed(doc, "accepted-file");
  const client = realClient(adapter); await client.ensure(doc);
  const snapshot = client.resource(doc).snapshot;
  const exported = await client.command(doc, { action: "export", documentId: doc, expectedRevision: snapshot.revision,
    clientMutationId: "fixture-client-export", planRevisionId: snapshot.confirmedPlan.revisionId, allowPartial: false }, "synthetic diagnostic export");
  assert.equal(exported.status, "saved");
  const path = exported.body.command.downloadUrl;
  assert.equal(path, `/api/output-requirements/deliveries/fixture-diagnostic-${doc}?documentId=${doc}`);
  const downloaded = await client.download(doc, path);
  assert.equal(downloaded.status, "saved", downloaded.error);
  assert.equal(downloaded.body.filename, "SYNTHETIC-output-fixture-diagnostic.json");
  const body = JSON.parse(await downloaded.body.blob.text());
  assert.equal(body.synthetic, true); assert.equal(body.documentId, doc);
  assert.match(body.warning, /not a delivery package or acceptance evidence/);
  assert.equal(records.filter((entry) => entry.type === "fixture-request" && entry.detail.path === path).length, 1);
});

test("real download allowlist still rejects legacy fixture routes and cross-Document URLs before dispatch", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry)); const snapshot = adapter.seed(doc, "accepted-file");
  const client = realClient(adapter); await client.ensure(doc);
  const before = records.filter((entry) => entry.type === "fixture-request").length;
  for (const path of [
    `/api/output-requirements/assets/${snapshot.assets[0].id}/download?documentId=${doc}`,
    `/api/output-requirements/fixture-manifest?documentId=${doc}`,
    `/api/output-requirements/assets/${snapshot.assets[0].id}?documentId=${FIXTURE_DOCUMENT_IDS[1]}`,
  ]) assert.equal((await client.download(doc, path)).status, "invalid", path);
  assert.equal(records.filter((entry) => entry.type === "fixture-request").length, before);
});

test("canonical asset download genuinely reaches and waits inside the adapter blob boundary before source readiness changes", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry)); adapter.seed(doc, "accepted-file");
  const client = realClient(adapter); await client.ensure(doc);
  const before = client.resource(doc).snapshot, row = before.assets[0], capture = readiness.captureOutputRelease(before, "file");
  let finished = false;
  adapter.armHold("read", "body");
  const pending = client.download(doc, row.downloadUrl).then((result) => { finished = true; return result; });
  await nextTurn();
  assert.equal(adapter.heldAction, "read"); assert.equal(finished, false);
  assert.equal(records.filter((entry) => entry.type === "fixture-request" && entry.detail.path === row.downloadUrl).length, 1);
  adapter.setSourceVerification(doc, false); await client.ensure(doc, { force: true });
  assert.equal(client.resource(doc).snapshot.sourceRevision, before.sourceRevision);
  assert.equal(client.resource(doc).snapshot.requirementRevision, before.requirementRevision);
  assert.equal(adapter.release(), true);
  const downloaded = await pending;
  assert.equal(downloaded.status, "saved", "transport can finish old bytes; the controller must still apply the readiness guard before a Blob URL");
  assert.equal(downloaded.body.blob.size, row.byteLength);
  assert.equal(readiness.outputReleaseStillAllowed(capture, client.resource(doc).snapshot), false);
});

test("direct institutional and licensed fixture disclosures remain verified without treating the batch limit as a package rule", async () => {
  for (const scenario of ["governed-institutional", "governed-licensed"]) {
    const adapter = await fixture(), snapshot = adapter.seed(doc, scenario);
    const disclosure = readiness.outputSourceGovernance(snapshot);
    assert.equal(snapshot.sourceVerification.status, "verified");
    assert.equal(disclosure.captureBatchLimit, 2); assert.equal(disclosure.sourcesComplete, true); assert.equal(disclosure.sources.length, 1);
    assert.equal(readiness.outputNativeReadiness(snapshot).allowed, true);
    const blocks = adapter.sourceBlocks(doc);
    for (const source of disclosure.sources) assert.ok(blocks.some((block) => block.documentId === doc && block.id === source.blockId && block.properties.label === source.label));
    const client = realClient(adapter); await client.ensure(doc);
    assert.equal((await client.download(doc, snapshot.assets[0].downloadUrl)).status, "saved");
    const preflight = await post(adapter, { action: "preflight", planRevisionId: snapshot.confirmedPlan.revisionId, targetIds: [snapshot.confirmedPlan.plan.targets[0].id] });
    assert.equal(preflight.status, 200);
  }
});

test("complex governed-source failure exposes only bounded current-Document labels and keeps cost and prior file history", async () => {
  const adapter = await fixture(), snapshot = adapter.seed(doc, "governed-capacity");
  assert.equal(snapshot.confirmedPlan.sourceDigest, snapshot.sourceRevision);
  assert.equal(snapshot.confirmedPlan.requirementsDigest, snapshot.requirementRevision);
  assert.deepEqual(snapshot.sourceVerification.reasonCodes, ["output_source_governance_capacity_exceeded"]);
  assert.equal(snapshot.sourceVerification.capacity.distinctObjectCount, 1);
  assert.equal(snapshot.sourceVerification.capacity.nativeLimit, 1, "physical file capacity fits; governance is the distinct failing check");
  const disclosure = readiness.outputSourceGovernance(snapshot), blocks = adapter.sourceBlocks(doc);
  assert.equal(disclosure.captureBatchLimit, 2); assert.equal(disclosure.sources.length, 32); assert.equal(disclosure.sourcesComplete, false);
  assert.equal(blocks.filter((block) => block.id.startsWith("fixture-governed-")).length, 37);
  assert.ok(disclosure.sources.some((source) => source.label.length === 120));
  for (const source of disclosure.sources) {
    const block = blocks.find((entry) => entry.id === source.blockId);
    assert.equal(block.documentId, doc); assert.equal(source.label, block.properties.label.slice(0, 120));
  }
  assert.ok(!JSON.stringify(disclosure).includes("originPackageId"));
  assert.equal(snapshot.summary.scope_known, false); assert.equal(snapshot.summary.delivery_ready, false);
  assert.equal(snapshot.requirements.length, 1); assert.equal(snapshot.confirmedPlan.plan.targets.length, 1);
  assert.equal(snapshot.assets.length, 1); assert.equal(snapshot.results[0].review, "approved", "recorded prior acceptance remains history");
  assert.equal(snapshot.results[0].reviewAllowed, false); assert.equal(snapshot.results[0].independentReviewBlocked, false);
  assert.equal(snapshot.grants.length, 1); assert.equal(snapshot.grants[0].exposedMicrousd, 100_000); assert.equal(snapshot.grants[0].pendingCalls, 1);
});

test("governance capacity blocks owned upload, exact download, and consequential commands with its precise non-CAS reason", async () => {
  const adapter = await fixture(), snapshot = adapter.seed(doc, "governed-capacity");
  for (const action of ["preflight", "authorize", "run", "bind", "review", "export"]) {
    const response = await post(adapter, { action });
    assert.equal(response.status, 409, action);
    assert.equal((await response.json()).error, "output_source_governance_capacity_exceeded", action);
  }
  const client = realClient(adapter); await client.ensure(doc);
  const download = await client.download(doc, snapshot.assets[0].downloadUrl);
  assert.equal(download.status, "conflict"); assert.equal(download.body.error, "output_source_governance_capacity_exceeded");
  const file = adapter.sampleFile();
  const upload = await client.upload(doc, file, { "x-output-rights-confirmed": "true", "x-output-expected-revision": snapshot.revision,
    "x-output-client-mutation-id": "fixture-governance-upload", "x-output-filename": encodeURIComponent(file.name) });
  assert.equal(upload.status, "conflict"); assert.equal(upload.body.error, "output_source_governance_capacity_exceeded");
  assert.equal(readiness.outputUploadNeedsRestage(readiness.classifyOutputUploadFailure(upload)), false);
  assert.equal(adapter.snapshot(doc).assets.length, 1); assert.equal(adapter.snapshot(doc).revision, snapshot.revision);
});

test("editing and free structural confirmation retain the full governed assignment and held spending without repairing source proof", async () => {
  const adapter = await fixture(), before = adapter.seed(doc, "governed-capacity"), row = before.requirements[0];
  assert.equal((await post(adapter, { action: "save", blockId: row.blockId, spec: row.spec, planSuggestions: row.planSuggestions })).status, 200);
  assert.equal((await post(adapter, { action: "confirm", options: before.confirmedPlan.confirmationOptions })).status, 200);
  const after = adapter.snapshot(doc);
  assert.deepEqual(after.requirements.map((entry) => entry.spec), before.requirements.map((entry) => entry.spec));
  assert.deepEqual(after.grants, before.grants);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(after.results, before.results);
  assert.deepEqual(after.confirmedPlan.plan.targets.map((target) => target.id), before.confirmedPlan.plan.targets.map((target) => target.id));
  assert.equal(after.sourceVerification.status, "unavailable"); assert.equal(after.summary.scope_known, false);
  const refreshed = adapter.setSourceVerification(doc, true);
  assert.deepEqual(refreshed.sourceVerification, before.sourceVerification, "Refresh cannot increase the budget, remove origins, or silently narrow the source list");
  assert.equal(refreshed.grants[0].exposedMicrousd, 100_000);
});

test("saved-receipt recovery remains available while governed-source proof is unavailable and does not erase held exposure", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry)), before = adapter.seed(doc, "governed-capacity");
  const client = realClient(adapter); await client.ensure(doc);
  const result = await reconcileOutputFixtureReceipt({ adapter, client, ...receiptIdentity(before) });
  assert.deepEqual(result, { status: "uncertain", reconciled: false, refreshed: true });
  const after = client.resource(doc).snapshot;
  assert.deepEqual(after.grants, before.grants); assert.deepEqual(after.assets, before.assets); assert.deepEqual(after.results, before.results);
  assert.equal(after.sourceVerification.status, "unavailable"); assert.equal(after.grants[0].exposedMicrousd, 100_000);
  assert.deepEqual(records.filter((entry) => entry.type === "fixture-request").map((entry) => entry.detail.action), ["read", "receipt", "read"]);
  assert.ok(!records.some((entry) => entry.type === "fixture-job-sync" || entry.detail.action === "authorize" || entry.detail.action === "run"));
});

test("fixture governance labels share the current-Document source projection and never become fabricated links", () => {
  const script = readFileSync(new URL("./output-controller.fixture.mjs", import.meta.url), "utf8"), html = readFileSync(new URL("./output-controller.fixture.html", import.meta.url), "utf8");
  assert.match(script, /libraryBlocks: FIXTURE_DOCUMENT_IDS\.flatMap\(\(documentId\) => adapter\.sourceBlocks\(documentId\)\)/);
  assert.match(html, /governed-source scenarios are synthetic disclosures/);
  assert.match(html, /no origin identifiers or external investigation link is supplied/);
  assert.match(html, /connect-src 'none'/);
});


test("large visible fixture retains 1,000 actual compiled targets, their contract identities, and the entire unpaid assignment", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry));
  const snapshot = adapter.seed(doc, "large-target-plan");
  assert.equal(snapshot.confirmedPlan.plan.issues.length, 0);
  assert.equal(snapshot.confirmedPlan.plan.targets.length, 1000);
  assert.equal(snapshot.confirmedPlan.plan.targets.filter((target) => target.selected && !target.blocking_issues.length).length, 1000);
  assert.equal(Object.keys(snapshot.confirmedPlan.targetContractDigests).length, 1000);
  assert.equal(snapshot.targetStates.length, 1000);
  assert.equal(snapshot.summary.required_targets, 1000); assert.equal(snapshot.summary.selected_targets, 1000);
  assert.equal(snapshot.summary.fulfilled_targets, 0); assert.equal(snapshot.summary.scope_known, true);
  assert.equal(snapshot.summary.delivery_ready, false); assert.equal(readiness.outputNativeReadiness(snapshot).allowed, true);
  assert.equal(snapshot.grants.length, 0); assert.equal(snapshot.results.length, 0);
  assert.equal(records.filter((entry) => entry.type === "fixture-request").length, 0);
});

test("filtered visible fixture stages inclusion without a command and commits only a separate free Confirm while preserving owed optional work", async () => {
  const records = [], adapter = await fixture((entry) => records.push(entry)); adapter.seed(doc, "filtered-target-plan");
  const client = realClient(adapter), resource = await client.ensure(doc), snapshot = resource.snapshot;
  const before = structuredClone(snapshot), confirmed = snapshot.confirmedPlan.plan;
  const owed = (value) => value.obligations.filter((entry) => entry.required || entry.selected).map((entry) => ({ id: entry.id, target_ids: entry.target_ids, quantity: entry.quantity }));
  assert.equal(confirmed.targets.length, 5); assert.equal(confirmed.targets.filter((target) => target.selected).length, 2);
  assert.equal(confirmed.targets.filter((target) => target.required && !target.selected).length, 1);
  assert.equal(confirmed.obligations.find((entry) => entry.id === `fixture-owed-optional-${doc}`).selected, true);
  let state = planning.observeOutputPlanProposal(null, snapshot, planScope(adapter));
  state = planning.includeOutputPlanCommittedTargets(state); assert.ok(state);
  assert.deepEqual(state.draft.options.selected_optional_ids, [`fixture-owed-optional-${doc}`]);
  assert.equal(state.draft.options.selected_target_ids, undefined);
  const preview = plan.compileOutputPlan(snapshot.requirements.map((entry) => entry.spec), { document_id: doc,
    requirement_revision: snapshot.requirementRevision, source_revision: snapshot.sourceRevision, ...state.draft.options });
  assert.equal(preview.targets.filter((target) => target.selected).length, 4); assert.deepEqual(owed(preview), owed(confirmed));
  assert.equal(preview.targets.find((target) => target.deliverable_id === `fixture-optional-off-${doc}`).selected, false);
  assert.deepEqual(adapter.snapshot(doc), before);
  assert.deepEqual(records.filter((entry) => entry.type === "fixture-request").map((entry) => entry.detail.action), ["read"]);
  const capture = planning.captureOutputPlanConfirmation(state, snapshot, planScope(adapter)); assert.ok(capture);
  const reply = await client.command(doc, { action: "confirm", documentId: doc, expectedRevision: capture.expectedRevision,
    clientMutationId: "synthetic-reviewed-filter-reset", options: capture.options, amendmentReason: capture.amendmentReason });
  assert.equal(reply.status, "saved");
  const after = adapter.snapshot(doc);
  assert.equal(after.confirmedPlan.plan.targets.filter((target) => target.selected).length, 4);
  assert.deepEqual(owed(after.confirmedPlan.plan), owed(confirmed));
  assert.equal(after.confirmedPlan.plan.targets.find((target) => target.deliverable_id === `fixture-optional-off-${doc}`).selected, false);
  assert.deepEqual(after.grants, before.grants); assert.deepEqual(after.results, before.results);
  assert.equal(records.filter((entry) => entry.type === "fixture-request" && ["preflight", "authorize", "run"].includes(entry.detail.action)).length, 0);
});

test("partial-contract visible fixture preserves known assignment and verified source without fabricating a target map", async () => {
  const adapter = await fixture(); adapter.seed(doc, "target-contracts-unavailable");
  const client = realClient(adapter), resource = await client.ensure(doc), snapshot = resource.snapshot;
  assert.equal(resource.state, "ready"); assert.equal(snapshot.confirmedPlan.targetContractDigests, undefined);
  assert.equal(snapshot.confirmedPlan.plan.targets.length, 1); assert.equal(snapshot.summary.scope_known, true);
  assert.equal(snapshot.sourceVerification.status, "verified"); assert.equal(snapshot.results.length, 0);
  // The actual controller's missing-map/digest tests establish the disabled Check and safe rendering.
  assert.equal(snapshot.grants.length, 0);
});

test("history-only visible fixture refuses packages through the real client while exact PNG remains readable and free Confirm does not repair history", async () => {
  const adapter = await fixture(); adapter.seed(doc, "history-unverified");
  const client = realClient(adapter), resource = await client.ensure(doc), snapshot = resource.snapshot;
  assert.equal(snapshot.sourceVerification.status, "verified"); assert.equal(snapshot.summary.scope_known, true);
  assert.equal(snapshot.summary.fulfilled_targets, 1); assert.equal(snapshot.summary.completion, "unknown");
  assert.equal(snapshot.summary.delivery_ready, false); assert.equal(snapshot.requirementFileCounts[snapshot.requirements[0].blockId], 1);
  assert.equal(readiness.outputSourceReadiness(snapshot).allowed, true);
  assert.equal(readiness.outputPackageReadiness(snapshot).allowed, false);
  const exact = await client.download(doc, snapshot.assets[0].downloadUrl);
  assert.equal(exact.status, "saved"); assert.equal(exact.body.blob.size, snapshot.assets[0].byteLength);
  for (const allowPartial of [false, true]) {
    const denied = await client.command(doc, { action: "export", documentId: doc, expectedRevision: snapshot.revision,
      clientMutationId: `synthetic-history-package-${allowPartial}`, planRevisionId: snapshot.confirmedPlan.revisionId, allowPartial });
    assert.equal(denied.status, "conflict"); assert.equal(denied.body.error, "output_scope_history_reason_unverified");
  }
  const part = await client.download(doc, `/api/output-requirements/deliveries/fixture-diagnostic-${doc}?documentId=${doc}`);
  assert.equal(part.status, "conflict"); assert.equal(part.body.error, "output_scope_history_reason_unverified");
  const free = await client.command(doc, { action: "confirm", documentId: doc, expectedRevision: snapshot.revision,
    clientMutationId: "synthetic-free-history-plan", options: snapshot.confirmedPlan.confirmationOptions });
  assert.equal(free.status, "saved");
  const after = adapter.snapshot(doc);
  assert.ok(after.capabilities.limitationCodes.includes("output_scope_history_reason_unverified"));
  assert.equal(after.summary.delivery_ready, false); assert.equal(after.sourceVerification.status, "verified");
  assert.deepEqual(after.grants, snapshot.grants); assert.equal(after.assets.length, 1);
});


// Compatibility of the exact browser-fixture Store literal with the current
// complete controller class. Native browser scheduling and actual Store/server
// authority are deliberately not claimed by this deterministic fixture test.
function browserFixtureStore(adapter, controller, records, fixtureLocation) {
  const file = new URL("./output-controller.fixture.mjs", import.meta.url);
  const script = readFileSync(file, "utf8"), tree = ts.createSourceFile(file.pathname, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const assignment = tree.statements.find(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)
    && node.expression.left.getText(tree) === "store" && ts.isObjectLiteralExpression(node.expression.right));
  const snapshotDeclaration = tree.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(tree) === "isFixtureSnapshot");
  assert.ok(assignment && snapshotDeclaration?.initializer, "use the existing browser fixture definitions");
  const bindings = { adapter, controller, listeners: new Set(), notify() {}, record: entry => records.push(entry),
    FIXTURE_DOCUMENT_IDS, FIXTURE_ACTOR, FIXTURE_PROJECT, FIXTURE_PROJECT_ACCESS, window: { location: fixtureLocation } };
  const evaluate = node => new Function(...Object.keys(bindings), '"use strict"; return (' + node.getText(tree) + ");")(...Object.values(bindings));
  const store = evaluate(assignment.expression.right);
  store.outputRequirements = new transport.OutputRequirementsClient({
    captureScope: () => adapter.scope(), scopeActive: scope => adapter.scopeActive(scope), fetch: (...args) => adapter.fetch(...args),
    notify: bindings.notify, isSnapshot: evaluate(snapshotDeclaration.initializer),
  });
  return store;
}

async function browserControllerBoundary(t) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("The synthetic fixture must never call a real API/provider"));
  const records = [], adapter = await fixture(entry => records.push(entry)), host = await controllerFixture();
  const fixtureLocation = new URL("http://fixture.invalid/tests/output-controller.fixture.html?qa=automated&locale=fr#synthetic");
  const store = browserFixtureStore(adapter, host.controller, records, fixtureLocation);
  host.controller.store = store; host.controller.documentId = doc;
  return { controller: host.controller, store, adapter, records, fixtureLocation };
}

test("browser fixture missing route port reproduces the current pre-read controller failure", async t => {
  const f = await browserControllerBoundary(t);
  delete f.store.route; // Exact old fixture shape; no production method is substituted.
  assert.throws(() => f.controller.willUpdate(new Map()), error => error instanceof TypeError
    && /reading 'get'/u.test(error.message) && /sourceRefreshScopeKey/u.test(error.stack));
  assert.equal(f.records.filter(entry => entry.type === "fixture-request").length, 0, "failure occurs before the first synthetic GET");
});

test("actual browser fixture Store mounts every scenario through the real controller and scoped client without a command", async t => {
  const f = await browserControllerBoundary(t);
  for (const scenario of Object.keys(OUTPUT_CONTROLLER_SCENARIOS)) {
    f.adapter.seed(doc, scenario); f.adapter.changeScope(); f.store.outputRequirements.clear();
    const before = f.adapter.snapshot(doc), requestCount = f.records.filter(entry => entry.type === "fixture-request").length;
    f.controller.willUpdate(new Map()); f.controller.updated();
    for (let attempts = 0; attempts < 30 && f.store.outputRequirements.resource(doc).state !== "ready"; attempts++) await nextTurn();
    const resource = f.store.outputRequirements.resource(doc);
    assert.equal(resource.state, "ready", scenario + ": the first API-shaped fixture read completed");
    f.controller.willUpdate(new Map());
    assert.ok(JSON.stringify(f.controller.render()).length > 100, scenario + ": the complete real class renders");
    assert.deepEqual(f.adapter.snapshot(doc), before, scenario + ": rendering does not change the fictional source, receipts or spending");
    const requests = f.records.filter(entry => entry.type === "fixture-request").slice(requestCount);
    assert.equal(requests.length, 1, scenario); assert.equal(requests[0].detail.action, "read", scenario);
  }
  assert.equal(f.store.session.get().capabilities, undefined, "no project-read/author permission is invented");
  assert.equal(f.store.session.get().projectContext, undefined, "no real selected-project scope is emulated");
  assert.equal(f.store.refreshOutputSource, undefined, "this fix does not invent a source-authority bridge");
  assert.equal(f.store.inspectOutputNativeJob, undefined, "this fix does not invent private job inspection");
});

test("browser fixture route observes its real URL while setRoute remains an explicit diagnostic intent", async t => {
  const f = await browserControllerBoundary(t), before = f.adapter.snapshot(doc), original = f.fixtureLocation.href;
  assert.equal(f.store.route.get(), f.fixtureLocation.pathname + f.fixtureLocation.search + f.fixtureLocation.hash);
  f.store.setRoute("/document/not-an-actual-navigation");
  assert.equal(f.fixtureLocation.href, original);
  assert.equal(f.records.at(-1).type, "fixture-navigation-intent");
  assert.equal(f.records.at(-1).detail.route, "/document/not-an-actual-navigation");
  f.fixtureLocation.hash = "#newer-fixture-view";
  assert.equal(f.store.route.get(), f.fixtureLocation.pathname + f.fixtureLocation.search + "#newer-fixture-view");
  assert.deepEqual(f.adapter.snapshot(doc), before);
  assert.equal(f.records.filter(entry => entry.type === "fixture-request").length, 0);
});

test("browser fixture keeps its original CSP and executable global network blockade", async () => {
  const html = readFileSync(new URL("./output-controller.fixture.html", import.meta.url), "utf8");
  assert.match(html, /connect-src 'none'/u); assert.match(html, /form-action 'none'/u);
  const script = html.match(/<script>([\s\S]*?)<\/script>/u)?.[1]; assert.ok(script);
  const events = [], fixtureWindow = { dispatchEvent: event => events.push(event) };
  class FixtureEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  new Function("window", "CustomEvent", script)(fixtureWindow, FixtureEvent);
  for (const path of ["/api/output-requirements", "https://provider.invalid/synthetic-only"]) {
    await assert.rejects(fixtureWindow.fetch(path), /SYNTHETIC fixture refused global fetch/u);
  }
  assert.equal(fixtureWindow.__formaOutputFixtureBlockedRequests.length, 2);
  assert.deepEqual(events.map(event => event.type), ["fixture-network-blocked", "fixture-network-blocked"]);
  assert.ok(events.every(event => event.detail.blocked === true));
});
