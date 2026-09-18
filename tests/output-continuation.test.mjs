import assert from "node:assert/strict";
import test from "node:test";
import { registerOutputSourceImports } from "./output-server-test-helpers.mjs";
import { createOutputControllerFixture, OUTPUT_CONTROLLER_SCENARIOS, FIXTURE_DOCUMENT_IDS } from "./output-controller-fixture-model.mjs";

const imports = registerOutputSourceImports();
const [requirements, plan, inspection, continuation, navigation, desk, host, intelligence] = await Promise.all([
  import("../src/model/output-requirements.ts"), import("../src/model/output-plan.ts"),
  import("../src/model/output-asset-inspection.ts"), import("../src/components/output-continuation.ts"),
  import("../src/model/output-navigation.ts"), import("../src/model/outcome-desk.ts"),
  import("../src/canvas/outcome-desk-host.ts"), import("../src/model/workspace-intelligence.ts"),
]);
imports.deregister();
const { outputContinuationChoices } = continuation;
const { captureOutputNavigation } = navigation;
const doc = FIXTURE_DOCUMENT_IDS[0], scopeKeys = new WeakMap();
const ports = {
  localize: (key, fallback) => "localized:" + key + ":" + fallback,
  delivery: () => assert.fail("canonical Output must not use legacy artifact delivery"),
};
// These are explicit synthetic domain scenarios using the actual parser, plan
// reducer and byte inspector. They do not certify authorization, human approval,
// file usefulness, provider completion or real financial state.
async function scenario(name = "ready") {
  const records = [];
  const adapter = await createOutputControllerFixture({
    domain: { ...requirements, ...plan, ...inspection }, onRecord: (entry) => records.push(entry),
  });
  const snapshot = adapter.seed(doc, name);
  scopeKeys.set(snapshot, adapter.scope().key);
  return { adapter, snapshot, jobs: adapter.jobs(doc), records };
}
function inputFor(snapshot, jobs = [], state = "ready") {
  const authority = scopeKeys.get(snapshot); assert.ok(authority, "use this fixture snapshot’s current scope");
  return {
    facts: { projectId: snapshot.projectId, documentId: snapshot.documentId, canvasId: null,
      authorityKey: authority, canRead: true, canAuthor: snapshot.permissions.canAuthor, canConfigure: snapshot.permissions.canRequest,
      blocks: [], outputs: [], artifacts: [], jobs: [], events: [] },
    document: { id: snapshot.documentId, projectId: snapshot.projectId, title: "Synthetic current document", removed: false },
    output: { authorizationScopeKey: authority, actorUserId: snapshot.scope.actorUserId,
      projectAccessId: snapshot.scope.projectAccessId, resource: { state, snapshot, error: null }, jobs },
  };
}
function options(snapshot, kind = "target", id, jobs = [], state = "ready") {
  const authority = scopeKeys.get(snapshot); assert.ok(authority, "use this fixture snapshot’s current scope");
  const exactId = id ?? (kind === "requirement" ? snapshot.requirements[0].blockId
    : kind === "operation" ? snapshot.grants[0].operations[0].id
      : kind === "result" ? snapshot.results[0].id : snapshot.confirmedPlan.plan.targets[0].id);
  const reference = captureOutputNavigation(snapshot, authority, kind, exactId);
  assert.ok(reference, "the existing exact-navigation capture must admit the scenario");
  return { read: { state, snapshot }, authorizationScopeKey: authority, reference, jobs };
}
function translatedDeskChoice(row, input, choice) {
  return {
    key: row.key + ":output:" + choice.section + ":" + choice.label.key + ":" + JSON.stringify(choice.reference),
    subject: row.reference,
    scope: { projectId: input.facts.projectId, documentId: input.facts.documentId, canvasId: null, authorityKey: input.facts.authorityKey },
    sourceRevision: intelligence.creativeActionSourceRevision(input.facts), effect: "open-existing-executor",
    label: ports.localize(choice.label.key, choice.label.fallback), detail: ports.localize(choice.detail.key, choice.detail.fallback),
    target: { kind: "canonical-output", reference: choice.reference, section: choice.section, refresh: choice.refresh },
  };
}
const sections = (choices) => choices.map((choice) => choice.section);
const labels = (choices) => choices.map((choice) => choice.label.key);
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
for (const name of Object.keys(OUTPUT_CONTROLLER_SCENARIOS)) {
  test("shared Output choices retain exact existing Desk keys, copy and order: " + name, async () => {
    const f = await scenario(name), input = freeze(inputFor(f.snapshot, f.jobs));
    const before = JSON.stringify(input), recordCount = f.records.length;
    const rows = desk.projectOutcomeDesk(input).rows.filter((row) => row.navigation);
    // Keep the 1,000-target fixture bounded without turning a filter into owed scope.
    const sample = rows.length <= 16 ? rows : [rows[0], rows.find((row) => row.object.kind === "target"), rows.at(-1)];
    assert.ok(sample.length, "even an unconfirmed/unknown plan retains its current requirement");
    for (const row of sample) {
      const choices = outputContinuationChoices({
        read: input.output.resource, authorizationScopeKey: input.facts.authorityKey, reference: row.navigation, jobs: f.jobs,
      });
      assert.deepEqual(host.outcomeDeskHostActions(input, row.key, ports),
        choices.map((choice) => translatedDeskChoice(row, input, choice)));
      assert.ok(choices.every((choice) => choice.reference.documentId === doc && !choice.refresh));
    }
    assert.equal(JSON.stringify(input), before); assert.equal(f.records.length, recordCount);
  });
}

test("ready creation is only exact configuration followed by owned-file and whole-plan inspection", async () => {
  const f = await scenario(), choices = outputContinuationChoices(options(f.snapshot, "target", undefined, f.jobs));
  assert.deepEqual(sections(choices), ["native", "owned", "inspect"]);
  assert.deepEqual(labels(choices), ["output.delivery.actionCreate", "output.delivery.adoptTitle", "output.delivery.actionCheck"]);
  assert.equal(choices[0].detail.key, "output.delivery.checkRun");
  assert.equal(choices[0].detail.fallback, "Check availability and cost · no generation");
  assert.ok(choices.every((choice) => choice.reference.kind === "target" && !choice.refresh));
});

test("accepted current work keeps its exact result before any new preparation", async () => {
  const f = await scenario("accepted-file"), choices = outputContinuationChoices(options(f.snapshot));
  assert.deepEqual(sections(choices), ["inspect", "native", "owned"]);
  assert.equal(choices[0].label.key, "output.delivery.actionDownload");
  assert.deepEqual(choices[0].reference, captureOutputNavigation(f.snapshot, options(f.snapshot).authorizationScopeKey, "result", f.snapshot.results[0].id));
  assert.equal(choices[0].detail.key, "output.delivery.inspectionCaveat");
});

test("independent review eligibility is not inferred from a pending or structurally checked file", async () => {
  for (const [name, key] of [["review-only-eligible", "output.delivery.actionReview"],
    ["review-only-contributor", "output.delivery.actionCheck"], ["review-only-unknown", "output.delivery.actionCheck"]]) {
    const f = await scenario(name), choices = outputContinuationChoices(options(f.snapshot, "result"));
    assert.deepEqual(labels(choices), [key]); assert.deepEqual(sections(choices), ["inspect"]);
  }
  for (const origin of ["result", "asset"]) {
    const f = await scenario("review-only-eligible");
    f.snapshot.permissions.independentReview = true;
    (origin === "result" ? f.snapshot.results[0] : f.snapshot.assets[0]).createdByUserId = f.snapshot.scope.actorUserId;
    assert.deepEqual(labels(outputContinuationChoices(options(f.snapshot, "result"))), ["output.delivery.actionCheck"]);
  }
});

test("missing, stale, blocked or changed file terms never promote exact-file review", async () => {
  const mutations = [
    (s) => { s.sourceVerification = { status: "unavailable", reasonCodes: ["context_source_evidence_unavailable"] }; },
    (s) => { s.results[0].sourceDigest = "not-current"; },
    (s) => { s.results[0].targetContractDigest = "not-current"; },
    (s) => { s.assets[0].available = false; },
    (s) => { s.assets[0].sha256 = "f".repeat(64); },
    (s) => { s.assets[0].inspection.sha256 = "f".repeat(64); },
    (s) => { s.assets[0].inspection.status = "unsupported"; },
    (s) => { s.confirmedPlan.plan.targets[0].blocking_issues.push({ code: "fixture-blocked", message: "Synthetic blocked target" }); },
    (s) => { s.permissions.canReview = false; },
  ];
  for (const mutate of mutations) {
    const f = await scenario("review-only-eligible"); mutate(f.snapshot);
    assert.deepEqual(labels(outputContinuationChoices(options(f.snapshot, "result"))), ["output.delivery.actionCheck"]);
  }
});

test("source, plan and capacity uncertainty retain their different existing navigation gates", async () => {
  for (const [name, expected] of [
    ["source-unknown", ["inspect"]], ["source-stale", ["owned", "inspect"]],
    ["partial", ["owned", "inspect"]], ["source-unverified", ["history", "inspect"]],
    ["source-native-capacity", ["inspect", "owned"]],
  ]) {
    const f = await scenario(name), choices = outputContinuationChoices(options(f.snapshot, "target", undefined, f.jobs));
    assert.deepEqual(sections(choices), expected, name);
    assert.equal(choices.some((choice) => choice.section === "native"), false, name);
  }
});

test("unsupported, unselected and blocked targets retain inspection without native substitution", async () => {
  for (const change of ["unsupported", "unselected", "blocked", "audio", "video", "document"]) {
    const f = await scenario(), target = f.snapshot.confirmedPlan.plan.targets[0];
    if (change === "unsupported") f.snapshot.targetStates[0].capability = "unsupported";
    else if (change === "unselected") target.selected = false;
    else if (change === "blocked") target.blocking_issues.push({ code: "fixture-blocked", message: "Synthetic blocked target" });
    else target.media_kind = change;
    const choices = outputContinuationChoices(options(f.snapshot));
    assert.deepEqual(sections(choices), ["owned", "inspect"], change);
  }
});

test("current author/request permissions independently gate owned and native navigation", async () => {
  for (const [author, request, expected] of [[false, true, ["native", "inspect"]], [true, false, ["owned", "inspect"]], [false, false, ["inspect"]]]) {
    const f = await scenario(); f.snapshot.permissions.canAuthor = author; f.snapshot.permissions.canRequest = request;
    assert.deepEqual(sections(outputContinuationChoices(options(f.snapshot))), expected);
  }
});

test("unknown original accounting remains ahead of new preparation and is never rewritten", async () => {
  const f = await scenario("native-timeout-unknown"), before = JSON.stringify(f.snapshot.grants);
  const choices = outputContinuationChoices(options(f.snapshot, "target", undefined, f.jobs));
  assert.deepEqual(sections(choices), ["history", "native", "owned", "inspect"]);
  assert.equal(choices[0].label.key, "output.delivery.actionRecover");
  assert.equal(choices[0].detail.key, "output.delivery.stopDoesNotErase");
  const original = outputContinuationChoices(options(f.snapshot, "operation", undefined, f.jobs));
  assert.deepEqual(sections(original), ["inspect"]); assert.equal(original[0].reference.jobId, f.jobs[0].jobId);
  assert.equal(original[0].detail.key, "output.delivery.retainedProviderDisclosure");
  assert.equal(JSON.stringify(f.snapshot.grants), before);
});

test("current completed native and older accepted work remain reuse candidates, not new approvals", async () => {
  const native = await scenario("native-completed");
  // The current canonical status is succeeded; the old browser scenario also
  // supports a legacy completed spelling. Neither spelling itself approves a file.
  native.snapshot.grants[0].operations[0].status = "succeeded";
  let choices = outputContinuationChoices(options(native.snapshot, "target", undefined, native.jobs));
  assert.equal(choices[0].section, "existing"); assert.equal(choices[0].label.key, "output.delivery.useExistingWork");
  assert.equal(native.snapshot.results.length, 0);
  const wrongJobs = native.jobs.map((job) => ({ ...job, documentId: "not-this-document" }));
  assert.equal(outputContinuationChoices(options(native.snapshot, "target", undefined, wrongJobs)).some((choice) => choice.section === "existing"), false);
  const prior = await scenario("accepted-file");
  prior.snapshot.confirmedPlan.revisionId = "synthetic-new-plan";
  prior.snapshot.targetStates[0].result_id = null;
  choices = outputContinuationChoices(options(prior.snapshot));
  assert.equal(choices[0].section, "existing");
  assert.equal(choices.some((choice) => choice.label.key === "output.delivery.actionDownload"), false);
});

test("non-ready current reads expose only refresh of a retained exact original operation", async () => {
  const f = await scenario("native-timeout-unknown");
  for (const state of ["loading", "refreshing", "unavailable"]) {
    const input = inputFor(f.snapshot, f.jobs, state);
    const row = desk.projectOutcomeDesk(input).rows.find((row) => row.object.kind === "operation");
    assert.ok(row?.retained); const choices = outputContinuationChoices(options(f.snapshot, "operation", undefined, f.jobs, state));
    assert.equal(choices.length, 1); assert.equal(choices[0].refresh, true);
    assert.deepEqual(labels(choices), ["output.delivery.refresh"]);
    assert.deepEqual(host.outcomeDeskHostActions(input, row.key, ports), choices.map((choice) => translatedDeskChoice(row, input, choice)));
    for (const kind of ["requirement", "target"]) assert.deepEqual(outputContinuationChoices(options(f.snapshot, kind, undefined, f.jobs, state)), []);
  }
});

test("missing or retired reads supply no executable continuation and never manufacture an empty plan", async () => {
  const f = await scenario("native-timeout-unknown"), current = options(f.snapshot, "operation", undefined, f.jobs);
  for (const read of [null, { ...current.read, snapshot: null }, { ...current.read, accessLost: true }, { ...current.read, privateUnavailable: true }])
    assert.deepEqual(outputContinuationChoices({ ...current, read }), []);
  assert.deepEqual(outputContinuationChoices({ ...current, reference: null }), []);
  assert.deepEqual(outputContinuationChoices({ ...current, authorizationScopeKey: "different-current-authority" }), []);
});

for (const field of ["authorizationScopeKey", "documentId", "projectId", "actorUserId", "projectAccessId", "revision", "sourceRevision",
  "requirementRevision", "blockId", "planRevisionId", "targetId", "targetContractDigest", "resultId", "resultRevision", "assetId",
  "assetSha256", "grantId", "operationId", "jobId"]) {
  test("shared choices reject a stale exact-reference field: " + field, async () => {
    const f = await scenario("accepted-file"), current = options(f.snapshot, "result");
    assert.deepEqual(outputContinuationChoices({ ...current, reference: { ...current.reference, [field]: "not-original" } }), []);
  });
}

test("duplicate target identity and changed result bytes cannot choose the first plausible object", async () => {
  const f = await scenario("accepted-file"), current = options(f.snapshot);
  f.snapshot.confirmedPlan.plan.targets.push(structuredClone(f.snapshot.confirmedPlan.plan.targets[0]));
  assert.deepEqual(outputContinuationChoices(current), []);
  const second = await scenario("accepted-file"), exact = options(second.snapshot, "result");
  second.snapshot.assets[0].sha256 = "f".repeat(64);
  assert.deepEqual(outputContinuationChoices(exact), []);
});
